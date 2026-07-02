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
