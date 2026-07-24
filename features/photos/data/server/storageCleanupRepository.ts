import { createHash } from "node:crypto";
import { adminDb, adminStorage, FieldValue } from "@/lib/firebaseAdmin";
import {
  isAllowedStoragePath,
  STORAGE_CLEANUP_MAX_ATTEMPTS,
  storageCleanupErrorMessage,
  storageCleanupRetryDelayMs,
  storageDeleteErrorCode,
} from "@/features/photos/domain/storageCleanupPolicy";

const COLLECTION = "storageCleanupJobs";

function valueToMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function storageCleanupJobId(storagePath: string): string {
  return createHash("sha256").update(storagePath).digest("hex");
}

export async function deleteStorageObject(storagePath: string): Promise<void> {
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "";
  if (!bucketName) {
    const error = new Error("Firebase Storage bucket is not configured.");
    (error as Error & { code: string }).code = "STORAGE_BUCKET_NOT_CONFIGURED";
    throw error;
  }
  await adminStorage.bucket(bucketName).file(storagePath).delete();
}

export async function enqueueStorageCleanupJob(input: {
  storagePath: string;
  requestedByUid: string;
  requestedByName: string;
  reason: string;
  error: unknown;
}): Promise<string> {
  const jobId = storageCleanupJobId(input.storagePath);
  const jobRef = adminDb.collection(COLLECTION).doc(jobId);
  const existingJob = await jobRef.get();
  await jobRef.set({
    storagePath: input.storagePath,
    status: "pending",
    reason: input.reason,
    attempts: FieldValue.increment(1),
    lastError: storageCleanupErrorMessage(input.error),
    requestedByUid: input.requestedByUid,
    requestedByName: input.requestedByName,
    updatedAt: FieldValue.serverTimestamp(),
    nextAttemptAt: FieldValue.delete(),
    ...(existingJob.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  }, { merge: true });
  return jobId;
}

export type StorageCleanupCandidate = {
  id: string;
  storagePath: string;
};

export async function listPendingStorageCleanupJobs(limit: number): Promise<StorageCleanupCandidate[]> {
  const normalizedLimit = Math.min(Math.max(Math.floor(Number(limit) || 5), 1), 50);
  const snap = await adminDb
    .collection(COLLECTION)
    .where("status", "==", "pending")
    .limit(normalizedLimit)
    .get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    storagePath: String(doc.data().storagePath || ""),
  }));
}

export type StorageCleanupClaim =
  | {
      status: "claimed";
      jobId: string;
      storagePath: string;
      workerId: string;
      workerAttempts: number;
    }
  | { status: "deferred" }
  | { status: "invalid" };

export async function claimStorageCleanupJob(input: {
  jobId: string;
  workerId: string;
  leaseMs: number;
}): Promise<StorageCleanupClaim> {
  const jobRef = adminDb.collection(COLLECTION).doc(input.jobId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) return { status: "deferred" } as const;

    const data = snap.data() || {};
    if (data.status !== "pending") return { status: "deferred" } as const;

    const storagePath = String(data.storagePath || "");
    if (!isAllowedStoragePath(storagePath)) {
      tx.update(jobRef, {
        status: "failed",
        lastErrorCode: "INVALID_STORAGE_PATH",
        failedAt: new Date(),
        updatedAt: new Date(),
        leaseOwner: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
      });
      return { status: "invalid" } as const;
    }

    const nowMs = Date.now();
    if (String(data.leaseOwner || "") && valueToMillis(data.leaseUntil) > nowMs) {
      return { status: "deferred" } as const;
    }
    if (valueToMillis(data.nextAttemptAt) > nowMs) {
      return { status: "deferred" } as const;
    }

    const workerAttempts = Math.max(0, Number(data.workerAttempts || 0)) + 1;
    if (workerAttempts > STORAGE_CLEANUP_MAX_ATTEMPTS) {
      tx.update(jobRef, {
        status: "failed",
        lastErrorCode: "MAX_ATTEMPTS_EXCEEDED",
        failedAt: new Date(nowMs),
        updatedAt: new Date(nowMs),
        leaseOwner: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
      });
      return { status: "invalid" } as const;
    }

    tx.update(jobRef, {
      status: "processing",
      workerAttempts,
      leaseOwner: input.workerId,
      leaseUntil: new Date(nowMs + input.leaseMs),
      lastAttemptAt: new Date(nowMs),
      updatedAt: new Date(nowMs),
      nextAttemptAt: FieldValue.delete(),
    });
    return {
      status: "claimed",
      jobId: snap.id,
      storagePath,
      workerId: input.workerId,
      workerAttempts,
    } as const;
  });
}

export async function completeStorageCleanupJob(
  claim: Extract<StorageCleanupClaim, { status: "claimed" }>
): Promise<boolean> {
  const jobRef = adminDb.collection(COLLECTION).doc(claim.jobId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    const data = snap.data();
    if (!snap.exists || data?.status !== "processing" || data.leaseOwner !== claim.workerId) {
      return false;
    }
    const now = new Date();
    tx.update(jobRef, {
      status: "deleted",
      deletedAt: now,
      updatedAt: now,
      leaseOwner: FieldValue.delete(),
      leaseUntil: FieldValue.delete(),
      nextAttemptAt: FieldValue.delete(),
      lastErrorCode: FieldValue.delete(),
    });
    return true;
  });
}

export async function failStorageCleanupJob(
  claim: Extract<StorageCleanupClaim, { status: "claimed" }>,
  error: unknown,
  terminal: boolean
): Promise<boolean> {
  const jobRef = adminDb.collection(COLLECTION).doc(claim.jobId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    const data = snap.data();
    if (!snap.exists || data?.status !== "processing" || data.leaseOwner !== claim.workerId) {
      return false;
    }

    const nowMs = Date.now();
    tx.update(jobRef, {
      status: terminal ? "failed" : "pending",
      lastError: storageCleanupErrorMessage(error),
      lastErrorCode: storageDeleteErrorCode(error),
      lastAttemptAt: new Date(nowMs),
      updatedAt: new Date(nowMs),
      ...(terminal
        ? {
            failedAt: new Date(nowMs),
            nextAttemptAt: FieldValue.delete(),
          }
        : {
            nextAttemptAt: new Date(
              nowMs + storageCleanupRetryDelayMs(claim.workerAttempts)
            ),
          }),
      leaseOwner: FieldValue.delete(),
      leaseUntil: FieldValue.delete(),
    });
    return true;
  });
}
