import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { __resetStaffCacheForTests } from "@/lib/apiAuth";
import { POST } from "@/app/api/reservations/route";
import { patientMutationJobId } from "@/lib/patientMutationJobs";
import { RESERVATION_LOCKS, lockIdForReservation } from "@/lib/reservationLocks";
import { createTestUser, type TestUser } from "../helpers/testAuth";

function makeReq(idToken: string, action: string, payload: unknown) {
  return new NextRequest("http://localhost/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action, payload }),
  });
}

let admin: TestUser;
let staff: TestUser;
const cleanupRefs: FirebaseFirestore.DocumentReference[] = [];

before(async () => {
  admin = await createTestUser("patient-job-admin");
  staff = await createTestUser("patient-job-staff");
  const adminRef = adminDb.collection("staff").doc(admin.uid);
  const staffRef = adminDb.collection("staff").doc(staff.uid);
  cleanupRefs.push(adminRef, staffRef);
  await adminRef.set({ role: "admin", active: true, displayName: "관리자" });
  await staffRef.set({ role: "staff", active: true, displayName: "직원" });
});

after(async () => {
  for (const ref of cleanupRefs.reverse()) {
    await ref.delete().catch(() => {});
  }
});

test("update_patient_profile: 환자와 활성 예약을 갱신하고 동일 요청 재호출은 중복 반영하지 않는다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-JOB-UP-${Date.now()}`;
  const patientRef = adminDb.collection("patients").doc(patientId);
  const activeRef = adminDb.collection("reservations").doc();
  const deletedRef = adminDb.collection("reservations").doc();
  const jobRef = adminDb.collection("patientUpdateJobs").doc(patientMutationJobId("update", patientId));
  const logRefPrefix = `patient-update-${jobRef.id}-`;
  cleanupRefs.push(patientRef, activeRef, deletedRef, jobRef);

  await patientRef.set({
    patientId,
    name: "수정 전",
    birth: "19900101",
    birthInput: "19900101",
    gender: "여",
    phone: "01000000000",
    nationality: "몽골",
    isDeleted: false,
  });
  await activeRef.set({
    patientId,
    reservationId: `R-UP-A-${Date.now()}`,
    name: "수정 전",
    patientName: "수정 전",
    reservationDate: "2026-09-01",
    doctors: [],
    isDeleted: false,
  });
  await deletedRef.set({
    patientId,
    reservationId: `R-UP-D-${Date.now()}`,
    name: "삭제 예약 원본",
    patientName: "삭제 예약 원본",
    reservationDate: "2026-09-02",
    doctors: [],
    isDeleted: true,
  });

  const payload = {
    patientId,
    patientPatch: {
      name: "수정 후",
      birth: "19900101",
      birthInput: "19900101",
      gender: "여",
      phone: "01011112222",
      nationality: "몽골",
    },
  };

  const first = await POST(makeReq(staff.idToken, "update_patient_profile", payload));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.success, true);
  assert.equal(firstBody.updatedPatients, 1);
  assert.equal(firstBody.updatedReservations, 1);

  assert.equal((await patientRef.get()).data()?.name, "수정 후");
  assert.equal((await activeRef.get()).data()?.patientName, "수정 후");
  assert.equal((await deletedRef.get()).data()?.patientName, "삭제 예약 원본");
  assert.equal((await jobRef.get()).data()?.status, "completed");

  const second = await POST(makeReq(staff.idToken, "update_patient_profile", payload));
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.success, true);
  assert.equal(secondBody.resumed, true);
  assert.equal(secondBody.updatedReservations, 1);

  const logs = await adminDb.collection("logs")
    .where("patientId", "==", patientId)
    .where("action", "==", "patient_update")
    .get();
  assert.equal(logs.size, 1);
  for (const log of logs.docs) {
    assert.ok(log.id.startsWith(logRefPrefix));
    cleanupRefs.push(log.ref);
  }
});

test("delete_patient: soft-delete 전에 활성·기삭제 예약 lock을 정리하고 재호출해도 로그가 중복되지 않는다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-JOB-DEL-${Date.now()}`;
  const patientRef = adminDb.collection("patients").doc(patientId);
  const activeRef = adminDb.collection("reservations").doc();
  const staleRef = adminDb.collection("reservations").doc();
  const jobRef = adminDb.collection("patientDeletionJobs").doc(patientMutationJobId("delete", patientId));
  cleanupRefs.push(patientRef, activeRef, staleRef, jobRef);

  const activeData = {
    patientId,
    reservationId: `R-DEL-A-${Date.now()}`,
    name: "삭제환자",
    reservationDate: "2026-10-01",
    reservationTime: "10:00",
    hospital: "ARC",
    appointmentType: "상담",
    doctors: ["원장A"],
    isDeleted: false,
    cancelled: false,
  };
  const staleData = {
    patientId,
    reservationId: `R-DEL-S-${Date.now()}`,
    name: "삭제환자",
    reservationDate: "2026-10-02",
    reservationTime: "11:00",
    hospital: "ARC",
    appointmentType: "상담",
    doctors: ["원장B"],
    isDeleted: true,
    cancelled: false,
  };

  await patientRef.set({ patientId, name: "삭제환자", isDeleted: false });
  await activeRef.set(activeData);
  await staleRef.set(staleData);

  const activeLockId = lockIdForReservation(activeData);
  const staleLockId = lockIdForReservation(staleData);
  const activeLockRef = adminDb.collection(RESERVATION_LOCKS).doc(activeLockId);
  const staleLockRef = adminDb.collection(RESERVATION_LOCKS).doc(staleLockId);
  cleanupRefs.push(activeLockRef, staleLockRef);
  await activeLockRef.set({ reservationDocId: activeRef.id, patientId });
  await staleLockRef.set({ reservationDocId: staleRef.id, patientId });

  const first = await POST(makeReq(admin.idToken, "delete_patient", { patientId }));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.success, true);
  assert.equal(firstBody.deletedReservations, 1);
  assert.equal(firstBody.deletedPatients, 1);
  assert.equal(firstBody.deletedLocks, 2);

  assert.equal((await activeLockRef.get()).exists, false);
  assert.equal((await staleLockRef.get()).exists, false);
  assert.equal((await activeRef.get()).data()?.isDeleted, true);
  assert.equal((await staleRef.get()).data()?.isDeleted, true);
  assert.equal((await patientRef.get()).data()?.isDeleted, true);
  assert.equal((await jobRef.get()).data()?.status, "completed");

  const second = await POST(makeReq(admin.idToken, "delete_patient", { patientId }));
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.success, true);
  assert.equal(secondBody.resumed, true);
  assert.equal(secondBody.deletedLocks, 2);

  const logs = await adminDb.collection("logs")
    .where("patientId", "==", patientId)
    .where("action", "==", "patient_delete")
    .get();
  assert.equal(logs.size, 1);
  for (const log of logs.docs) cleanupRefs.push(log.ref);
});
