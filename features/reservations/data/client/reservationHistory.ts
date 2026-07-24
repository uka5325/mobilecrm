import { callReservationsApi } from "./reservationClientApi";
import { mapReservationDoc, type ReservationRecord } from "@/features/reservations/domain/reservationModels";

// 환자별 "전체 예약 이력" 결과 캐시 — 라이브 구독 윈도우(45일)와 무관하게 정확한
// 고객관리 배지("총 건수"/예약금/수술비용/부위)와 "전체 이력" 모달이 공유한다.
// 금액 정보를 포함하므로 localStorage가 아닌 세션 메모리(Map)에만 유지(로그아웃/새로고침 시 자연 소멸).
const _patientFullHistoryCache = new Map<string, { at: number; reservations: ReservationRecord[]; capped: boolean }>();
const PATIENT_FULL_HISTORY_TTL = 3 * 60 * 1000;

export async function getPatientFullHistory(
  patientId: string
): Promise<{ reservations: ReservationRecord[]; capped: boolean }> {
  const result = await callReservationsApi("patient_full_history", { patientId });
  if (!result.success) throw new Error(String(result.message || "이력 조회 실패"));
  const raw = (result.reservations as Record<string, unknown>[] | undefined) || [];
  return {
    reservations: raw
      .map((r) => mapReservationDoc(String(r.id || ""), r))
      .sort((a, b) => `${b.reservationDate} ${b.reservationTime}`.localeCompare(`${a.reservationDate} ${a.reservationTime}`)),
    capped: Boolean(result.capped),
  };
}

export async function getPatientFullHistoryPage(
  patientId: string,
  options: { cursor?: string | null; limit?: number } = {}
): Promise<{
  reservations: ReservationRecord[];
  nextCursor: string | null;
  hasMore: boolean;
  capped: boolean;
}> {
  const result = await callReservationsApi("patient_full_history_page", {
    patientId,
    cursor: options.cursor || "",
    limit: options.limit || 10,
  });
  if (!result.success) throw new Error(String(result.message || "이력 조회 실패"));
  const raw = (result.reservations as Record<string, unknown>[] | undefined) || [];
  return {
    reservations: raw
      .map((r) => mapReservationDoc(String(r.id || ""), r))
      .sort((a, b) => `${b.reservationDate} ${b.reservationTime}`.localeCompare(`${a.reservationDate} ${a.reservationTime}`)),
    nextCursor: result.nextCursor ? String(result.nextCursor) : null,
    hasMore: result.hasMore === true,
    capped: Boolean(result.capped),
  };
}

export function getCachedPatientFullHistory(
  patientId: string
): { reservations: ReservationRecord[]; capped: boolean } | undefined {
  const e = _patientFullHistoryCache.get(patientId);
  if (!e || Date.now() - e.at >= PATIENT_FULL_HISTORY_TTL) return undefined;
  return { reservations: e.reservations, capped: e.capped };
}

export async function getPatientFullHistoryCached(
  patientId: string
): Promise<{ reservations: ReservationRecord[]; capped: boolean }> {
  const cached = getCachedPatientFullHistory(patientId);
  if (cached) return cached;
  const result = await getPatientFullHistory(patientId);
  _patientFullHistoryCache.set(patientId, { at: Date.now(), ...result });
  return result;
}

export function invalidatePatientFullHistoryCache(patientId: string) {
  _patientFullHistoryCache.delete(patientId);
}
