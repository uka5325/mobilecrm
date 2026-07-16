/**
 * Admin KPI 매출 조회: 역할 가드, 기간 필터, void 제외, 환자정보 비노출.
 * 실행: npm run test:api (Firestore + Auth 에뮬레이터 필요)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { __resetStaffCacheForTests } from "@/lib/apiAuth";
import { createTestUser, type TestUser } from "../helpers/testAuth";
import { POST } from "@/app/api/settlements/route";

function makeReq(idToken: string, payload: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/settlements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action: "sales_summary", payload }),
  });
}

let admin: TestUser;
let staff: TestUser;
const refs: DocumentReference[] = [];

before(async () => {
  admin = await createTestUser("sales-admin");
  staff = await createTestUser("sales-staff");
  const adminRef = adminDb.collection("staff").doc(admin.uid);
  const staffRef = adminDb.collection("staff").doc(staff.uid);
  refs.push(adminRef, staffRef);
  await adminRef.set({ role: "admin", active: true, displayName: "관리자" });
  await staffRef.set({ role: "staff", active: true, displayName: "직원" });

  const reservationRef = adminDb.collection("reservations").doc();
  refs.push(reservationRef);
  await reservationRef.set({
    patientId: "P-SALES-SECRET",
    name: "비노출환자",
    reservationDate: "2098-01-10",
    hospital: "테스트병원",
    appointmentType: "수술",
    consultArea: "눈재",
    doctors: ["김원장"],
    coordinators: ["박코디"],
    isDeleted: false,
  });

  const rows = [
    { direction: "payment", amount: 1000000, paymentMethod: "card", status: "active", isDeleted: false },
    { direction: "refund", amount: 100000, paymentMethod: "card", status: "active", isDeleted: false },
    { direction: "payment", amount: 999999, paymentMethod: "cash", status: "void", isDeleted: false },
  ];
  for (const row of rows) {
    const ref = adminDb.collection("settlements").doc();
    refs.push(ref);
    await ref.set({
      ...row,
      patientId: "P-SALES-SECRET",
      reservationDocId: reservationRef.id,
      paidAt: "2098-01-10",
      hospital: "테스트병원",
      appointmentType: "수술",
      consultArea: "눈재",
    });
  }
});

after(async () => {
  const batch = adminDb.batch();
  refs.forEach((ref) => batch.delete(ref));
  await batch.commit();
});

test("일반 직원은 KPI 매출을 조회할 수 없다", async () => {
  __resetStaffCacheForTests();
  const response = await POST(makeReq(staff.idToken, { startDate: "2098-01-01", endDate: "2098-01-31" }));
  assert.equal(response.status, 403);
});

test("Admin 매출 조회는 활성 결제·환불만 반환하고 환자정보를 노출하지 않는다", async () => {
  __resetStaffCacheForTests();
  const response = await POST(makeReq(admin.idToken, { startDate: "2098-01-01", endDate: "2098-01-31" }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.rows.length, 2);
  assert.deepEqual(body.rows.map((row: { amount: number }) => row.amount).sort((a: number, b: number) => a - b), [100000, 1000000]);
  assert.deepEqual(body.rows[0].doctors, ["김원장"]);
  assert.deepEqual(body.rows[0].coordinators, ["박코디"]);
  assert.ok(!("patientId" in body.rows[0]));
  assert.ok(!("reservationDocId" in body.rows[0]));
  assert.ok(!("name" in body.rows[0]));
});

test("Admin 매출 조회는 잘못된 기간을 거부한다", async () => {
  __resetStaffCacheForTests();
  const response = await POST(makeReq(admin.idToken, { startDate: "2098-02-01", endDate: "2098-01-01" }));
  assert.equal(response.status, 400);
});
