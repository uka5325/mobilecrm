/**
 * /api/import-sheet 라우트 테스트 — 인증 가드 + 입력 검증 분기.
 * 외부 구글시트 네트워크 호출이 필요한 성공 경로는 다루지 않는다(에뮬레이터만으로 검증 가능한 범위).
 *
 * 실행: npm run test:api (Firestore + Auth 에뮬레이터 필요)
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { __resetStaffCacheForTests } from "@/lib/apiAuth";
import { createTestUser, bearer, type TestUser } from "../helpers/testAuth";
import { POST } from "@/app/api/import-sheet/route";

function makeReq(body: unknown, idToken?: string) {
  return new NextRequest("http://localhost/api/import-sheet", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { authorization: bearer(idToken) } : {}),
    },
    body: JSON.stringify(body),
  });
}

let activeStaff: TestUser;
let inactiveStaff: TestUser;

before(async () => {
  activeStaff = await createTestUser("import-active");
  inactiveStaff = await createTestUser("import-inactive");
  await adminDb.collection("staff").doc(activeStaff.uid).set({ role: "staff", active: true, displayName: "A" });
  await adminDb.collection("staff").doc(inactiveStaff.uid).set({ role: "staff", active: false, displayName: "B" });
});

after(async () => {
  await adminDb.collection("staff").doc(activeStaff.uid).delete();
  await adminDb.collection("staff").doc(inactiveStaff.uid).delete();
});

beforeEach(() => {
  __resetStaffCacheForTests();
});

test("토큰 없이 요청하면 401", async () => {
  const res = await POST(makeReq({ url: "https://docs.google.com/spreadsheets/d/abc" }));
  assert.equal(res.status, 401);
});

test("비활성 직원 토큰이면 403", async () => {
  const res = await POST(makeReq({ url: "https://docs.google.com/spreadsheets/d/abc" }, inactiveStaff.idToken));
  assert.equal(res.status, 403);
});

test("활성 직원이지만 url이 없으면 400", async () => {
  const res = await POST(makeReq({}, activeStaff.idToken));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
});

test("활성 직원이지만 유효하지 않은 시트 URL이면 400", async () => {
  const res = await POST(makeReq({ url: "https://example.com/not-a-sheet" }, activeStaff.idToken));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.message, /유효한 구글시트/);
});
