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
