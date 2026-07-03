import { adminDb, FieldValue } from "@/lib/firebaseAdmin";

// 고객관리 첫 화면을 patients 문서만으로 그리기 위한 요약(summary) 재계산 헬퍼.
// 전략: recompute-on-write — 쓰기 경로에서 "바뀐 도메인 슬라이스"만 짧게 재조회해
// patients 문서에 병합한다(증분 드리프트 없이 항상 정확).
// 모든 함수는 best-effort: 호출부에서 try/catch로 감싸 핵심 mutation을 막지 않는다.

const RESERVATION_CAP = 300;

// 금액 문자열("1,000,000", "100만" 등) → 숫자. invoices 라우트의 인라인 파싱과 동일 규칙
// (숫자/점 외 제거) — 표기 문자는 버린다. 파싱 불가 시 0.
export function parseAmount(v: unknown): number {
  const cleaned = String(v ?? "").replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
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
  const snap = await adminDb
    .collection("reservations")
    .where("patientId", "==", patientId)
    .where("isDeleted", "==", false)
    .orderBy("reservationDate", "desc")
    .limit(RESERVATION_CAP)
    .get();

  let reservationCount = 0;
  let depositCount = 0;
  let surgeryCostCount = 0;
  let totalDepositAmount = 0;
  let totalSurgeryCost = 0;
  let lastReservationDate = "";
  let lastReservationTime = "";
  let lastComposite = "";

  for (const d of snap.docs) {
    const r = d.data() as Record<string, unknown>;
    reservationCount += 1;
    const dep = parseAmount(r.depositAmount);
    const sur = parseAmount(r.surgeryCost);
    if (dep > 0) { depositCount += 1; totalDepositAmount += dep; }
    if (sur > 0) { surgeryCostCount += 1; totalSurgeryCost += sur; }
    // 같은 날짜 내 시간 순서는 orderBy로 보장되지 않으므로 "날짜+시간" 합성값으로 최댓값 선택.
    const date = String(r.reservationDate || "");
    const time = String(r.reservationTime || "");
    const comp = `${date} ${time}`;
    if (comp > lastComposite) {
      lastComposite = comp;
      lastReservationDate = date;
      lastReservationTime = time;
    }
  }

  await mergeIntoPatients(patientId, {
    reservationCount,
    depositCount,
    surgeryCostCount,
    totalDepositAmount,
    totalSurgeryCost,
    lastReservationDate,
    lastReservationTime,
    lastReservationAt: lastReservationDate ? `${lastReservationDate} ${lastReservationTime}`.trim() : "",
    reservationCountCapped: snap.docs.length === RESERVATION_CAP,
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

// 호출부에서 사용하는 best-effort 래퍼 — 요약 갱신 실패가 핵심 mutation을 막지 않게 한다.
export async function safeRecompute(fn: () => Promise<void>, label: string): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn(`[patientSummary] ${label} 실패:`, e instanceof Error ? e.message : String(e));
  }
}
