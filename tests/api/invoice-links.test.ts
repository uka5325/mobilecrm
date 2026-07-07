import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/invoices-consistent/route";
import { adminDb } from "@/lib/firebaseAdmin";
import { __resetStaffCacheForTests } from "@/lib/apiAuth";
import { createTestUser, type TestUser } from "../helpers/testAuth";

function request(idToken: string, action: string, payload: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action, payload }),
  });
}

let admin: TestUser;
const cleanupRefs: FirebaseFirestore.DocumentReference[] = [];

before(async () => {
  admin = await createTestUser("invoice-link-admin");
  const staffRef = adminDb.collection("staff").doc(admin.uid);
  cleanupRefs.push(staffRef);
  await staffRef.set({
    uid: admin.uid,
    email: admin.email,
    role: "admin",
    active: true,
    displayName: "관리자",
  });
});

after(async () => {
  for (const ref of cleanupRefs.reverse()) {
    await ref.delete().catch(() => {});
  }
});

test("빈 reservationDocId 인보이스는 수정·삭제 시 명확한 409를 반환하고 변경하지 않는다", async () => {
  __resetStaffCacheForTests();
  const invoiceRef = adminDb.collection("invoices").doc();
  cleanupRefs.push(invoiceRef);
  await invoiceRef.set({
    invoiceId: `INV-EMPTY-${Date.now()}`,
    reservationDocId: "",
    reservationId: `R-EMPTY-${Date.now()}`,
    patientId: `P-EMPTY-${Date.now()}`,
    status: "draft",
    totalAmount: 100,
    isDeleted: false,
  });

  const updateResponse = await POST(request(admin.idToken, "update", {
    invoiceDocId: invoiceRef.id,
    hospitalName: "변경 병원",
    surgeryItems: "변경 항목",
    totalAmount: 999,
    status: "confirmed",
  }));
  const updateBody = await updateResponse.json();
  assert.equal(updateResponse.status, 409);
  assert.equal(updateBody.code, "INVOICE_RESERVATION_LINK_MISSING");
  assert.equal((await invoiceRef.get()).data()?.totalAmount, 100);

  const deleteResponse = await POST(request(admin.idToken, "delete", {
    invoiceDocId: invoiceRef.id,
  }));
  const deleteBody = await deleteResponse.json();
  assert.equal(deleteResponse.status, 409);
  assert.equal(deleteBody.code, "INVOICE_RESERVATION_LINK_MISSING");
  assert.equal((await invoiceRef.get()).data()?.isDeleted, false);
});

test("존재하지 않는 reservationDocId도 자동 fallback 없이 명확한 409를 반환한다", async () => {
  __resetStaffCacheForTests();
  const invoiceRef = adminDb.collection("invoices").doc();
  cleanupRefs.push(invoiceRef);
  await invoiceRef.set({
    invoiceId: `INV-DANGLING-${Date.now()}`,
    reservationDocId: `missing-reservation-${Date.now()}`,
    reservationId: `R-DANGLING-${Date.now()}`,
    patientId: `P-DANGLING-${Date.now()}`,
    status: "draft",
    totalAmount: 100,
    isDeleted: false,
  });

  const response = await POST(request(admin.idToken, "update", {
    invoiceDocId: invoiceRef.id,
    hospitalName: "병원",
    surgeryItems: "항목",
    totalAmount: 200,
  }));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "INVOICE_RESERVATION_LINK_MISSING");
  assert.equal((await invoiceRef.get()).data()?.totalAmount, 100);
});

test("인보이스와 예약의 patientId 또는 reservationId가 다르면 수정하지 않는다", async () => {
  __resetStaffCacheForTests();
  const reservationRef = adminDb.collection("reservations").doc();
  const invoiceRef = adminDb.collection("invoices").doc();
  cleanupRefs.push(reservationRef, invoiceRef);

  await reservationRef.set({
    reservationId: `R-MISMATCH-${Date.now()}`,
    patientId: `P-RES-${Date.now()}`,
    isDeleted: false,
  });
  await invoiceRef.set({
    invoiceId: `INV-MISMATCH-${Date.now()}`,
    reservationDocId: reservationRef.id,
    reservationId: `R-MISMATCH-${Date.now()}-OTHER`,
    patientId: `P-INV-${Date.now()}`,
    status: "draft",
    totalAmount: 100,
    isDeleted: false,
  });

  const response = await POST(request(admin.idToken, "update", {
    invoiceDocId: invoiceRef.id,
    hospitalName: "병원",
    surgeryItems: "항목",
    totalAmount: 200,
  }));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "INVOICE_RESERVATION_LINK_MISMATCH");
  assert.equal((await invoiceRef.get()).data()?.totalAmount, 100);
});

test("정상 양방향 링크는 수정과 삭제가 계속 원자적으로 동작한다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-VALID-${Date.now()}`;
  const reservationId = `R-VALID-${Date.now()}`;
  const invoiceId = `INV-VALID-${Date.now()}`;
  const reservationRef = adminDb.collection("reservations").doc();
  const invoiceRef = adminDb.collection("invoices").doc();
  cleanupRefs.push(reservationRef, invoiceRef);

  await reservationRef.set({
    reservationId,
    patientId,
    invoiceId,
    invoiceDocId: invoiceRef.id,
    invoiceStatus: "draft",
    isDeleted: false,
  });
  await invoiceRef.set({
    invoiceId,
    reservationDocId: reservationRef.id,
    reservationId,
    patientId,
    status: "draft",
    totalAmount: 100,
    isDeleted: false,
  });

  const updateResponse = await POST(request(admin.idToken, "update", {
    invoiceDocId: invoiceRef.id,
    hospitalName: "ARC",
    surgeryItems: "윤곽",
    surgeryDate: "2026-08-01",
    totalAmount: 300,
    status: "confirmed",
  }));
  const updateBody = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.equal(updateBody.success, true);
  assert.equal((await invoiceRef.get()).data()?.totalAmount, 300);
  assert.equal((await reservationRef.get()).data()?.invoiceStatus, "confirmed");

  const deleteResponse = await POST(request(admin.idToken, "delete", {
    invoiceDocId: invoiceRef.id,
  }));
  const deleteBody = await deleteResponse.json();
  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteBody.success, true);
  assert.equal((await invoiceRef.get()).data()?.isDeleted, true);
  assert.equal((await reservationRef.get()).data()?.invoiceDocId, "");
});
