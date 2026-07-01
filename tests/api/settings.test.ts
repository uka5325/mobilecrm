/**
 * /api/settings 라우트 테스트 — admin 전용 쓰기 가드(save_appointment_colors 등) +
 * 읽기 스모크 테스트.
 *
 * 실행: npm run test:api (Firestore + Auth 에뮬레이터 필요)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { __resetStaffCacheForTests } from "@/lib/apiAuth";
import { createTestUser, type TestUser } from "../helpers/testAuth";
import { POST } from "@/app/api/settings/route";

function makeReq(idToken: string, action: string, payload?: unknown) {
  return new NextRequest("http://localhost/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action, payload }),
  });
}

let admin: TestUser;
let staff: TestUser;

before(async () => {
  admin = await createTestUser("settings-admin");
  staff = await createTestUser("settings-staff");
  await adminDb.collection("staff").doc(admin.uid).set({ role: "admin", active: true, displayName: "관리자" });
  await adminDb.collection("staff").doc(staff.uid).set({ role: "staff", active: true, displayName: "직원" });
});

after(async () => {
  await adminDb.collection("staff").doc(admin.uid).delete();
  await adminDb.collection("staff").doc(staff.uid).delete();
});

test("일반 직원은 예약색상 설정을 저장할 수 없다 (403)", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(staff.idToken, "save_appointment_colors", { colors: { 상담: "#fff" } }));
  assert.equal(res.status, 403);
});

test("admin은 예약색상 설정을 저장할 수 있다", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(admin.idToken, "save_appointment_colors", { colors: { 상담: "#fff" }, updatedBy: "관리자" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);

  const snap = await adminDb.doc("appSettings/appointmentTypeColors").get();
  assert.deepEqual(snap.data()?.colors, { 상담: "#fff" });
});

test("get_staff_list는 활성 직원 누구나 조회 가능하다", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(staff.idToken, "get_staff_list"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.staff));
});
