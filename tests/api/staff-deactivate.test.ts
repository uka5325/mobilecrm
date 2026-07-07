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
  // tokensValidAfterTime은 초 단위 해상도라, 생성 직후 같은 초에 revoke하면 값이
  // 동일해져 assert.notEqual이 flaky해진다. 다음 초로 넘어갈 때까지 대기해 보장한다.
  await new Promise((r) => setTimeout(r, 1100));
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

test("토큰 revoke 실패 시 partial success로 표시한다(active:false는 유지)", async () => {
  __resetStaffCacheForTests();
  // Auth emulator에 대응하는 사용자가 없는 uid — revokeRefreshTokens가 실패하도록 유도.
  const ghostUid = `ghost-${Date.now()}`;
  await adminDb.collection("staff").doc(ghostUid).set({ role: "staff", active: true, displayName: "고스트" });

  const res = await POST(makeReq({ uid: ghostUid }, adminUser.idToken));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.partialSuccess, true);
  assert.equal(body.staffDeactivated, true);
  assert.equal(body.tokenRevoked, false);
  assert.equal(body.errorCode, "TOKEN_REVOKE_FAILED");

  // active:false 자체는 반영되어 유지된다(완전 실패로 롤백하지 않음).
  const snap = await adminDb.collection("staff").doc(ghostUid).get();
  assert.equal(snap.data()?.active, false);

  await adminDb.collection("staff").doc(ghostUid).delete().catch(() => {});
});
