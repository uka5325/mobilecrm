/**
 * /api/staff/create 라우트 테스트 — 호출자 신원 검증 + admin 재확인 + role 화이트리스트.
 *
 * 실행: npm run test:api (Firestore + Auth 에뮬레이터 필요)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebaseAdmin";
import { createTestUser, bearer, type TestUser } from "../helpers/testAuth";
import { POST } from "@/app/api/staff/create/route";

function makeReq(body: unknown, idToken?: string) {
  return new NextRequest("http://localhost/api/staff/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { authorization: bearer(idToken) } : {}),
    },
    body: JSON.stringify(body),
  });
}

let adminUser: TestUser;
let nonAdminUser: TestUser;
const createdUids: string[] = [];

before(async () => {
  adminUser = await createTestUser("staffcreate-admin");
  nonAdminUser = await createTestUser("staffcreate-nonadmin");
  await adminDb.collection("staff").doc(adminUser.uid).set({ role: "admin", active: true, displayName: "관리자" });
  await adminDb.collection("staff").doc(nonAdminUser.uid).set({ role: "staff", active: true, displayName: "직원" });
});

after(async () => {
  await adminDb.collection("staff").doc(adminUser.uid).delete();
  await adminDb.collection("staff").doc(nonAdminUser.uid).delete();
  for (const uid of createdUids) {
    await adminDb.collection("staff").doc(uid).delete().catch(() => {});
    await adminAuth.deleteUser(uid).catch(() => {});
  }
});

test("Authorization 헤더가 없으면 401", async () => {
  const res = await POST(makeReq({ email: "x@example.com", password: "abcdef", displayName: "X", role: "staff" }));
  assert.equal(res.status, 401);
});

test("admin이 아닌 호출자는 403", async () => {
  const res = await POST(
    makeReq(
      { email: `nope${Date.now()}@example.com`, password: "abcdef", displayName: "X", role: "staff" },
      nonAdminUser.idToken
    )
  );
  assert.equal(res.status, 403);
});

test("허용되지 않은 role이면 400", async () => {
  const res = await POST(
    makeReq(
      { email: `bad${Date.now()}@example.com`, password: "abcdef", displayName: "X", role: "doctor" },
      adminUser.idToken
    )
  );
  assert.equal(res.status, 400);
});

test("admin 호출자가 유효한 데이터로 생성하면 성공하고 staff 문서가 생긴다", async () => {
  const email = `newstaff${Date.now()}@example.com`;
  const res = await POST(
    makeReq({ email, password: "abcdef", displayName: "신규직원", role: "coordinator" }, adminUser.idToken)
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  createdUids.push(body.uid);

  const staffDoc = await adminDb.collection("staff").doc(body.uid).get();
  assert.equal(staffDoc.data()?.role, "coordinator");
  assert.equal(staffDoc.data()?.active, true);
});
