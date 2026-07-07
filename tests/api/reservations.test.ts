/**
 * /api/reservations 라우트 테스트 — 소프트삭제 + delete 액션의 admin 전용 가드,
 * 클라이언트가 보낸 신원 필드(createdByUid 등)가 서버 ctx로 강제 덮어써지는지 검증.
 *
 * 실행: npm run test:api (Firestore + Auth 에뮬레이터 필요)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { __resetStaffCacheForTests } from "@/lib/apiAuth";
import { createTestUser, type TestUser } from "../helpers/testAuth";
import { POST } from "@/app/api/reservations/route";
import { identityKeyForPatient } from "@/lib/patientIdentity";
import { RESERVATION_LOCKS, lockIdForReservation } from "@/lib/reservationLocks";

function makeReq(idToken: string, action: string, payload: unknown) {
  return new NextRequest("http://localhost/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action, payload }),
  });
}

let admin: TestUser;
let staff: TestUser;
const createdReservationDocIds: string[] = [];
const createdPatientDocIds: string[] = [];

before(async () => {
  admin = await createTestUser("resv-admin");
  staff = await createTestUser("resv-staff");
  await adminDb.collection("staff").doc(admin.uid).set({ role: "admin", active: true, displayName: "관리자" });
  await adminDb.collection("staff").doc(staff.uid).set({ role: "staff", active: true, displayName: "직원" });
});

after(async () => {
  await adminDb.collection("staff").doc(admin.uid).delete();
  await adminDb.collection("staff").doc(staff.uid).delete();
  for (const id of createdReservationDocIds) await adminDb.collection("reservations").doc(id).delete().catch(() => {});
  for (const id of createdPatientDocIds) await adminDb.collection("patients").doc(id).delete().catch(() => {});
});

test("create: 클라이언트가 보낸 createdByUid는 무시되고 서버 ctx.uid로 강제된다", async () => {
  __resetStaffCacheForTests();
  const res = await POST(
    makeReq(staff.idToken, "create", {
      patient: { name: "위조테스트", createdByUid: "spoofed-uid" },
      reservation: {
        reservationId: `R-${Date.now()}`,
        name: "위조테스트",
        reservationDate: "2026-07-05",
        createdByUid: "spoofed-uid",
        doctors: [],
        isDeleted: false,
      },
    })
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  createdReservationDocIds.push(body.reservationDocId);
  createdPatientDocIds.push(body.patientDocId);

  const resSnap = await adminDb.collection("reservations").doc(body.reservationDocId).get();
  assert.equal(resSnap.data()?.createdByUid, staff.uid);
  assert.notEqual(resSnap.data()?.createdByUid, "spoofed-uid");

  const patSnap = await adminDb.collection("patients").doc(body.patientDocId).get();
  assert.equal(patSnap.data()?.createdByUid, staff.uid);
});

test("update: 클라이언트가 보낸 updatedByUid는 무시되고 서버 ctx.uid로 강제된다", async () => {
  __resetStaffCacheForTests();
  const reservationDocId = createdReservationDocIds[0];
  const res = await POST(
    makeReq(admin.idToken, "update", {
      reservationDocId,
      reservationPatch: { hospital: "본원", updatedByUid: "spoofed-uid-2" },
    })
  );
  assert.equal(res.status, 200);

  const resSnap = await adminDb.collection("reservations").doc(reservationDocId).get();
  assert.equal(resSnap.data()?.updatedByUid, admin.uid);
  assert.equal(resSnap.data()?.hospital, "본원");
});

test("delete: admin이 아니면 403이고 소프트삭제되지 않는다", async () => {
  __resetStaffCacheForTests();
  const reservationDocId = createdReservationDocIds[0];
  const res = await POST(makeReq(staff.idToken, "delete", { reservationDocId }));
  assert.equal(res.status, 403);

  const resSnap = await adminDb.collection("reservations").doc(reservationDocId).get();
  assert.equal(resSnap.data()?.isDeleted, false);
});

test("delete: admin이면 소프트삭제(isDeleted=true)된다", async () => {
  __resetStaffCacheForTests();
  const reservationDocId = createdReservationDocIds[0];
  const res = await POST(makeReq(admin.idToken, "delete", { reservationDocId }));
  assert.equal(res.status, 200);

  const resSnap = await adminDb.collection("reservations").doc(reservationDocId).get();
  assert.equal(resSnap.data()?.isDeleted, true);
});

test("create: 동일 reservationId로 재요청하면 중복으로 거부된다", async () => {
  __resetStaffCacheForTests();
  const reservationId = `R-DUP-${Date.now()}`;
  const first = await POST(
    makeReq(staff.idToken, "create", {
      patient: { name: "중복테스트" },
      reservation: { reservationId, name: "중복테스트", reservationDate: "2026-07-06", doctors: [], isDeleted: false },
    })
  );
  const firstBody = await first.json();
  createdReservationDocIds.push(firstBody.reservationDocId);
  createdPatientDocIds.push(firstBody.patientDocId);

  const second = await POST(
    makeReq(staff.idToken, "create", {
      patient: { name: "중복테스트" },
      reservation: { reservationId, name: "중복테스트", reservationDate: "2026-07-06", doctors: [], isDeleted: false },
    })
  );
  const secondBody = await second.json();
  assert.equal(secondBody.success, false);
  assert.equal(secondBody.duplicate, true);
});

test("patient_full_history_batch: 여러 환자의 오래된 이력을 한 번에 묶어서 반환한다", async () => {
  __resetStaffCacheForTests();

  const oldRef1 = adminDb.collection("reservations").doc();
  const oldRef2 = adminDb.collection("reservations").doc();
  const recentRef = adminDb.collection("reservations").doc();
  createdReservationDocIds.push(oldRef1.id, oldRef2.id, recentRef.id);

  await oldRef1.set({
    reservationId: `R-OLD1-${Date.now()}`, name: "배치환자1", patientId: "P-BATCH-1",
    reservationDate: "2026-01-01", doctors: [], isDeleted: false,
  });
  await oldRef2.set({
    reservationId: `R-OLD2-${Date.now()}`, name: "배치환자2", patientId: "P-BATCH-2",
    reservationDate: "2026-02-01", doctors: [], isDeleted: false,
  });
  // 컷오프(2026-06-01)보다 최근 — 배치 결과에 포함되면 안 된다(라이브 구독이 이미 갖고 있는 데이터).
  await recentRef.set({
    reservationId: `R-RECENT-${Date.now()}`, name: "배치환자1", patientId: "P-BATCH-1",
    reservationDate: "2026-06-15", doctors: [], isDeleted: false,
  });

  const res = await POST(
    makeReq(staff.idToken, "patient_full_history_batch", {
      patientIds: ["P-BATCH-1", "P-BATCH-2", "P-BATCH-NONE"],
      before: "2026-06-01",
    })
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.byPatient["P-BATCH-1"].length, 1);
  assert.equal(body.byPatient["P-BATCH-1"][0].reservationDate, "2026-01-01");
  assert.equal(body.byPatient["P-BATCH-2"].length, 1);
  assert.deepEqual(body.byPatient["P-BATCH-NONE"], []);
});

test("update: staff가 화이트리스트 밖 필드(isDeleted/invoiceDocId/createdByUid)를 보내면 400 거부 + DB 불변", async () => {
  __resetStaffCacheForTests();
  const created = await POST(
    makeReq(admin.idToken, "create", {
      patient: { name: "화이트리스트", patientId: `P-WL-${Date.now()}` },
      reservation: {
        reservationId: `R-WL-${Date.now()}`, name: "화이트리스트",
        reservationDate: "2026-07-10", hospital: "원본병원", doctors: [], isDeleted: false,
      },
    })
  );
  const createdBody = await created.json();
  const docId = createdBody.reservationDocId;
  createdReservationDocIds.push(docId);
  createdPatientDocIds.push(createdBody.patientDocId);

  const res = await POST(
    makeReq(staff.idToken, "update", {
      reservationDocId: docId,
      reservationId: "R-WL",
      reservationPatch: { hospital: "허용병원", isDeleted: true, invoiceDocId: "hacked", createdByUid: "spoof" },
    })
  );
  assert.equal(res.status, 400);                    // 비허용 필드 포함 → 요청 자체를 거부
  assert.equal((await res.json()).success, false);

  const data = (await adminDb.collection("reservations").doc(docId).get()).data()!;
  assert.equal(data.hospital, "원본병원");          // 거부되어 허용 필드도 반영 안 됨
  assert.equal(data.isDeleted, false);              // 삭제 우회 차단
  assert.notEqual(data.invoiceDocId, "hacked");
  assert.notEqual(data.createdByUid, "spoof");
});

test("update: 정상 필드만이면 200 + reservation_update 감사로그(before/after) 기록", async () => {
  __resetStaffCacheForTests();
  const rid = `R-LOG-${Date.now()}`;
  const created = await POST(
    makeReq(admin.idToken, "create", {
      patient: { name: "로그", patientId: `P-LOG-${Date.now()}` },
      reservation: { reservationId: rid, name: "로그", reservationDate: "2026-07-11", hospital: "이전병원", doctors: [], isDeleted: false },
    })
  );
  const createdBody = await created.json();
  createdReservationDocIds.push(createdBody.reservationDocId);
  createdPatientDocIds.push(createdBody.patientDocId);

  const res = await POST(
    makeReq(staff.idToken, "update", {
      reservationDocId: createdBody.reservationDocId,
      reservationId: rid,
      reservationPatch: { hospital: "새병원", updatedBy: "무시됨", updatedByUid: "무시됨" },
    })
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).success, true);

  const data = (await adminDb.collection("reservations").doc(createdBody.reservationDocId).get()).data()!;
  assert.equal(data.hospital, "새병원");            // 허용 필드 반영
  assert.equal(data.updatedByUid, staff.uid);       // 서버관리 필드는 무시되고 ctx로 강제

  const logs = await adminDb.collection("logs")
    .where("reservationId", "==", rid)
    .where("action", "==", "reservation_update")
    .get();
  assert.ok(logs.size >= 1);
  const log = logs.docs[0].data();
  assert.equal(log.staffUid, staff.uid);
  assert.equal((log.before as Record<string, unknown>).hospital, "이전병원");  // before 기록
  assert.equal((log.after as Record<string, unknown>).hospital, "새병원");     // after 기록
});

test("create: 기존 patientId로 재요청하면 patients가 중복 생성되지 않고 연결만 된다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-DUP-${Date.now()}`;
  const first = await POST(
    makeReq(staff.idToken, "create", {
      patient: { name: "중복환자", patientId },
      reservation: { reservationId: `R-DUP1-${Date.now()}`, name: "중복환자", patientId, reservationDate: "2026-07-12", doctors: [], isDeleted: false },
    })
  );
  const firstBody = await first.json();
  createdReservationDocIds.push(firstBody.reservationDocId);
  createdPatientDocIds.push(firstBody.patientDocId);

  const second = await POST(
    makeReq(staff.idToken, "create", {
      patient: { name: "중복환자", patientId },
      reservation: { reservationId: `R-DUP2-${Date.now()}`, name: "중복환자", patientId, reservationDate: "2026-07-13", doctors: [], isDeleted: false },
    })
  );
  const secondBody = await second.json();
  assert.equal(secondBody.success, true);
  assert.equal(secondBody.linkedExistingPatient, true);
  assert.equal(secondBody.patientDocId, firstBody.patientDocId);
  assert.equal(firstBody.patientDocId, patientId);   // 신규 환자 문서 ID = patientId 고정
  createdReservationDocIds.push(secondBody.reservationDocId);

  const pSnap = await adminDb.collection("patients").where("patientId", "==", patientId).get();
  assert.equal(pSnap.size, 1);
});

test("delete_patient: admin이면 전체 예약 + 환자 문서가 soft-delete된다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-DELALL-${Date.now()}`;
  const c1 = await POST(makeReq(admin.idToken, "create", {
    patient: { name: "전체삭제", patientId },
    reservation: { reservationId: `R-DA1-${Date.now()}`, name: "전체삭제", patientId, reservationDate: "2026-01-05", doctors: [], isDeleted: false },
  }));
  const c1b = await c1.json();
  createdReservationDocIds.push(c1b.reservationDocId);
  createdPatientDocIds.push(c1b.patientDocId);

  // non-admin은 403
  const denied = await POST(makeReq(staff.idToken, "delete_patient", { patientId }));
  assert.equal(denied.status, 403);

  const ok = await POST(makeReq(admin.idToken, "delete_patient", { patientId }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).success, true);

  const resSnap = await adminDb.collection("reservations").where("patientId", "==", patientId).get();
  assert.ok(resSnap.docs.every((d) => d.data().isDeleted === true));
  const patSnap = await adminDb.collection("patients").where("patientId", "==", patientId).get();
  assert.ok(patSnap.docs.every((d) => d.data().isDeleted === true));
});

test("patients summary: 예약 생성/추가/삭제 시 요약 필드가 정확히 재계산된다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-SUM-${Date.now()}`;

  // 1건 생성 (예약금 100,000 / 수술비 2,000,000)
  const c1 = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "요약환자", patientId },
    reservation: {
      reservationId: `R-SUM1-${Date.now()}`, name: "요약환자", patientId,
      reservationDate: "2026-03-01", reservationTime: "10:00",
      depositAmount: "100,000", surgeryCost: "2,000,000", doctors: [], isDeleted: false,
    },
  }));
  const c1b = await c1.json();
  createdReservationDocIds.push(c1b.reservationDocId);
  createdPatientDocIds.push(c1b.patientDocId);

  let pat = (await adminDb.collection("patients").doc(patientId).get()).data()!;
  assert.equal(pat.reservationCount, 1);
  assert.equal(pat.depositCount, 1);
  assert.equal(pat.surgeryCostCount, 1);
  assert.equal(pat.totalDepositAmount, 100000);
  assert.equal(pat.totalSurgeryCost, 2000000);
  assert.equal(pat.lastReservationDate, "2026-03-01");
  // invoice/memo 요약은 해당 도메인 쓰기에서만 채워짐 → 예약만 있는 환자는 미설정(falsy)
  assert.ok(!pat.hasInvoice);
  assert.ok(!pat.hasMemo);

  // 같은 환자에 더 최근 예약 추가 (예약금 없음)
  const c2 = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "요약환자", patientId },
    reservation: {
      reservationId: `R-SUM2-${Date.now()}`, name: "요약환자", patientId,
      reservationDate: "2026-05-20", reservationTime: "14:30",
      depositAmount: "", surgeryCost: "", doctors: [], isDeleted: false,
    },
  }));
  const c2b = await c2.json();
  createdReservationDocIds.push(c2b.reservationDocId);

  pat = (await adminDb.collection("patients").doc(patientId).get()).data()!;
  assert.equal(pat.reservationCount, 2);
  assert.equal(pat.depositCount, 1);              // 여전히 1건만 예약금 있음
  assert.equal(pat.totalDepositAmount, 100000);
  assert.equal(pat.lastReservationDate, "2026-05-20");   // 최근 예약으로 갱신
  assert.equal(pat.lastReservationAt, "2026-05-20 14:30");

  // 최근 예약 삭제 → 카운트/최근예약 원복
  const del = await POST(makeReq(admin.idToken, "delete", { reservationDocId: c2b.reservationDocId }));
  assert.equal(del.status, 200);

  pat = (await adminDb.collection("patients").doc(patientId).get()).data()!;
  assert.equal(pat.reservationCount, 1);
  assert.equal(pat.lastReservationDate, "2026-03-01");
});

test("patients summary: 예약금/수술비 카운트는 병원+부위+원장 '묶음 그룹 수'로 저장된다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-GRP-${Date.now()}`;

  // 같은 병원+부위+원장, 둘 다 예약금 있음 → 그룹 1건
  const a = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "묶음환자", patientId },
    reservation: {
      reservationId: `R-GA-${Date.now()}`, name: "묶음환자", patientId,
      reservationDate: "2026-04-01", hospital: "H1", consultArea: "코", doctors: ["김"],
      depositAmount: "100,000", isDeleted: false,
    },
  }));
  createdReservationDocIds.push((await a.json()).reservationDocId);
  createdPatientDocIds.push(patientId);

  const b = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "묶음환자", patientId },
    reservation: {
      reservationId: `R-GB-${Date.now()}`, name: "묶음환자", patientId,
      reservationDate: "2026-04-02", hospital: "H1", consultArea: "코", doctors: ["김"],
      depositAmount: "200,000", isDeleted: false,
    },
  }));
  createdReservationDocIds.push((await b.json()).reservationDocId);

  let pat = (await adminDb.collection("patients").doc(patientId).get()).data()!;
  assert.equal(pat.reservationCount, 2);
  assert.equal(pat.depositCount, 1);   // 같은 그룹 → 예약금 1건

  // 다른 병원 → 새 그룹
  const c = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "묶음환자", patientId },
    reservation: {
      reservationId: `R-GC-${Date.now()}`, name: "묶음환자", patientId,
      reservationDate: "2026-04-03", hospital: "H2", consultArea: "코", doctors: ["김"],
      depositAmount: "50,000", isDeleted: false,
    },
  }));
  createdReservationDocIds.push((await c.json()).reservationDocId);

  pat = (await adminDb.collection("patients").doc(patientId).get()).data()!;
  assert.equal(pat.reservationCount, 3);
  assert.equal(pat.depositCount, 2);   // H1 그룹 + H2 그룹
});

test("list_patients_summary: lastReservationDate 내림차순 + limit + cursor 페이지네이션", async () => {
  __resetStaffCacheForTests();

  const page1 = await POST(makeReq(staff.idToken, "list_patients_summary", { limit: 3 }));
  assert.equal(page1.status, 200);
  const b1 = await page1.json();
  assert.equal(b1.success, true);
  assert.ok(Array.isArray(b1.patients));
  assert.ok(b1.patients.length <= 3);
  // 내림차순 단조성(다른 테스트 데이터와 무관하게 성립해야 함)
  for (let i = 1; i < b1.patients.length; i++) {
    assert.ok(String(b1.patients[i - 1].lastReservationDate) >= String(b1.patients[i].lastReservationDate));
  }
  // 소프트삭제 환자는 제외
  assert.ok(b1.patients.every((p: { isDeleted?: boolean }) => p.isDeleted !== true));

  // cursor로 다음 페이지 — 첫 페이지와 겹치지 않아야 함
  if (b1.nextCursor) {
    const page2 = await POST(makeReq(staff.idToken, "list_patients_summary", { limit: 3, cursor: b1.nextCursor }));
    const b2 = await page2.json();
    const ids1 = new Set(b1.patients.map((p: { id: string }) => p.id));
    assert.ok(b2.patients.every((p: { id: string }) => !ids1.has(p.id)));
  }
});

test("create: 화이트리스트 밖 필드(isDeleted/invoiceStatus 등)를 보내면 400 거부됨", async () => {
  __resetStaffCacheForTests();
  const name = `생성화이트리스트${Date.now()}`;
  const res = await POST(
    makeReq(staff.idToken, "create", {
      patient: { name, isDeleted: true },
      reservation: {
        reservationId: `R-CWL-${Date.now()}`, name,
        reservationDate: "2026-07-15", doctors: [], isDeleted: true, invoiceStatus: "paid",
      },
    })
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).success, false);

  // 생성 자체가 거부되어야 하므로 문서가 생기지 않았는지 확인
  const byName = await adminDb.collection("reservations").where("name", "==", name).get();
  assert.equal(byName.size, 0);
});

test("create_patient: 화이트리스트 밖 필드를 보내면 400 거부되고 문서가 생성되지 않는다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-CPWL-${Date.now()}`;
  const res = await POST(
    makeReq(staff.idToken, "create_patient", {
      patient: { name: "환자생성화이트리스트", patientId, isDeleted: true, hasInvoice: true },
    })
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).success, false);

  const snap = await adminDb.collection("patients").doc(patientId).get();
  assert.equal(snap.exists, false);
});

test("create: 동시에 같은 예약(날짜+이름 등 동일 조합)을 저장하면 하나만 성공한다", async () => {
  __resetStaffCacheForTests();
  const name = `동시예약${Date.now()}`;
  const makePayload = () => ({
    patient: { name },
    reservation: {
      name, reservationDate: "2026-07-20", hospital: "H1", appointmentType: "상담",
      doctors: ["김"], isDeleted: false,
    },
  });

  const [r1, r2] = await Promise.all([
    POST(makeReq(staff.idToken, "create", makePayload())),
    POST(makeReq(staff.idToken, "create", makePayload())),
  ]);
  const [b1, b2] = await Promise.all([r1.json(), r2.json()]);

  const successes = [b1, b2].filter((b) => b.success === true);
  const duplicates = [b1, b2].filter((b) => b.duplicate === true);
  assert.equal(successes.length, 1);
  assert.equal(duplicates.length, 1);

  if (successes[0].reservationDocId) createdReservationDocIds.push(successes[0].reservationDocId);
  if (successes[0].patientDocId) createdPatientDocIds.push(successes[0].patientDocId);

  const snap = await adminDb.collection("reservations").where("name", "==", name).get();
  assert.equal(snap.size, 1);
});

<<<<<<< HEAD
test("create: patientId가 달라도 이름+생년월일+국적+성별이 같으면 같은 환자로 연결된다", async () => {
  __resetStaffCacheForTests();
  const name = `신원중복${Date.now()}`;
  const identity = { name, birth: "19910531", nationality: "몽골", gender: "여" };

  // 1차 등록: 클라이언트가 랜덤 patientId(P-A)를 붙여 보냄.
  const pidA = `P-IDENT-A-${Date.now()}`;
  const first = await POST(
    makeReq(staff.idToken, "create", {
      patient: { ...identity, patientId: pidA },
      reservation: { ...identity, patientId: pidA, reservationId: `R-IDENT1-${Date.now()}`, reservationDate: "2026-08-01", doctors: [], isDeleted: false },
    })
  );
  const b1 = await first.json();
  assert.equal(b1.success, true);
  createdReservationDocIds.push(b1.reservationDocId);
  createdPatientDocIds.push(b1.patientDocId);

  // 2차 등록: 같은 사람인데 클라이언트가 "다른" 랜덤 patientId(P-B)를 새로 생성해 보냄(버그 재현).
  const pidB = `P-IDENT-B-${Date.now()}`;
  const second = await POST(
    makeReq(staff.idToken, "create", {
      patient: { ...identity, patientId: pidB },
      reservation: { ...identity, patientId: pidB, reservationId: `R-IDENT2-${Date.now()}`, reservationDate: "2026-08-02", doctors: [], isDeleted: false },
    })
  );
  const b2 = await second.json();
  assert.equal(b2.success, true);
  assert.equal(b2.linkedExistingPatient, true);            // 신원 일치 → 연결
  assert.equal(b2.patientDocId, b1.patientDocId);          // 같은 대표 환자 문서
  createdReservationDocIds.push(b2.reservationDocId);

  // 2차 예약의 patientId가 대표 값(P-A)으로 정합되어야 이력/요약이 한 환자로 모인다.
  const res2 = await adminDb.collection("reservations").doc(b2.reservationDocId).get();
  assert.equal(res2.data()?.patientId, b1.patientDocId);

  // 활성 환자 문서는 신원당 1개.
  const key = identityKeyForPatient(identity);
  const active = await adminDb.collection("patients")
    .where("identityKey", "==", key).where("isDeleted", "==", false).get();
  assert.equal(active.size, 1);
});

test("create: 성별이 다르면 별도 환자로 생성된다", async () => {
  __resetStaffCacheForTests();
  const name = `성별구분${Date.now()}`;
  const base = { name, birth: "19850409", nationality: "몽골" };

  const female = await POST(
    makeReq(staff.idToken, "create", {
      patient: { ...base, gender: "여", patientId: `P-GF-${Date.now()}` },
      reservation: { ...base, gender: "여", reservationId: `R-GF-${Date.now()}`, reservationDate: "2026-08-05", doctors: [], isDeleted: false },
    })
  );
  const male = await POST(
    makeReq(staff.idToken, "create", {
      patient: { ...base, gender: "남", patientId: `P-GM-${Date.now()}` },
      reservation: { ...base, gender: "남", reservationId: `R-GM-${Date.now()}`, reservationDate: "2026-08-06", doctors: [], isDeleted: false },
    })
  );
  const bf = await female.json();
  const bm = await male.json();
  assert.notEqual(bf.patientDocId, bm.patientDocId);       // 성별 다르면 별도 환자
  assert.notEqual(bm.linkedExistingPatient, true);
  createdReservationDocIds.push(bf.reservationDocId, bm.reservationDocId);
  createdPatientDocIds.push(bf.patientDocId, bm.patientDocId);

  const all = await adminDb.collection("patients").where("name", "==", name).get();
  assert.equal(all.size, 2);
});

test("create_patient: 이름+생년월일+국적+성별이 같으면 기존 환자로 연결된다", async () => {
  __resetStaffCacheForTests();
  const name = `단독신원${Date.now()}`;
  const identity = { name, birth: "20000829", nationality: "몽골", gender: "여" };

  const first = await POST(makeReq(staff.idToken, "create_patient", { patient: { ...identity, patientId: `P-CP-A-${Date.now()}` } }));
  const b1 = await first.json();
  assert.equal(b1.success, true);
  createdPatientDocIds.push(b1.patientDocId);

  const second = await POST(makeReq(staff.idToken, "create_patient", { patient: { ...identity, patientId: `P-CP-B-${Date.now()}` } }));
  const b2 = await second.json();
  assert.equal(b2.success, true);
  assert.equal(b2.linkedExistingPatient, true);
  assert.equal(b2.patientDocId, b1.patientDocId);

  const all = await adminDb.collection("patients").where("name", "==", name).get();
  assert.equal(all.size, 1);
=======
test("update 필드 보존: sparse patch는 전달 안 한 필드(상태/금액/담당자)를 유지한다", async () => {
  __resetStaffCacheForTests();
  const docRef = adminDb.collection("reservations").doc();
  createdReservationDocIds.push(docRef.id);
  await docRef.set({
    reservationId: `R-PRESERVE-${Date.now()}`, patientId: `P-PRESERVE-${Date.now()}`,
    name: "보존환자", reservationDate: "2026-08-01",
    cancelled: true, completed: false,
    depositAmount: "1000000", surgeryCost: "5000000",
    coordinators: ["David"], hospital: "ARC", doctors: [], isDeleted: false,
  });

  // hospital만 수정
  const r1 = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: docRef.id, reservationPatch: { name: "보존환자", reservationDate: "2026-08-01", hospital: "NEW" },
  }));
  assert.equal(r1.status, 200);
  let d = (await docRef.get()).data()!;
  assert.equal(d.hospital, "NEW");
  assert.equal(d.cancelled, true);            // 유지
  assert.equal(d.completed, false);           // 유지
  assert.equal(d.depositAmount, "1000000");   // 유지
  assert.equal(d.surgeryCost, "5000000");     // 유지
  assert.deepEqual(d.coordinators, ["David"]); // 유지

  // completed만 수정 → cancelled 유지
  const r2 = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: docRef.id, reservationPatch: { name: "보존환자", reservationDate: "2026-08-01", completed: true },
  }));
  assert.equal(r2.status, 200);
  d = (await docRef.get()).data()!;
  assert.equal(d.completed, true);
  assert.equal(d.cancelled, true);            // 유지

  // coordinators=[] 명시 → 빈 배열로 변경
  const r3 = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: docRef.id, reservationPatch: { name: "보존환자", reservationDate: "2026-08-01", coordinators: [] },
  }));
  assert.equal(r3.status, 200);
  d = (await docRef.get()).data()!;
  assert.deepEqual(d.coordinators, []);
  assert.equal(d.depositAmount, "1000000");   // 여전히 유지
});

test("update: 존재하지 않는 reservationDocId → 400", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: "nonexistent-doc-id",
    reservationPatch: { name: "x", reservationDate: "2026-08-01", hospital: "X" },
  }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).success, false);
});

test("create: patient.patientId와 reservation.patientId 불일치 → 400 PATIENT_ID_MISMATCH", async () => {
  __resetStaffCacheForTests();
  const name = `불일치${Date.now()}`;
  const res = await POST(makeReq(staff.idToken, "create", {
    patient: { name, patientId: `P-A-${Date.now()}` },
    reservation: { reservationId: `R-MM-${Date.now()}`, name, patientId: `P-B-${Date.now()}`, reservationDate: "2026-08-02", doctors: [], isDeleted: false },
  }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, "PATIENT_ID_MISMATCH");
  const byName = await adminDb.collection("reservations").where("name", "==", name).get();
  assert.equal(byName.size, 0);
});

for (const field of ["invoiceId", "invoiceUrl", "invoiceSheetName", "surgeryReservedAt"]) {
  test(`create: ${field} 주입 → 400 DISALLOWED_FIELD`, async () => {
    __resetStaffCacheForTests();
    const name = `주입${field}${Date.now()}`;
    const res = await POST(makeReq(staff.idToken, "create", {
      patient: { name },
      reservation: {
        reservationId: `R-INJ-${field}-${Date.now()}`, name,
        reservationDate: "2026-08-03", doctors: [], isDeleted: false, [field]: "injected",
      },
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "DISALLOWED_FIELD");
    const byName = await adminDb.collection("reservations").where("name", "==", name).get();
    assert.equal(byName.size, 0);
  });
}

test("create: 일반 신규 예약은 서버 기본값(completed/cancelled/surgeryReserved=false)을 기록한다", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "기본값", patientId: `P-DEF-${Date.now()}` },
    reservation: { reservationId: `R-DEF-${Date.now()}`, name: "기본값", reservationDate: "2026-08-04", doctors: [], isDeleted: false },
  }));
  const body = await res.json();
  assert.equal(body.success, true);
  createdReservationDocIds.push(body.reservationDocId);
  createdPatientDocIds.push(body.patientDocId);
  const d = (await adminDb.collection("reservations").doc(body.reservationDocId).get()).data()!;
  assert.equal(d.completed, false);
  assert.equal(d.cancelled, false);
  assert.equal(d.surgeryReserved, false);
  assert.ok(!("surgeryReservedAt" in d));
});

test("create_patient: 예약 없이 환자만 생성해도 summary 기본값(lastReservationDate/reservationCount)이 기록된다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-EMPTY-${Date.now()}`;
  createdPatientDocIds.push(patientId);
  const res = await POST(makeReq(staff.idToken, "create_patient", {
    patient: { name: "예약없는환자", patientId },
  }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).success, true);
  const d = (await adminDb.collection("patients").doc(patientId).get()).data()!;
  assert.equal(d.reservationCount, 0);
  assert.equal(d.lastReservationDate, "");
  assert.ok("lastReservationDate" in d);   // 목록 노출 위해 필드 존재 필수
  assert.equal(d.hasInvoice, false);
  assert.equal(d.hasMemo, false);
});

// ── reservation lock lifecycle (2단계) ────────────────────────────────────
function lockCombo(name: string, time: string) {
  return {
    patient: { name },
    reservation: {
      name, reservationDate: "2026-09-01", reservationTime: time,
      hospital: "LockH", appointmentType: "상담", phone: "010-1111-2222",
      doctors: ["김원장"], isDeleted: false,
    },
  };
}
async function createLock(name: string, time: string) {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(staff.idToken, "create", lockCombo(name, time)));
  const body = await res.json();
  if (body.reservationDocId) createdReservationDocIds.push(body.reservationDocId);
  if (body.patientDocId) createdPatientDocIds.push(body.patientDocId);
  return body;
}

test("lock: 예약 삭제 후 같은 조합 재생성 성공(stale lock self-heal)", async () => {
  const name = `락삭제${Date.now()}`;
  const a = await createLock(name, "10:00");
  assert.equal(a.success, true);
  const dup = await createLock(name, "10:00");
  assert.equal(dup.duplicate, true);
  __resetStaffCacheForTests();
  await POST(makeReq(admin.idToken, "delete", { reservationDocId: a.reservationDocId }));
  const b = await createLock(name, "10:00");
  assert.equal(b.success, true);
});

test("lock: 시간 변경 시 old lock 해제 + new 시간 중복 차단", async () => {
  const name = `락시간${Date.now()}`;
  const a = await createLock(name, "10:00");
  __resetStaffCacheForTests();
  const upd = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: a.reservationDocId,
    reservationPatch: { name, reservationDate: "2026-09-01", reservationTime: "11:00" },
  }));
  assert.equal((await upd.json()).success, true);
  const c = await createLock(name, "11:00");
  assert.equal(c.duplicate, true);
  const d = await createLock(name, "10:00");
  assert.equal(d.success, true);
});

test("lock: 동일 dupKey 유지 update는 self-lock으로 허용", async () => {
  const name = `락셀프${Date.now()}`;
  const a = await createLock(name, "10:00");
  __resetStaffCacheForTests();
  const upd = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: a.reservationDocId,
    reservationPatch: { name, reservationDate: "2026-09-01", reservationTime: "10:00", depositAmount: "50000" },
  }));
  assert.equal((await upd.json()).success, true);
});

test("lock: dupKey 변경이 다른 활성 예약과 충돌하면 409 DUPLICATE_RESERVATION", async () => {
  const name = `락충돌${Date.now()}`;
  const a = await createLock(name, "10:00");
  await createLock(name, "12:00");
  __resetStaffCacheForTests();
  const upd = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: a.reservationDocId,
    reservationPatch: { name, reservationDate: "2026-09-01", reservationTime: "12:00" },
  }));
  assert.equal(upd.status, 409);
  assert.equal((await upd.json()).code, "DUPLICATE_RESERVATION");
});

test("lock: 취소 시 lock 해제 → 같은 조합 신규 가능, 복구 시 충돌 실패", async () => {
  const name = `락취소${Date.now()}`;
  const a = await createLock(name, "10:00");
  __resetStaffCacheForTests();
  const cancel = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: a.reservationDocId,
    reservationPatch: { name, reservationDate: "2026-09-01", reservationTime: "10:00", cancelled: true },
  }));
  assert.equal((await cancel.json()).success, true);
  const b = await createLock(name, "10:00");
  assert.equal(b.success, true);
  __resetStaffCacheForTests();
  const restore = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: a.reservationDocId,
    reservationPatch: { name, reservationDate: "2026-09-01", reservationTime: "10:00", cancelled: false },
  }));
  assert.equal(restore.status, 409);
});

test("lock: 취소 복구 시 다른 활성 예약이 없으면 lock 재확보 성공", async () => {
  const name = `락복구${Date.now()}`;
  const a = await createLock(name, "10:00");
  __resetStaffCacheForTests();
  await POST(makeReq(staff.idToken, "update", {
    reservationDocId: a.reservationDocId,
    reservationPatch: { name, reservationDate: "2026-09-01", reservationTime: "10:00", cancelled: true },
  }));
  __resetStaffCacheForTests();
  const restore = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: a.reservationDocId,
    reservationPatch: { name, reservationDate: "2026-09-01", reservationTime: "10:00", cancelled: false },
  }));
  assert.equal((await restore.json()).success, true);
  const c = await createLock(name, "10:00");
  assert.equal(c.duplicate, true);
});

// ── KPI: 500 상한을 넘겨 전체 집계 (3단계) ─────────────────────────────────
test("read_range_all: 501건도 500 상한에 잘리지 않고 전체 반환", async () => {
  __resetStaffCacheForTests();
  const N = 501;
  const marker = `KPI-${Date.now()}`;
  // 500건 단위 batch로 시드.
  for (let base = 0; base < N; base += 500) {
    const batch = adminDb.batch();
    for (let i = base; i < Math.min(base + 500, N); i++) {
      const ref = adminDb.collection("reservations").doc();
      createdReservationDocIds.push(ref.id);
      batch.set(ref, {
        reservationId: `${marker}-${i}`, patientId: marker, name: "KPI환자",
        reservationDate: "2027-03-15", reservationTime: "10:00",
        doctors: [], isDeleted: false,
      });
    }
    await batch.commit();
  }

  const res = await POST(makeReq(staff.idToken, "read_range_all", { from: "2027-03-01", to: "2027-03-31" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.capped, false);
  const mine = (body.reservations as { patientId: string }[]).filter((r) => r.patientId === marker);
  assert.equal(mine.length, N); // 500이 아니라 501 전체
});

test("read_range_all: from/to 누락 시 400", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(staff.idToken, "read_range_all", { from: "2027-03-01" }));
  assert.equal(res.status, 400);
});

// ── lock: stale 판정 강화 + transaction outcome 안정성 (P0 수정) ──────────────
test("lock: 활성 예약을 가리키지만 현재 계산 lockId와 다른(mismatch) lock은 stale로 self-heal", async () => {
  const xName = `스테일타깃${Date.now()}`;
  const x = await createLock(xName, "09:00"); // 자기 콤보의 진짜 lock을 정상 보유한 별개의 활성 예약
  assert.equal(x.success, true);

  const bName = `스테일신규${Date.now()}`;
  const bTime = "14:00";
  const bLockId = lockIdForReservation(lockCombo(bName, bTime).reservation);

  // B 콤보의 자리에 "X를 가리키지만 X의 실제 콤보와는 무관한" 오염된 lock을 직접 심는다
  // (구 identity 스킴 잔재·데이터 정정 등으로 생기는 lockId 불일치 상황을 재현).
  const lockRef = adminDb.collection(RESERVATION_LOCKS).doc(bLockId);
  await lockRef.set({
    reservationDocId: x.reservationDocId,
    reservationId: "",
    patientId: "",
    dupKeyHash: bLockId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const b = await createLock(bName, bTime);
  assert.equal(b.success, true); // stale로 판정되어 self-heal — duplicate로 막히지 않는다
});

test("lock: update가 409로 거부된 직후 무관한 정상 update는 이전 실패에 영향받지 않고 성공한다", async () => {
  const name = `트랜잭션순서${Date.now()}`;
  const a = await createLock(name, "10:00");
  await createLock(name, "16:00"); // 다른 활성 예약이 16:00 콤보의 lock을 보유

  __resetStaffCacheForTests();
  const conflictRes = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: a.reservationDocId,
    reservationPatch: { name, reservationDate: "2026-09-01", reservationTime: "16:00" },
  }));
  assert.equal(conflictRes.status, 409); // duplicate로 거부

  // 직후 A에 대해 콤보와 무관한 정상 필드만 수정 → 이전 실패 신호가 새어나오지 않고 성공해야 한다
  __resetStaffCacheForTests();
  const okRes = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: a.reservationDocId,
    reservationPatch: { name, reservationDate: "2026-09-01", reservationTime: "10:00", depositAmount: "10000" },
  }));
  assert.equal(okRes.status, 200);
  assert.equal((await okRes.json()).success, true);
});

// ── 삭제된 환자 재등록 차단 (P0 후속) ─────────────────────────────────────────
test("create: 삭제된 환자의 patientId로 재등록 시도 → 409 PATIENT_DELETED", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-DELREG-${Date.now()}`;
  const c1 = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "삭제환자", patientId },
    reservation: { reservationId: `R-DELREG-1-${Date.now()}`, name: "삭제환자", patientId, reservationDate: "2027-04-01", doctors: [], isDeleted: false },
  }));
  const c1b = await c1.json();
  createdReservationDocIds.push(c1b.reservationDocId);
  createdPatientDocIds.push(c1b.patientDocId);

  // 환자 전체 삭제(soft delete)
  await POST(makeReq(admin.idToken, "delete_patient", { patientId }));

  // 같은 patientId로 신규 예약 생성 시도 → 조용히 재연결/부활하지 않고 거부
  const res = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "삭제환자", patientId },
    reservation: { reservationId: `R-DELREG-2-${Date.now()}`, name: "삭제환자", patientId, reservationDate: "2027-04-02", doctors: [], isDeleted: false },
  }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, "PATIENT_DELETED");

  // 환자 문서는 여전히 삭제 상태로 유지(자동 복구되지 않음)
  const pSnap = await adminDb.collection("patients").where("patientId", "==", patientId).get();
  assert.ok(pSnap.docs.every((d) => d.data().isDeleted === true));
});

test("create_patient: 삭제된 환자의 patientId로 재등록 시도 → 409 PATIENT_DELETED", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-DELREG-CP-${Date.now()}`;
  const c1 = await POST(makeReq(staff.idToken, "create_patient", { patient: { name: "삭제환자2", patientId } }));
  const c1b = await c1.json();
  createdPatientDocIds.push(c1b.patientDocId);

  await POST(makeReq(admin.idToken, "delete_patient", { patientId }));

  const res = await POST(makeReq(staff.idToken, "create_patient", { patient: { name: "삭제환자2", patientId } }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "PATIENT_DELETED");
});

test("create: 활성 환자의 patientId로 예약 추가 → 기존 정책대로 연결 성공", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-ACTIVE-${Date.now()}`;
  const c1 = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "활성환자", patientId },
    reservation: { reservationId: `R-ACT-1-${Date.now()}`, name: "활성환자", patientId, reservationDate: "2027-04-05", doctors: [], isDeleted: false },
  }));
  const c1b = await c1.json();
  createdReservationDocIds.push(c1b.reservationDocId);
  createdPatientDocIds.push(c1b.patientDocId);

  const c2 = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "활성환자", patientId },
    reservation: { reservationId: `R-ACT-2-${Date.now()}`, name: "활성환자", patientId, reservationDate: "2027-04-06", doctors: [], isDeleted: false },
  }));
  const c2b = await c2.json();
  assert.equal(c2b.success, true);
  assert.equal(c2b.linkedExistingPatient, true);
  createdReservationDocIds.push(c2b.reservationDocId);
});

test("create: 신규 patientId는 정상 생성된다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-NEW-${Date.now()}`;
  const res = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "신규환자", patientId },
    reservation: { reservationId: `R-NEW-${Date.now()}`, name: "신규환자", patientId, reservationDate: "2027-04-07", doctors: [], isDeleted: false },
  }));
  const body = await res.json();
  assert.equal(body.success, true);
  createdReservationDocIds.push(body.reservationDocId);
  createdPatientDocIds.push(body.patientDocId);
>>>>>>> claude/mobilecrm-integrity-stage-1-juvvki
});
