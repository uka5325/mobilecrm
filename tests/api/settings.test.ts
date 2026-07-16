/**
 * /api/settings 라우트 테스트 — admin 전용 쓰기 가드(save_appointment_colors 등) +
 * 읽기 스모크 테스트.
 *
 * 실행: npm run test:api (Firestore + Auth 에뮬레이터 필요)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { DocumentReference } from "firebase-admin/firestore";
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

test("get_memos는 삭제 메모가 limit을 소비하지 않게 최신 활성 메모만 반환한다", async () => {
  const memoDate = "2099-12-31";
  const runId = `settings-memo-query-${Date.now()}`;
  const refs: DocumentReference[] = [];
  const batch = adminDb.batch();

  for (let index = 1; index <= 5; index += 1) {
    const ref = adminDb.collection("conferenceMemos").doc();
    refs.push(ref);
    batch.set(ref, {
      testRun: runId,
      memoDate,
      memoText: `active-${index}`,
      deleted: false,
      createdAt: index * 100,
    });
  }
  for (let index = 1; index <= 2; index += 1) {
    const ref = adminDb.collection("conferenceMemos").doc();
    refs.push(ref);
    batch.set(ref, {
      testRun: runId,
      memoDate,
      memoText: `deleted-${index}`,
      deleted: true,
      createdAt: 500 + index * 100,
    });
  }
  await batch.commit();

  try {
    __resetStaffCacheForTests();
    const response = await POST(makeReq(staff.idToken, "get_memos", { memoDate, limit: 3 }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(
      body.memos.map((memo: { memoText: string }) => memo.memoText),
      ["active-5", "active-4", "active-3"]
    );
  } finally {
    const cleanup = adminDb.batch();
    refs.forEach((ref) => cleanup.delete(ref));
    await cleanup.commit();
  }
});

test("get_memos는 잘못된 날짜를 거부한다", async () => {
  __resetStaffCacheForTests();
  const response = await POST(makeReq(staff.idToken, "get_memos", {
    memoDate: "2099-99-99",
    limit: 50,
  }));
  assert.equal(response.status, 400);
});

