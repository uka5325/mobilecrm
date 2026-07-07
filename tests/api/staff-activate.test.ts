/**
 * /api/staff/activate 라우트 테스트 — admin만 허용, active:true 전환.
 * (deactivate와 짝을 이루는 전용 API — active는 firestore.rules에서 client SDK 직접
 *  변경을 차단하므로 활성화도 반드시 이 서버 API를 거쳐야 한다.)
 *
 * 실행: npm run test:api (Firestore + Auth 에뮬레이터 필요)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebaseAdmin";
import { __resetStaffCacheForTests } from "@/lib/apiAuth";
import { createTestUser, bearer, type TestUser } from "../helpers/testAuth";
import { POST } from "@/app/api/staff/activate/route";

function makeReq(body: unknown, idToken?: string) {
  return new NextRequest("http://localhost/api/staff/activate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { authorization: bearer(idToken) } : {}),
    },
    body: JSON.stringify(body),
  });
}

let adminUser: TestUser;
let staffUser: TestUser;
let target: TestUser;

before(async () => {
  adminUser = await createTestUser("act-admin");
  staffUser = await createTestUser("act-staff");
  target = await createTestUser("act-target");
  await adminDb.collection("staff").doc(adminUser.uid).set({ role: "admin", active: true, displayName: "관리자" });
  await adminDb.collection("staff").doc(staffUser.uid).set({ role: "staff", active: true, displayName: "직원" });
  await adminDb.collection("staff").doc(target.uid).set({ role: "staff", active: false, displayName: "대상" });
});

after(async () => {
  for (const u of [adminUser, staffUser, target]) {
    await adminDb.collection("staff").doc(u.uid).delete().catch(() => {});
    await adminAuth.deleteUser(u.uid).catch(() => {});
  }
});

test("비-admin은 403", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq({ uid: target.uid }, staffUser.idToken));
  assert.equal(res.status, 403);
});

test("admin이 활성화하면 active:true + 성공", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq({ uid: target.uid }, adminUser.idToken));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);

  const snap = await adminDb.collection("staff").doc(target.uid).get();
  assert.equal(snap.data()?.active, true);
});

test("존재하지 않는 uid → 404", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq({ uid: "nonexistent-uid" }, adminUser.idToken));
  assert.equal(res.status, 404);
});
