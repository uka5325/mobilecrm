/**
 * /api/reservation-notes read query tests.
 *
 * 실행: npm run test:api (Firestore + Auth 에뮬레이터 필요)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { __resetStaffCacheForTests } from "@/lib/apiAuth";
import { createTestUser, type TestUser } from "../helpers/testAuth";
import { POST } from "@/app/api/reservation-notes/route";

function makeReq(idToken: string, payload: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/reservation-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action: "read", payload }),
  });
}

let staff: TestUser;
const runId = `reservation-notes-query-${Date.now()}`;
const patientId = `P-${runId}`;
const reservationDocId = `DOC-${runId}`;
const reservationId = `R-${runId}`;

before(async () => {
  staff = await createTestUser("reservation-notes-query");
  await adminDb.collection("staff").doc(staff.uid).set({
    role: "staff",
    active: true,
    displayName: "메모 테스트",
  });

  const batch = adminDb.batch();
  for (let index = 1; index <= 5; index += 1) {
    const ref = adminDb.collection("reservationNotes").doc();
    batch.set(ref, {
      testRun: runId,
      patientId,
      reservationDocId,
      reservationId,
      memoText: `active-${index}`,
      isDeleted: false,
      createdAt: index * 100,
    });
  }
  for (let index = 1; index <= 2; index += 1) {
    const ref = adminDb.collection("reservationNotes").doc();
    batch.set(ref, {
      testRun: runId,
      patientId,
      reservationDocId,
      reservationId,
      memoText: `deleted-${index}`,
      isDeleted: true,
      createdAt: 500 + index * 100,
    });
  }
  batch.set(adminDb.collection("reservationNotes").doc(), {
    testRun: runId,
    patientId: `OTHER-${runId}`,
    reservationDocId: `DOC-FALLBACK-${runId}`,
    reservationId: `R-FALLBACK-${runId}`,
    memoText: "doc-fallback",
    isDeleted: false,
    createdAt: 200,
  });
  batch.set(adminDb.collection("reservationNotes").doc(), {
    testRun: runId,
    patientId: `OTHER-2-${runId}`,
    reservationDocId: `DOC-FALLBACK-2-${runId}`,
    reservationId: `R-FALLBACK-2-${runId}`,
    memoText: "reservation-fallback",
    isDeleted: false,
    createdAt: 300,
  });
  await batch.commit();
});

after(async () => {
  const snapshot = await adminDb.collection("reservationNotes").where("testRun", "==", runId).get();
  const batch = adminDb.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(adminDb.collection("staff").doc(staff.uid));
  await batch.commit();
});

test("삭제 메모는 limit을 소비하지 않고 최신 활성 메모를 반환한다", async () => {
  __resetStaffCacheForTests();
  const response = await POST(makeReq(staff.idToken, { patientId, limit: 3 }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(
    body.notes.map((note: { memoText: string }) => note.memoText),
    ["active-5", "active-4", "active-3"]
  );
});

test("reservationDocId fallback도 최신순 쿼리를 사용한다", async () => {
  __resetStaffCacheForTests();
  const response = await POST(makeReq(staff.idToken, {
    reservationDocId: `DOC-FALLBACK-${runId}`,
    limit: 10,
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.notes.length, 1);
  assert.equal(body.notes[0].memoText, "doc-fallback");
});

test("reservationId fallback도 최신순 쿼리를 사용한다", async () => {
  __resetStaffCacheForTests();
  const response = await POST(makeReq(staff.idToken, {
    reservationId: `R-FALLBACK-2-${runId}`,
    limit: 10,
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.notes.length, 1);
  assert.equal(body.notes[0].memoText, "reservation-fallback");
});
