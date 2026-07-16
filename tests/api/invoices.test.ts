/**
 * /api/invoices 라우트 테스트 — 코디네이터 스코프 권한(uid 우선), 소프트삭제,
 * 생성/수정/삭제 시 신원 강제, 트랜잭션 업데이트 경로.
 *
 * 실행: npm run test:api (Firestore + Auth 에뮬레이터 필요)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { __resetStaffCacheForTests } from "@/lib/apiAuth";
import { createTestUser, type TestUser } from "../helpers/testAuth";
import { POST } from "@/app/api/invoices/route";

function makeReq(idToken: string, action: string, payload: unknown) {
  return new NextRequest("http://localhost/api/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action, payload }),
  });
}

let admin: TestUser;
let coordA: TestUser;
let coordB: TestUser;
let reservationDocId: string;
let settlementDocId: string;

before(async () => {
  admin = await createTestUser("inv-admin");
  coordA = await createTestUser("inv-coordA");
  coordB = await createTestUser("inv-coordB");
  await adminDb.collection("staff").doc(admin.uid).set({ role: "admin", active: true, displayName: "관리자" });
  await adminDb.collection("staff").doc(coordA.uid).set({ role: "coordinator", active: true, displayName: "코디A" });
  await adminDb.collection("staff").doc(coordB.uid).set({ role: "coordinator", active: true, displayName: "코디B" });

  const resRef = adminDb.collection("reservations").doc();
  reservationDocId = resRef.id;
  await resRef.set({
    reservationId: "R-TEST-1",
    name: "홍길동",
    patientId: "P-TEST-1",
    reservationDate: "2026-07-01",
    coordinatorUids: [coordA.uid],
    coordinators: ["코디A"],
    doctors: [],
    isDeleted: false,
  });
  const settlementRef = adminDb.collection("settlements").doc();
  settlementDocId = settlementRef.id;
  await settlementRef.set({
    reservationDocId,
    reservationId: "R-TEST-1",
    patientId: "P-TEST-1",
    direction: "payment",
    amount: 1000000,
    paymentMethod: "cash",
    status: "active",
    paidAt: "2026-07-01",
    isDeleted: false,
  });

  // 고객관리 요약 재계산 대상 patients 문서(없으면 recompute가 no-op).
  await adminDb.collection("patients").doc("P-TEST-1").set({ patientId: "P-TEST-1", name: "홍길동", isDeleted: false });
});

after(async () => {
  await adminDb.collection("staff").doc(admin.uid).delete();
  await adminDb.collection("staff").doc(coordA.uid).delete();
  await adminDb.collection("staff").doc(coordB.uid).delete();
  await adminDb.collection("reservations").doc(reservationDocId).delete();
  await adminDb.collection("settlements").doc(settlementDocId).delete().catch(() => {});
  await adminDb.collection("patients").doc("P-TEST-1").delete().catch(() => {});
});

test("담당 코디네이터가 아니면 인보이스 생성이 403", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(coordB.idToken, "create", { reservationDocId }));
  assert.equal(res.status, 403);
});

let invoiceDocId: string;

test("담당 코디네이터는 인보이스를 생성할 수 있고 신원이 서버에서 강제된다", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(coordA.idToken, "create", { reservationDocId }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.invoice.createdByUid, coordA.uid);
  assert.equal(body.invoice.totalAmount, 1000000);
  invoiceDocId = body.invoice.id;

  // 인보이스 생성 시 patients 요약(invoiceCount/hasInvoice)이 재계산된다
  const pat = (await adminDb.collection("patients").doc("P-TEST-1").get()).data()!;
  assert.equal(pat.invoiceCount, 1);
  assert.equal(pat.hasInvoice, true);
});

test("비담당 코디네이터는 get_by_reservation에서 invoice를 볼 수 없다", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(coordB.idToken, "get_by_reservation", { reservationDocId }));
  const body = await res.json();
  assert.equal(body.invoice, null);
});

test("담당 코디네이터는 get_by_reservation에서 invoice를 볼 수 있다", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(coordA.idToken, "get_by_reservation", { reservationDocId }));
  const body = await res.json();
  assert.equal(body.invoice.id, invoiceDocId);
});

test("비담당 코디네이터는 update가 403", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(coordB.idToken, "update", { invoiceDocId, totalAmount: 999 }));
  assert.equal(res.status, 403);
});

test("정산이 있으면 update 시 정산 금액을 유지하고 예약 문서도 트랜잭션으로 동기화된다", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(coordA.idToken, "update", { invoiceDocId, totalAmount: 2000000, status: "confirmed" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.invoice.totalAmount, 1000000);
  assert.equal(body.invoice.updatedByUid, coordA.uid);

  const resSnap = await adminDb.collection("reservations").doc(reservationDocId).get();
  assert.equal(resSnap.data()?.invoiceStatus, "confirmed");
});

test("update: 허용되지 않은 status 값은 400으로 거부된다", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(coordA.idToken, "update", { invoiceDocId, totalAmount: 100, status: "paid" }));
  assert.equal(res.status, 400);
  // 거부 시 기존 status(confirmed)가 유지되어야 한다
  const snap = await adminDb.collection("invoices").doc(invoiceDocId).get();
  assert.equal(snap.data()?.status, "confirmed");
});

test("list: admin은 전체를, coordinator는 본인 담당분만 본다", async () => {
  __resetStaffCacheForTests();
  const asAdmin = await (await POST(makeReq(admin.idToken, "list", {}))).json();
  assert.ok(asAdmin.invoices.some((inv: { id: string }) => inv.id === invoiceDocId));

  const asCoordB = await (await POST(makeReq(coordB.idToken, "list", {}))).json();
  assert.ok(!asCoordB.invoices.some((inv: { id: string }) => inv.id === invoiceDocId));
});

test("담당 코디네이터는 인보이스를 삭제(소프트)할 수 있고 예약 연결이 해제된다", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(coordA.idToken, "delete", { invoiceDocId }));
  assert.equal(res.status, 200);

  const invSnap = await adminDb.collection("invoices").doc(invoiceDocId).get();
  assert.equal(invSnap.data()?.isDeleted, true);

  const resSnap = await adminDb.collection("reservations").doc(reservationDocId).get();
  assert.equal(resSnap.data()?.invoiceId, "");

  // 인보이스 삭제 시 patients 요약이 0으로 재계산된다
  const pat = (await adminDb.collection("patients").doc("P-TEST-1").get()).data()!;
  assert.equal(pat.invoiceCount, 0);
  assert.equal(pat.hasInvoice, false);
});

test("삭제된 인보이스는 update가 400(INVOICE_DELETED)으로 거부된다", async () => {
  __resetStaffCacheForTests();
  // 앞 테스트에서 invoiceDocId는 이미 soft delete된 상태.
  const res = await POST(makeReq(coordA.idToken, "update", { invoiceDocId, totalAmount: 123 }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, "INVOICE_DELETED");
  // 부활되지 않았는지 확인
  const snap = await adminDb.collection("invoices").doc(invoiceDocId).get();
  assert.equal(snap.data()?.isDeleted, true);
});

test("update에 isDeleted를 보내면 400(DISALLOWED_FIELD)으로 거부된다", async () => {
  __resetStaffCacheForTests();
  // 살아있는 인보이스가 필요 → 새 예약+인보이스 생성.
  const resRef = adminDb.collection("reservations").doc();
  await resRef.set({
    reservationId: `R-INVDEL-${Date.now()}`, name: "삭제필드", patientId: "P-TEST-1",
    reservationDate: "2026-07-02",
    coordinatorUids: [coordA.uid], coordinators: ["코디A"], doctors: [], isDeleted: false,
  });
  const created = await POST(makeReq(coordA.idToken, "create", { reservationDocId: resRef.id }));
  const liveInvoiceDocId = (await created.json()).invoice.id;

  const res = await POST(makeReq(coordA.idToken, "update", { invoiceDocId: liveInvoiceDocId, isDeleted: false, totalAmount: 1 }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "DISALLOWED_FIELD");

  await adminDb.collection("invoices").doc(liveInvoiceDocId).delete().catch(() => {});
  await resRef.delete().catch(() => {});
});
