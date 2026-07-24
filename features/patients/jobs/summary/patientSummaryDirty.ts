import { randomUUID } from "node:crypto";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import {
  normalizeSummaryDomains,
  summaryRetryDelayMs,
  type SummaryDomain,
} from "@/features/patients/domain/patientSummaryPolicy";
import { recomputeReservationSummary } from "./patientSummaryReservations";
import { recomputeInvoiceSummary, recomputeMemoSummary } from "./patientSummaryDomains";

// dirty 표시(recompute 실패 시) + Cron/관리 worker(dirty 환자 요약 재조정).
// recompute-on-write가 실패하면 patients 문서에 summaryDirty 플래그를 남기고,
// worker가 lease 기반으로 claim → 도메인 recompute → complete/fail로 마무리한다.

const DEFAULT_RECONCILE_LEASE_MS = 5 * 60 * 1000;

function inferDomain(label: string): SummaryDomain {
  if (label.includes("invoice")) return "invoice";
  if (label.includes("memo")) return "memo";
  return "reservation";
}

// 호출부에서 사용하는 best-effort 래퍼.
export async function safeRecompute(
  fn: () => Promise<void>,
  label: string,
  patientId?: string,
  domain: SummaryDomain = inferDomain(label)
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn(`[patientSummary] SUMMARY_RECOMPUTE_FAILED (${label}):`, e instanceof Error ? e.message : String(e));
    if (patientId) {
      try {
        await markSummaryDirty(patientId, domain, label);
      } catch {
        // dirty 플래그 기록 실패도 핵심 mutation을 되돌리지 않는다.
      }
    }
  }
}

async function markSummaryDirty(patientId: string, domain: SummaryDomain, label: string): Promise<void> {
  if (!patientId) return;
  const snap = await adminDb.collection("patients").where("patientId", "==", patientId).get();
  if (snap.empty) return;
  const batch = adminDb.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, {
      summaryDirty: true,
      summaryDirtyDomains: FieldValue.arrayUnion(domain),
      summaryDirtyAt: FieldValue.serverTimestamp(),
      summaryDirtyVersion: FieldValue.increment(1),
      summaryDirtyLastError: label,
      // 새 실패는 이전 backoff보다 우선한다. 다음 worker 실행에서 즉시 claim 가능하게 한다.
      summaryReconcileNextAttemptAt: FieldValue.delete(),
    });
  }
  await batch.commit();
}

function valueToMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function errorCode(error: unknown): string {
  const raw =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code: string }).code)
      : error instanceof Error
        ? error.name || "ERROR"
        : "UNKNOWN";
  return raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80) || "UNKNOWN";
}

type ClaimToken = {
  version: number;
  dirtyAtMs: number;
};

type DirtyPatientClaim = {
  patientId: string;
  workerId: string;
  domains: SummaryDomain[];
  attempts: number;
  tokens: Record<string, ClaimToken>;
};

export type DirtySummaryBatchResult = {
  workerId: string;
  scanned: number;
  invalid: number;
  claimed: number;
  reconciled: number;
  stale: number;
  failed: number;
  deferred: number;
  lost: number;
};

async function claimDirtyPatient(
  patientId: string,
  workerId: string,
  leaseMs: number
): Promise<DirtyPatientClaim | null> {
  return adminDb.runTransaction(async (tx) => {
    const query = adminDb.collection("patients").where("patientId", "==", patientId);
    const snap = await tx.get(query);
    const dirtyDocs = snap.docs.filter((doc) => doc.data().summaryDirty === true);
    if (!dirtyDocs.length) return null;

    const nowMs = Date.now();
    const hasActiveLease = dirtyDocs.some((doc) => {
      const data = doc.data();
      return Boolean(data.summaryReconcileLeaseOwner) && valueToMillis(data.summaryReconcileLeaseUntil) > nowMs;
    });
    if (hasActiveLease) return null;

    const nextAttemptAt = Math.max(
      0,
      ...dirtyDocs.map((doc) => valueToMillis(doc.data().summaryReconcileNextAttemptAt))
    );
    if (nextAttemptAt > nowMs) return null;

    const domains = normalizeSummaryDomains(
      dirtyDocs.flatMap((doc) => {
        const value = doc.data().summaryDirtyDomains;
        return Array.isArray(value) ? value : [];
      })
    );
    const attempts = Math.max(
      0,
      ...dirtyDocs.map((doc) => Number(doc.data().summaryReconcileAttempts || 0))
    ) + 1;
    const tokens: Record<string, ClaimToken> = {};

    for (const doc of dirtyDocs) {
      const data = doc.data();
      tokens[doc.id] = {
        version: Number(data.summaryDirtyVersion || 0),
        dirtyAtMs: valueToMillis(data.summaryDirtyAt),
      };
      tx.update(doc.ref, {
        summaryReconcileLeaseOwner: workerId,
        summaryReconcileLeaseUntil: new Date(nowMs + leaseMs),
        summaryReconcileAttempts: attempts,
        summaryReconcileLastAttemptAt: new Date(nowMs),
        summaryReconcileNextAttemptAt: FieldValue.delete(),
        summaryReconcileLastErrorCode: FieldValue.delete(),
      });
    }

    return { patientId, workerId, domains, attempts, tokens };
  });
}

async function recomputeClaimDomains(claim: DirtyPatientClaim): Promise<void> {
  // 같은 patients 문서를 갱신하므로 동시 Promise.all 대신 순차 처리해 contention을 줄인다.
  for (const domain of claim.domains) {
    if (domain === "reservation") await recomputeReservationSummary(claim.patientId);
    if (domain === "invoice") await recomputeInvoiceSummary(claim.patientId);
    if (domain === "memo") await recomputeMemoSummary(claim.patientId);
  }
}

async function completeDirtyClaim(
  claim: DirtyPatientClaim
): Promise<"reconciled" | "stale" | "lost"> {
  return adminDb.runTransaction(async (tx) => {
    const query = adminDb.collection("patients").where("patientId", "==", claim.patientId);
    const snap = await tx.get(query);
    const claimedDocs = snap.docs.filter(
      (doc) => String(doc.data().summaryReconcileLeaseOwner || "") === claim.workerId
    );
    if (!claimedDocs.length) return "lost" as const;

    const changedDuringRun = snap.docs.some((doc) => {
      const data = doc.data();
      if (data.summaryDirty !== true) return false;
      const token = claim.tokens[doc.id];
      if (!token) return true;
      return (
        Number(data.summaryDirtyVersion || 0) !== token.version ||
        valueToMillis(data.summaryDirtyAt) !== token.dirtyAtMs
      );
    });

    if (changedDuringRun) {
      for (const doc of claimedDocs) {
        tx.update(doc.ref, {
          summaryReconcileLeaseOwner: FieldValue.delete(),
          summaryReconcileLeaseUntil: FieldValue.delete(),
          summaryReconcileNextAttemptAt: FieldValue.delete(),
        });
      }
      return "stale" as const;
    }

    const now = new Date();
    for (const doc of claimedDocs) {
      tx.update(doc.ref, {
        summaryDirty: FieldValue.delete(),
        summaryDirtyDomains: FieldValue.delete(),
        summaryDirtyAt: FieldValue.delete(),
        summaryDirtyVersion: FieldValue.delete(),
        summaryDirtyLastError: FieldValue.delete(),
        summaryReconcileLeaseOwner: FieldValue.delete(),
        summaryReconcileLeaseUntil: FieldValue.delete(),
        summaryReconcileAttempts: FieldValue.delete(),
        summaryReconcileLastAttemptAt: FieldValue.delete(),
        summaryReconcileNextAttemptAt: FieldValue.delete(),
        summaryReconcileLastErrorCode: FieldValue.delete(),
        summaryReconcileLastSuccessAt: now,
      });
    }
    return "reconciled" as const;
  });
}

async function failDirtyClaim(claim: DirtyPatientClaim, error: unknown): Promise<void> {
  await adminDb.runTransaction(async (tx) => {
    const query = adminDb.collection("patients").where("patientId", "==", claim.patientId);
    const snap = await tx.get(query);
    const nowMs = Date.now();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (String(data.summaryReconcileLeaseOwner || "") !== claim.workerId) continue;
      const attempts = Math.max(claim.attempts, Number(data.summaryReconcileAttempts || 0));
      tx.update(doc.ref, {
        summaryReconcileLeaseOwner: FieldValue.delete(),
        summaryReconcileLeaseUntil: FieldValue.delete(),
        summaryReconcileLastAttemptAt: new Date(nowMs),
        summaryReconcileNextAttemptAt: new Date(nowMs + summaryRetryDelayMs(attempts)),
        summaryReconcileLastErrorCode: errorCode(error),
      });
    }
  });
}

// Cron/관리 worker용. 목록 API와 분리해 페이지 진입 비용과 복구 비용을 연결하지 않는다.
export async function reconcileDirtyPatientBatch(
  options: { limit?: number; workerId?: string; leaseMs?: number } = {}
): Promise<DirtySummaryBatchResult> {
  const limit = Math.min(Math.max(Math.floor(Number(options.limit) || 5), 1), 20);
  const workerId = options.workerId || `summary-${randomUUID()}`;
  const leaseMs = Math.max(Number(options.leaseMs) || DEFAULT_RECONCILE_LEASE_MS, 30_000);
  const scanLimit = Math.min(Math.max(limit * 3, limit), 50);
  const snap = await adminDb
    .collection("patients")
    .where("summaryDirty", "==", true)
    .limit(scanLimit)
    .get();

  const result: DirtySummaryBatchResult = {
    workerId,
    scanned: snap.size,
    invalid: 0,
    claimed: 0,
    reconciled: 0,
    stale: 0,
    failed: 0,
    deferred: 0,
    lost: 0,
  };

  const patientIds: string[] = [];
  const seen = new Set<string>();
  for (const doc of snap.docs) {
    const patientId = String(doc.data().patientId || "");
    if (!patientId) {
      result.invalid += 1;
      continue;
    }
    if (!seen.has(patientId)) {
      seen.add(patientId);
      patientIds.push(patientId);
    }
  }

  for (const patientId of patientIds) {
    if (result.claimed >= limit) break;
    const claim = await claimDirtyPatient(patientId, workerId, leaseMs);
    if (!claim) {
      result.deferred += 1;
      continue;
    }

    result.claimed += 1;
    try {
      await recomputeClaimDomains(claim);
      const status = await completeDirtyClaim(claim);
      if (status === "reconciled") result.reconciled += 1;
      if (status === "stale") result.stale += 1;
      if (status === "lost") result.lost += 1;
    } catch (error) {
      result.failed += 1;
      await failDirtyClaim(claim, error).catch((releaseError) => {
        console.warn(
          `[patientSummary] DIRTY_RECONCILE_RELEASE_FAILED (${patientId}):`,
          releaseError instanceof Error ? releaseError.message : String(releaseError)
        );
      });
      console.warn(
        `[patientSummary] DIRTY_RECONCILE_FAILED (${patientId}):`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return result;
}

// 기존 호출 호환용. 신규 코드는 상세 결과를 주는 reconcileDirtyPatientBatch를 사용한다.
export async function reconcileDirtyPatients(limit = 10): Promise<number> {
  const result = await reconcileDirtyPatientBatch({ limit });
  return result.reconciled;
}
