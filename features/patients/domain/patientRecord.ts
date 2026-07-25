import { cleanText } from "@/lib/stringUtils";

export type PatientRecord = {
  id: string;
  patientId: string;
  name: string;
  birth?: string;
  birthInput?: string;
  gender?: string;
  phone?: string;
  nationality?: string;
  // 고객관리 배지용 요약(patients 문서 저장값). 백필 전 문서는 undefined.
  reservationCount?: number;
  invoiceCount?: number;
  memoCount?: number;
  settlementCount?: number;
  totalSettlementPaid?: number;
  totalSettlementRefunded?: number;
  netSettlementAmount?: number;
  lastSettlementAt?: string;
  lastReservationDate?: string;
  lastReservationTime?: string;
  hasMemo?: boolean;
  hasInvoice?: boolean;
  reservationCountCapped?: boolean;
};

// patients 문서(요약 포함) → PatientRecord. 숫자 필드는 숫자만 통과(백필 전엔 undefined).
export function mapPatientRecord(p: Record<string, unknown>): PatientRecord {
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    id: cleanText(p.id),
    patientId: cleanText(p.patientId),
    name: cleanText(p.name),
    birth: cleanText(p.birth),
    birthInput: cleanText(p.birthInput),
    gender: cleanText(p.gender),
    phone: cleanText(p.phone),
    nationality: cleanText(p.nationality),
    reservationCount: num(p.reservationCount),
    invoiceCount: num(p.invoiceCount),
    memoCount: num(p.memoCount),
    settlementCount: num(p.settlementCount),
    totalSettlementPaid: num(p.totalSettlementPaid),
    totalSettlementRefunded: num(p.totalSettlementRefunded),
    netSettlementAmount: num(p.netSettlementAmount),
    lastSettlementAt: cleanText(p.lastSettlementAt),
    lastReservationDate: cleanText(p.lastReservationDate),
    lastReservationTime: cleanText(p.lastReservationTime),
    hasMemo: p.hasMemo === true,
    hasInvoice: p.hasInvoice === true,
    reservationCountCapped: p.reservationCountCapped === true,
  };
}
