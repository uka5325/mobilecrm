import { adminDb, FieldValue } from "@/lib/firebaseAdmin";

// 고객관리 첫 화면을 patients 문서만으로 그리기 위한 요약(summary) 재계산 헬퍼.
// 전략: recompute-on-write — 쓰기 경로에서 "바뀐 도메인 슬라이스"만 짧게 재조회해
// patients 문서에 병합한다(증분 드리프트 없이 항상 정확).
// 모든 함수는 best-effort: 호출부에서 try/catch로 감싸 핵심 mutation을 막지 않는다.

const RESERVATION_CAP = 300;
type SummaryDomain = "reservation" | "invoice" | "memo";

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
  const depositGroups = new Set<string>();
  const surgeryGroups = new Set<string>();

  for (const d of docs) {
    const r = d.data() as Record<string, unknown>;
    reservationCount += 1;
    const hasDeposit = String(r.depositAmount ?? "").trim() !== "";
    const hasSurgery = String(r.surgeryCost ?? "").trim() !== "";
    if (hasDeposit) {
      depositGroups.add(reservationGroupKey(r));
      totalDepositAmount += parseAmount(r.depositAmount);
    }
    if (hasSurgery) {
      surgeryGroups.add(reservationGroupKey(r));
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

  await mergeIntoPatients(patientId, {
    reservationCount,
    depositCount: depositGroups.size,
    surgeryCostCount: surgeryGroups.size,
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
      summaryDirtyLastError: label,
    });
  }
  await batch.commit();
}

// dirty 원인이 어느 도메인이든 완전히 복구되도록 예약·인보이스·메모를 모두 재계산한다.
export async function reconcileDirtyPatients(limit = 10): Promise<number> {
  const snap = await adminDb
    .collection("patients")
    .where("summaryDirty", "==", true)
    .limit(limit)
    .get();
  if (snap.empty) return 0;

  const patientIds = [...new Set(snap.docs.map((doc) => String(doc.data().patientId || "")).filter(Boolean))];
  let reconciled = 0;
  for (const patientId of patientIds) {
    try {
      await Promise.all([
        recomputeReservationSummary(patientId),
        recomputeInvoiceSummary(patientId),
        recomputeMemoSummary(patientId),
      ]);

      const patientSnap = await adminDb.collection("patients").where("patientId", "==", patientId).get();
      const batch = adminDb.batch();
      for (const doc of patientSnap.docs) {
        batch.update(doc.ref, {
          summaryDirty: FieldValue.delete(),
          summaryDirtyDomains: FieldValue.delete(),
          summaryDirtyAt: FieldValue.delete(),
          summaryDirtyLastError: FieldValue.delete(),
        });
      }
      await batch.commit();
      reconciled += 1;
    } catch (e) {
      console.warn(`[patientSummary] DIRTY_RECONCILE_FAILED (${patientId}):`, e instanceof Error ? e.message : String(e));
    }
  }
  return reconciled;
}
