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
    surgeryCost: "1000000",
    coordinatorUids: [coordA.uid],
    coordinators: ["코디A"],
    doctors: [],
    isDeleted: false,
  });
});

after(async () => {
  await adminDb.collection("staff").doc(admin.uid).delete();
  await adminDb.collection("staff").doc(coordA.uid).delete();
  await adminDb.collection("staff").doc(coordB.uid).delete();
  await adminDb.collection("reservations").doc(reservationDocId).delete();
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

test("담당 코디네이터는 update로 금액을 바꿀 수 있고 예약 문서도 트랜잭션으로 동기화된다", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(coordA.idToken, "update", { invoiceDocId, totalAmount: 2000000, status: "confirmed" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.invoice.totalAmount, 2000000);
  assert.equal(body.invoice.updatedByUid, coordA.uid);

  const resSnap = await adminDb.collection("reservations").doc(reservationDocId).get();
  assert.equal(resSnap.data()?.invoiceStatus, "confirmed");
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
});
