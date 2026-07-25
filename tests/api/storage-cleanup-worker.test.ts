import { after, test } from "node:test";
import assert from "node:assert/strict";
import { adminDb } from "@/lib/firebaseAdmin";
import { runStorageCleanupBatch } from "@/features/photos/jobs/storageCleanupWorker";

const cleanupRefs: FirebaseFirestore.DocumentReference[] = [];

after(async () => {
  for (const ref of cleanupRefs.reverse()) {
    await ref.delete().catch(() => {});
  }
});

async function createCleanupJob(label: string, overrides: Record<string, unknown> = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ref = adminDb.collection("storageCleanupJobs").doc(`${label}-${suffix}`);
  cleanupRefs.push(ref);
  await ref.set({
    storagePath: `reservationFiles/test/photos/${label}-${suffix}.png`,
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  return ref;
}

test("storage cleanup worker: 삭제 성공 시 job을 deleted로 완료한다", async () => {
  const jobRef = await createCleanupJob("success");
  const deletedPaths: string[] = [];

  const result = await runStorageCleanupBatch({
    limit: 1,
    workerId: `success-${Date.now()}`,
    deleteObject: async (storagePath) => {
      deletedPaths.push(storagePath);
    },
  });

  const job = (await jobRef.get()).data();
  assert.equal(result.deleted, 1);
  assert.equal(deletedPaths.length, 1);
  assert.equal(job?.status, "deleted");
  assert.equal(job?.workerAttempts, 1);
  assert.equal(job?.leaseOwner, undefined);
  assert.ok(job?.deletedAt);
});

test("storage cleanup worker: 이미 없는 파일도 성공으로 처리한다", async () => {
  const jobRef = await createCleanupJob("not-found");

  const result = await runStorageCleanupBatch({
    limit: 1,
    workerId: `not-found-${Date.now()}`,
    deleteObject: async () => {
      throw Object.assign(new Error("not found"), { code: 404 });
    },
  });

  const job = (await jobRef.get()).data();
  assert.equal(result.deleted, 1);
  assert.equal(job?.status, "deleted");
});

test("storage cleanup worker: 일시 오류는 backoff와 함께 pending으로 되돌린다", async () => {
  const jobRef = await createCleanupJob("retry");

  const result = await runStorageCleanupBatch({
    limit: 1,
    workerId: `retry-${Date.now()}`,
    deleteObject: async () => {
      throw Object.assign(new Error("temporary"), { code: 503 });
    },
  });

  const job = (await jobRef.get()).data();
  assert.equal(result.retried, 1);
  assert.equal(job?.status, "pending");
  assert.equal(job?.lastErrorCode, "503");
  assert.ok(job?.nextAttemptAt);
  assert.equal(job?.leaseOwner, undefined);
});

test("storage cleanup worker: 권한 오류는 즉시 terminal failed로 종료한다", async () => {
  const jobRef = await createCleanupJob("terminal");

  const result = await runStorageCleanupBatch({
    limit: 1,
    workerId: `terminal-${Date.now()}`,
    deleteObject: async () => {
      throw Object.assign(new Error("forbidden"), { code: 403 });
    },
  });

  const job = (await jobRef.get()).data();
  assert.equal(result.failed, 1);
  assert.equal(job?.status, "failed");
  assert.equal(job?.lastErrorCode, "403");
  assert.ok(job?.failedAt);
});

test("storage cleanup worker: 동시 worker는 같은 job을 한 번만 삭제한다", async () => {
  const jobRef = await createCleanupJob("concurrent");
  let deleteCalls = 0;
  let releaseDelete: (() => void) | undefined;
  let notifyStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });

  const first = runStorageCleanupBatch({
    limit: 1,
    workerId: `concurrent-a-${Date.now()}`,
    deleteObject: async () => {
      deleteCalls += 1;
      notifyStarted?.();
      await release;
    },
  });
  await started;

  const second = await runStorageCleanupBatch({
    limit: 1,
    workerId: `concurrent-b-${Date.now()}`,
    deleteObject: async () => {
      deleteCalls += 1;
    },
  });
  releaseDelete?.();
  const firstResult = await first;

  const job = (await jobRef.get()).data();
  assert.equal(deleteCalls, 1);
  assert.equal(firstResult.deleted, 1);
  assert.equal(second.claimed, 0);
  assert.equal(job?.status, "deleted");
});
