/**
 * Firestore 보안 규칙 단위 테스트 (allow/deny 매트릭스)
 *
 * 목적: 배포 전 회귀 안전망. firestore.rules가 의도대로
 *   - client SDK 직접 우회(invoices/logs/patients 등)를 차단하고
 *   - 실시간 경로(reservations/staff/photos/charts)는 허용하며
 *   - 비활성 admin의 권한을 박탈하는지
 * 를 자동 검증한다.
 *
 * 실행 (Firestore 에뮬레이터 필요):
 *   npm run test:rules
 *   (내부적으로 `firebase emulators:exec --only firestore "tsx --test tests/rules.test.ts"`)
 *
 * 기본 `npm test`(단위)에는 포함되지 않는다(에뮬레이터 의존).
 */
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  collection,
} from "firebase/firestore";

let testEnv: RulesTestEnvironment;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-mobilecrm-rules",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  // 규칙 우회 컨텍스트에서 시드 데이터 구성
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "staff/adminA"), { uid: "adminA", role: "admin", active: true });
    await setDoc(doc(db, "staff/staffA"), { uid: "staffA", role: "staff", active: true });
    await setDoc(doc(db, "staff/inactiveAdmin"), { uid: "inactiveAdmin", role: "admin", active: false });
    await setDoc(doc(db, "reservations/r1"), {
      isDeleted: false, createdByUid: "x", doctors: ["김"], reservationDate: "2026-06-26",
    });
    await setDoc(doc(db, "invoices/inv1"), { isDeleted: false, totalAmount: 1000 });
    await setDoc(doc(db, "logs/log1"), { action: "x" });
    await setDoc(doc(db, "patients/p1"), { name: "홍길동", isDeleted: false });
  });
});

// 컨텍스트별 Firestore 핸들
const activeStaff = () => testEnv.authenticatedContext("staffA").firestore();
const admin = () => testEnv.authenticatedContext("adminA").firestore();
const inactiveAdmin = () => testEnv.authenticatedContext("inactiveAdmin").firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

// ── #1 client 직접 우회 차단 ────────────────────────────────────────────────
test("미인증 사용자는 reservations를 읽을 수 없다", async () => {
  await assertFails(getDoc(doc(anon(), "reservations/r1")));
});

test("활성 직원은 reservations 실시간 읽기가 허용된다", async () => {
  await assertSucceeds(getDoc(doc(activeStaff(), "reservations/r1")));
});

test("활성 직원이라도 invoices 직접 읽기는 차단된다 (API 우회 방지)", async () => {
  await assertFails(getDoc(doc(activeStaff(), "invoices/inv1")));
});

test("활성 직원이라도 logs 직접 읽기는 차단된다", async () => {
  await assertFails(getDoc(doc(activeStaff(), "logs/log1")));
});

test("활성 직원이라도 patients 직접 읽기는 차단된다", async () => {
  await assertFails(getDoc(doc(activeStaff(), "patients/p1")));
});

test("활성 직원이라도 invoices 직접 쓰기는 차단된다", async () => {
  await assertFails(setDoc(doc(activeStaff(), "invoices/inv2"), { totalAmount: 9 }));
});

// ── #7 작성자/삭제플래그 위조 차단 ──────────────────────────────────────────
test("reservationPhotos 생성: uploadedByUid가 본인이면 허용", async () => {
  await assertSucceeds(
    addDoc(collection(activeStaff(), "reservationPhotos"), { uploadedByUid: "staffA", isDeleted: false })
  );
});

test("reservationPhotos 생성: uploadedByUid가 타인이면 차단", async () => {
  await assertFails(
    addDoc(collection(activeStaff(), "reservationPhotos"), { uploadedByUid: "someoneElse", isDeleted: false })
  );
});

test("reservations 업데이트: doctors만 변경(불변필드 유지)은 허용", async () => {
  await assertSucceeds(updateDoc(doc(activeStaff(), "reservations/r1"), { doctors: ["박"] }));
});

test("reservations 업데이트: isDeleted 위조는 차단", async () => {
  await assertFails(updateDoc(doc(activeStaff(), "reservations/r1"), { isDeleted: true }));
});

// ── #4 비활성 admin 권한 박탈 ───────────────────────────────────────────────
test("admin은 staff 문서를 수정할 수 있다", async () => {
  await assertSucceeds(updateDoc(doc(admin(), "staff/staffA"), { role: "coordinator" }));
});

test("일반 직원은 staff 문서를 수정할 수 없다", async () => {
  await assertFails(updateDoc(doc(activeStaff(), "staff/staffA"), { role: "admin" }));
});

test("비활성화된 admin은 staff 수정 권한을 잃는다 (isAdmin active 검사)", async () => {
  await assertFails(updateDoc(doc(inactiveAdmin(), "staff/staffA"), { role: "admin" }));
});

test("비활성화된 admin은 reservations 읽기도 차단된다 (isActiveStaff)", async () => {
  await assertFails(getDoc(doc(inactiveAdmin(), "reservations/r1")));
});
