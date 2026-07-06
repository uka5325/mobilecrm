/**
 * /api/proxy-image 라우트 테스트 — 인증 가드 + 오픈 프록시 방어(도메인 화이트리스트).
 * 실제 Firebase Storage 다운로드가 필요한 성공 경로는 다루지 않는다.
 *
 * 실행: npm run test:api (Firestore + Auth 에뮬레이터 필요)
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { __resetStaffCacheForTests } from "@/lib/apiAuth";
import { createTestUser, bearer, type TestUser } from "../helpers/testAuth";
import { GET } from "@/app/api/proxy-image/route";

function makeReq(url: string | null, idToken?: string) {
  const target = new URL("http://localhost/api/proxy-image");
  if (url) target.searchParams.set("url", url);
  return new NextRequest(target, {
    headers: idToken ? { authorization: bearer(idToken) } : {},
  });
}

let activeStaff: TestUser;

before(async () => {
  activeStaff = await createTestUser("proxy-active");
  await adminDb.collection("staff").doc(activeStaff.uid).set({ role: "staff", active: true, displayName: "A" });
});

after(async () => {
  await adminDb.collection("staff").doc(activeStaff.uid).delete();
});

beforeEach(() => {
  __resetStaffCacheForTests();
});

test("토큰 없이 요청하면 401", async () => {
  const res = await GET(makeReq("https://firebasestorage.googleapis.com/x"));
  assert.equal(res.status, 401);
});

test("url 파라미터가 없으면 400", async () => {
  const res = await GET(makeReq(null, activeStaff.idToken));
  assert.equal(res.status, 400);
});

test("Firebase Storage 도메인이 아니면 400 (오픈 프록시 차단)", async () => {
  const res = await GET(makeReq("https://evil.example.com/steal", activeStaff.idToken));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "invalid url");
});

test("Firebase Storage지만 reservationFiles 경로가 아니면 400", async () => {
  const res = await GET(
    makeReq("https://firebasestorage.googleapis.com/v0/b/bkt/o/secret%2Ffile.png?alt=media", activeStaff.idToken)
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "invalid path");
});

// ── P0: checkRevoked — 폐기된 토큰/비활성 직원은 fresh 검사로 즉시 차단 ──────────
import { adminAuth } from "@/lib/firebaseAdmin";

test("refresh token을 revoke하면 이미 발급된(구) idToken으로도 401", async () => {
  const u = await createTestUser("proxy-revoke");
  await adminDb.collection("staff").doc(u.uid).set({ role: "staff", active: true, displayName: "R" });
  __resetStaffCacheForTests();

  // Firebase의 revoke 비교는 초 단위(auth_time < validSince)라, 토큰 발급과 같은 초에
  // revoke하면 아직 유효한 것으로 판정될 수 있다 — 최소 1초 이상 여유를 둔다.
  await new Promise((r) => setTimeout(r, 1100));
  await adminAuth.revokeRefreshTokens(u.uid);
  const res = await GET(makeReq("https://firebasestorage.googleapis.com/v0/b/bkt/o/reservationFiles%2Fx%2Fa.png", u.idToken));
  assert.equal(res.status, 401);

  await adminDb.collection("staff").doc(u.uid).delete();
  await adminAuth.deleteUser(u.uid).catch(() => {});
});

test("staff.active=false로 바뀌면(캐시 TTL 이내라도) fresh read로 즉시 403", async () => {
  const u = await createTestUser("proxy-inactive");
  await adminDb.collection("staff").doc(u.uid).set({ role: "staff", active: true, displayName: "I" });
  __resetStaffCacheForTests();

  // 첫 요청으로 staff 캐시를 데운 뒤, 곧바로 비활성화한다(checkRevoked:true면 캐시를 우회해야 함).
  await GET(makeReq("https://firebasestorage.googleapis.com/v0/b/bkt/o/reservationFiles%2Fx%2Fa.png", u.idToken));
  await adminDb.collection("staff").doc(u.uid).update({ active: false });

  const res = await GET(makeReq("https://firebasestorage.googleapis.com/v0/b/bkt/o/reservationFiles%2Fx%2Fa.png", u.idToken));
  assert.equal(res.status, 403);

  await adminDb.collection("staff").doc(u.uid).delete();
  await adminAuth.deleteUser(u.uid).catch(() => {});
});
