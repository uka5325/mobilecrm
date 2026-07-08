import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { GET } from "@/app/api/cron/reconcile-patient-summaries/route";
import { reconcileDirtyPatientBatch } from "@/lib/patientSummary";

const cleanupRefs: FirebaseFirestore.DocumentReference[] = [];
let previousCronSecret: string | undefined;

before(() => {
  previousCronSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-patient-summary-cron-secret";
});

after(async () => {
  if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousCronSecret;

  for (const ref of cleanupRefs.reverse()) {
    await ref.delete().catch(() => {});
  }
});

test("cron route: CRON_SECRET이 없거나 다르면 401을 반환한다", async () => {
  const req = new NextRequest("http://localhost/api/cron/reconcile-patient-summaries");
  const res = await GET(req);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.success, false);
});

test("cron route: dirty domain만 재계산하고 성공 시 dirty/lease 필드를 제거한다", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const patientId = `P-SUMMARY-CRON-${suffix}`;
  const patientRef = adminDb.collection("patients").doc(patientId);
  const reservationRef = adminDb.collection("reservations").doc();
  const invoiceRef = adminDb.collection("invoices").doc();
  cleanupRefs.push(patientRef, reservationRef, invoiceRef);

  await patientRef.set({
    patientId,
    name: "요약복구테스트",
    isDeleted: false,
    reservationCount: 77,
    invoiceCount: 0,
    hasInvoice: false,
    summaryDirty: true,
    summaryDirtyDomains: ["invoice"],
    summaryDirtyAt: new Date(),
    summaryDirtyVersion: 1,
  });
  await reservationRef.set({
    patientId,
    reservationId: `R-${suffix}`,
    reservationDate: "2026-12-01",
    reservationTime: "10:00",
    isDeleted: false,
  });
  await invoiceRef.set({
    patientId,
    invoiceId: `INV-${suffix}`,
    isDeleted: false,
  });

  const req = new NextRequest("http://localhost/api/cron/reconcile-patient-summaries", {
    headers: {
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
  });
  const res = await GET(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.reconciled >= 1);

  const patient = (await patientRef.get()).data();
  assert.equal(patient?.invoiceCount, 1);
  assert.equal(patient?.hasInvoice, true);
  assert.equal(patient?.reservationCount, 77, "invoice dirty는 예약 301건 재조회를 유발하지 않아야 한다");
  assert.equal(patient?.summaryDirty, undefined);
  assert.equal(patient?.summaryDirtyDomains, undefined);
  assert.equal(patient?.summaryReconcileLeaseOwner, undefined);
  assert.equal(patient?.summaryReconcileLeaseUntil, undefined);
  assert.ok(patient?.summaryReconcileLastSuccessAt);
});

test("worker: 활성 lease가 있는 dirty 환자는 중복 claim하지 않는다", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const patientId = `P-SUMMARY-LEASE-${suffix}`;
  const patientRef = adminDb.collection("patients").doc(patientId);
  cleanupRefs.push(patientRef);

  await patientRef.set({
    patientId,
    name: "lease테스트",
    isDeleted: false,
    summaryDirty: true,
    summaryDirtyDomains: ["invoice"],
    summaryDirtyAt: new Date(),
    summaryDirtyVersion: 1,
    summaryReconcileLeaseOwner: "another-worker",
    summaryReconcileLeaseUntil: new Date(Date.now() + 5 * 60 * 1000),
  });

  const result = await reconcileDirtyPatientBatch({
    limit: 5,
    workerId: `test-worker-${suffix}`,
  });

  const patient = (await patientRef.get()).data();
  assert.equal(patient?.summaryDirty, true);
  assert.equal(patient?.summaryReconcileLeaseOwner, "another-worker");
  assert.ok(result.deferred >= 1);
});
