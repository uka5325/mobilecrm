import { randomUUID } from "node:crypto";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import {
  normalizeSummaryDomains,
  summaryRetryDelayMs,
  type SummaryDomain,
} from "@/lib/patientSummaryPolicy";
import { PATIENT_AMOUNT_ROWS } from "@/lib/patientAmountRows";

// 고객관리 첫 화면을 patients 문서만으로 그리기 위한 요약(summary) 재계산 헬퍼.
// 전략: recompute-on-write — 쓰기 경로에서 "바뀐 도메인 슬라이스"만 짧게 재조회해
// patients 문서에 병합한다(증분 드리프트 없이 항상 정확).
// 모든 함수는 best-effort: 호출부에서 try/catch로 감싸 핵심 mutation을 막지 않는다.

const RESERVATION_CAP = 300;
const DEFAULT_RECONCILE_LEASE_MS = 5 * 60 * 1000;

// 신규 환자 문서에 기록할 요약(summary) 기본값.
export function createEmptyPatientSummary(): Record<string, unknown> {
  return {
    reservationCount: 0,
    depositCount: 0,
    surgeryCostCount: 0,
    totalDepositAmount: 0,
    totalSurgeryCost: 0,
    lastReservationDate: "",
    lastReservationTime: "",
    lastReservationAt: "",
    reservationCountCapped: false,
    invoiceCount: 0,
    hasInvoice: false,
    memoCount: 0,
    hasMemo: false,
  };
}

// 금액 문자열("1,000,000", "100만", "1.5억" 등) → 원 단위 숫자.
export function parseAmount(v: unknown): number {
  const raw = String(v ?? "").trim().replace(/,/g, "");
  if (!raw) return 0;

  const unitMatches = [...raw.matchAll(/(-?\d+(?:\.\d+)?)\s*(억|만)/g)];
  if (unitMatches.length) {
    return unitMatches.reduce((sum, match) => {
      const value = Number(match[1]);
      if (!Number.isFinite(value)) return sum;
      return sum + value * (match[2] === "억" ? 100_000_000 : 10_000);
    }, 0);
  }

  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// 예약금/수술비 "묶음" 기준 키 — 같은 병원+상담부위+원장이면 1건으로 묶는다.
export function reservationGroupKey(r: Record<string, unknown>): string {
  const doctors = Array.isArray(r.doctors) ? (r.doctors as unknown[]) : [];
  return [
    String(r.hospital || "").trim().toLowerCase(),
    String(r.consultArea || "").trim().toLowerCase(),
    doctors.map((d) => String(d).trim().toLowerCase()).sort().join(","),
  ].join("|");
}

// 동일 patientId 문서(들)에 patch를 병합 update. summaryUpdatedAt 함께 기록.
async function mergeIntoPatients(patientId: string, patch: Record<string, unknown>) {
  if (!patientId) return;
  const snap = await adminDb.collection("patients").where("patientId", "==", patientId).get();
  if (snap.empty) return;
  const withMeta = { ...patch, summaryUpdatedAt: FieldValue.serverTimestamp() };
  const CHUNK = 500;
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = adminDb.batch();
    for (const d of snap.docs.slice(i, i + CHUNK)) batch.update(d.ref, withMeta);
    await batch.commit();
  }
}

// 예약 파생 요약: 건수/최근예약/예약금·수술비 카운트 및 합계.
// 카운트(depositCount/surgeryCostCount)는 patientAmountRows count() 집계로,
// 나머지 총합/최근예약은 reservations 스캔으로 계산한다.
export async function recomputeReservationSummary(patientId: string): Promise<void> {
  if (!patientId) return;
  // CAP+1을 읽어 정확히 300건인 경우와 301건 이상인 경우를 구분한다.
  const snap = await adminDb
    .collection("reservations")
    .where("patientId", "==", patientId)
    .where("isDeleted", "==", false)
    .orderBy("reservationDate", "desc")
    .limit(RESERVATION_CAP + 1)
    .get();
  const docs = snap.docs.slice(0, RESERVATION_CAP);

  let reservationCount = 0;
  let totalDepositAmount = 0;
  let totalSurgeryCost = 0;
  let lastReservationDate = "";
  let lastReservationTime = "";
  let lastComposite = "";

  for (const d of docs) {
    const r = d.data() as Record<string, unknown>;
    reservationCount += 1;
    if (String(r.depositAmount ?? "").trim() !== "") {
      totalDepositAmount += parseAmount(r.depositAmount);
    }
    if (String(r.surgeryCost ?? "").trim() !== "") {
      totalSurgeryCost += parseAmount(r.surgeryCost);
    }
    const date = String(r.reservationDate || "");
    const time = String(r.reservationTime || "");
    const composite = `${date} ${time}`;
    if (composite > lastComposite) {
      lastComposite = composite;
      lastReservationDate = date;
      lastReservationTime = time;
    }
  }

  const [depositCountSnap, surgeryCountSnap] = await Promise.all([
    adminDb.collection(PATIENT_AMOUNT_ROWS)
      .where("patientId", "==", patientId)
      .where("type", "==", "deposit")
      .count()
      .get(),
    adminDb.collection(PATIENT_AMOUNT_ROWS)
      .where("patientId", "==", patientId)
      .where("type", "==", "surgery")
      .count()
      .get(),
  ]);

  await mergeIntoPatients(patientId, {
    reservationCount,
    depositCount: depositCountSnap.data().count,
    surgeryCostCount: surgeryCountSnap.data().count,
    totalDepositAmount,
    totalSurgeryCost,
    lastReservationDate,
    lastReservationTime,
    lastReservationAt: lastReservationDate ? `${lastReservationDate} ${lastReservationTime}`.trim() : "",
    reservationCountCapped: snap.docs.length > RESERVATION_CAP,
  });
}

// 인보이스 요약: 뷰어 권한 무관 총 개수(count() 집계 — 문서 안 읽음).
export async function recomputeInvoiceSummary(patientId: string): Promise<void> {
  if (!patientId) return;
  const agg = await adminDb
    .collection("invoices")
    .where("patientId", "==", patientId)
    .where("isDeleted", "==", false)
    .count()
    .get();
  const invoiceCount = agg.data().count;
  await mergeIntoPatients(patientId, { invoiceCount, hasInvoice: invoiceCount > 0 });
}

// 메모 요약: 개수(count() 집계).
export async function recomputeMemoSummary(patientId: string): Promise<void> {
  if (!patientId) return;
  const agg = await adminDb
    .collection("reservationNotes")
    .where("patientId", "==", patientId)
    .where("isDeleted", "==", false)
    .count()
    .get();
  const memoCount = agg.data().count;
  await mergeIntoPatients(patientId, { memoCount, hasMemo: memoCount > 0 });
}

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
