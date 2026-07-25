import { adminDb, FieldValue } from "@/lib/firebaseAdmin";

// 고객관리 첫 화면을 patients 문서만으로 그리기 위한 요약(summary) 재계산의 공통 foundation.
// 전략: recompute-on-write — 쓰기 경로에서 "바뀐 도메인 슬라이스"만 짧게 재조회해
// patients 문서에 병합한다(증분 드리프트 없이 항상 정확).
// 모든 함수는 best-effort: 호출부에서 try/catch로 감싸 핵심 mutation을 막지 않는다.

// 신규 환자 문서에 기록할 요약(summary) 기본값.
export function createEmptyPatientSummary(): Record<string, unknown> {
  return {
    reservationCount: 0,
    lastReservationDate: "",
    lastReservationTime: "",
    lastReservationAt: "",
    lastReservationDocId: "",
    reservationCountCapped: false,
    invoiceCount: 0,
    hasInvoice: false,
    settlementCount: 0,
    totalSettlementPaid: 0,
    totalSettlementRefunded: 0,
    netSettlementAmount: 0,
    lastSettlementAt: "",
    memoCount: 0,
    hasMemo: false,
  };
}

// 동일 patientId 문서(들)에 patch를 병합 update. summaryUpdatedAt 함께 기록.
export async function mergeIntoPatients(patientId: string, patch: Record<string, unknown>) {
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
