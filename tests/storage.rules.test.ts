/**
 * Cloud Storage 보안 규칙 테스트 (allow/deny 매트릭스)
 *
 * 목적: storage.rules가 활성 직원만 read/write/delete를 허용하고,
 *   10MB 초과·비이미지 contentType·비인증·비활성 직원을 차단하는지 검증한다.
 *
 * 실행 (auth + firestore + storage 에뮬레이터 필요):
 *   npm run test:storage
 *   (내부적으로 firebase emulators:exec --only auth,firestore,storage "tsx --test tests/storage.rules.test.ts")
 *
 * storage.rules는 firestore staff/{uid}를 참조하므로 firestore 에뮬레이터도 함께 띄운다.
 */
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getBytes, deleteObject } from "firebase/storage";

let testEnv: RulesTestEnvironment;

const PATH = "reservationFiles/r1/photos/test.png";
const IMG = { contentType: "image/png" };

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-mobilecrm-rules",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
    storage: {
      rules: readFileSync("storage.rules", "utf8"),
      host: "127.0.0.1",
      port: 9199,
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "staff/staffA"), { uid: "staffA", role: "staff", active: true });
    await setDoc(doc(db, "staff/inactiveStaff"), { uid: "inactiveStaff", role: "staff", active: false });
    // read/delete 테스트용 기존 객체 시드
    await ctx.storage().ref(PATH).put(new Uint8Array([1, 2, 3]), IMG);
  });
});

function storageAs(uid: string | null) {
  const ctx = uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext();
  return ctx.storage();
}

test("활성 직원은 이미지 업로드 성공", async () => {
  const s = storageAs("staffA");
  await assertSucceeds(uploadBytes(ref(s, "reservationFiles/r1/photos/new.png"), new Uint8Array([1, 2, 3]), IMG));
});

test("10MB 초과 업로드 실패", async () => {
  const s = storageAs("staffA");
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  await assertFails(uploadBytes(ref(s, "reservationFiles/r1/photos/big.png"), big, IMG));
});

test("비이미지 contentType 업로드 실패", async () => {
  const s = storageAs("staffA");
  await assertFails(
    uploadBytes(ref(s, "reservationFiles/r1/photos/doc.pdf"), new Uint8Array([1, 2, 3]), { contentType: "application/pdf" })
  );
});

test("비인증 read 실패", async () => {
  const s = storageAs(null);
  await assertFails(getBytes(ref(s, PATH)));
});

test("비인증 write 실패", async () => {
  const s = storageAs(null);
  await assertFails(uploadBytes(ref(s, "reservationFiles/r1/photos/anon.png"), new Uint8Array([1, 2, 3]), IMG));
});

test("비활성 직원 업로드 실패", async () => {
  const s = storageAs("inactiveStaff");
  await assertFails(uploadBytes(ref(s, "reservationFiles/r1/photos/inactive.png"), new Uint8Array([1, 2, 3]), IMG));
});

test("활성 직원 read 성공", async () => {
  const s = storageAs("staffA");
  await assertSucceeds(getBytes(ref(s, PATH)));
});

test("활성 직원 delete 성공", async () => {
  const s = storageAs("staffA");
  await assertSucceeds(deleteObject(ref(s, PATH)));
});
