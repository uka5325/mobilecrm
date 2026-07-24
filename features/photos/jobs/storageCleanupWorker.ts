import { randomUUID } from "node:crypto";
import {
  claimStorageCleanupJob,
  completeStorageCleanupJob,
  deleteStorageObject,
  failStorageCleanupJob,
  listPendingStorageCleanupJobs,
} from "@/features/photos/data/server";
import {
  isRetryableStorageDeleteError,
  isStorageObjectNotFound,
  STORAGE_CLEANUP_LEASE_MS,
  STORAGE_CLEANUP_MAX_ATTEMPTS,
} from "@/features/photos/domain/storageCleanupPolicy";

export type StorageCleanupBatchResult = {
  workerId: string;
  scanned: number;
  claimed: number;
  deleted: number;
  retried: number;
  failed: number;
  invalid: number;
  deferred: number;
  lost: number;
};

export async function runStorageCleanupBatch(
  options: {
    limit?: number;
    workerId?: string;
    leaseMs?: number;
    deleteObject?: (storagePath: string) => Promise<void>;
  } = {}
): Promise<StorageCleanupBatchResult> {
  const limit = Math.min(Math.max(Math.floor(Number(options.limit) || 5), 1), 20);
  const workerId = options.workerId || `storage-cleanup-${randomUUID()}`;
  const leaseMs = Math.max(Number(options.leaseMs) || STORAGE_CLEANUP_LEASE_MS, 30_000);
  const deleteObject = options.deleteObject || deleteStorageObject;
  const candidates = await listPendingStorageCleanupJobs(
    Math.min(Math.max(limit * 3, limit), 50)
  );

  const result: StorageCleanupBatchResult = {
    workerId,
    scanned: candidates.length,
    claimed: 0,
    deleted: 0,
    retried: 0,
    failed: 0,
    invalid: 0,
    deferred: 0,
    lost: 0,
  };

  for (const candidate of candidates) {
    if (result.claimed >= limit) break;
    const claim = await claimStorageCleanupJob({
      jobId: candidate.id,
      workerId,
      leaseMs,
    });
    if (claim.status === "deferred") {
      result.deferred += 1;
      continue;
    }
    if (claim.status === "invalid") {
      result.invalid += 1;
      continue;
    }

    result.claimed += 1;
    try {
      await deleteObject(claim.storagePath);
      const completed = await completeStorageCleanupJob(claim);
      if (completed) result.deleted += 1;
      else result.lost += 1;
    } catch (error) {
      if (isStorageObjectNotFound(error)) {
        const completed = await completeStorageCleanupJob(claim);
        if (completed) result.deleted += 1;
        else result.lost += 1;
        continue;
      }

      const terminal = claim.workerAttempts >= STORAGE_CLEANUP_MAX_ATTEMPTS
        || !isRetryableStorageDeleteError(error);
      const released = await failStorageCleanupJob(claim, error, terminal);
      if (!released) result.lost += 1;
      else if (terminal) result.failed += 1;
      else result.retried += 1;
    }
  }

  return result;
}
