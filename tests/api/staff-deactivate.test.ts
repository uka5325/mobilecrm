/**
 * /api/staff/deactivate 라우트 테스트 — admin만 허용, active:false 전환 + refresh token revoke.
 *
 * 실행: npm run test:api (Firestore + Auth 에뮬레이터 필요)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebaseAdmin";
import { __resetStaffCacheForTests } from "@/lib/apiAuth";
import { createTestUser, bearer, type TestUser } from "../helpers/testAuth";
import { POST } from "@/app/api/staff/deactivate/route";

function makeReq(body: unknown, idToken?: string) {
  return new NextRequest("http://localhost/api/staff/deactivate", {
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
  adminUser = await createTestUser("deact-admin");
  staffUser = await createTestUser("deact-staff");
  target = await createTestUser("deact-target");
  await adminDb.collection("staff").doc(adminUser.uid).set({ role: "admin", active: true, displayName: "관리자" });
  await adminDb.collection("staff").doc(staffUser.uid).set({ role: "staff", active: true, displayName: "직원" });
  await adminDb.collection("staff").doc(target.uid).set({ role: "staff", active: true, displayName: "대상" });
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

test("admin이 비활성화하면 active:false + 토큰 revoke + 성공", async () => {
  __resetStaffCacheForTests();
  const before = (await adminAuth.getUser(target.uid)).tokensValidAfterTime;
  const res = await POST(makeReq({ uid: target.uid }, adminUser.idToken));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.tokenRevoked, true);

  // staff 문서가 active:false로 유지된다
  const snap = await adminDb.collection("staff").doc(target.uid).get();
  assert.equal(snap.data()?.active, false);

  // refresh token revoke로 tokensValidAfterTime이 갱신된다
  const after = (await adminAuth.getUser(target.uid)).tokensValidAfterTime;
  assert.notEqual(after, before);
});

test("본인 계정은 비활성화할 수 없다 (400)", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq({ uid: adminUser.uid }, adminUser.idToken));
  assert.equal(res.status, 400);
});
