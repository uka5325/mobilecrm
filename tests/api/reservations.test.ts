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
