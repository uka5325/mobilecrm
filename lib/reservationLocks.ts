/**
 * 예약 중복 방지 lock(reservationLocks) 공통 helper — 서버 전용.
 *
 * create/update/cancel/delete 및 reconciliation 스크립트가 "동일한" dupKey·lockId 규칙을
 * 쓰도록 한 곳에 모은다. 규칙이 갈라지면 같은 예약이 서로 다른 lock을 가리켜 중복 방지가 깨진다.
 *
 * 보안: lock 문서에는 민감정보 원문(이름/전화)을 저장하지 않는다. dupKey는 해시(sha256)만 쓴다.
 */
import { createHash } from "node:crypto";

export const RESERVATION_LOCKS = "reservationLocks";

// 공백/대소문자/유니코드 정규화. dupKey 구성요소 텍스트에 일관 적용.
export function normalizeText(v: unknown): string {
  return String(v ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// 전화번호 정규화 — 숫자와 +만 남긴다(구 normDupKey와 동일 규칙).
export function normalizePhone(v: unknown): string {
  return String(v ?? "").replace(/[^0-9+]/g, "");
}

// dupKey 구성요소(날짜·이름)가 있어야 lock을 만든다. 둘 중 하나라도 없으면 lock 생략.
export function hasDupKeyComponents(r: Record<string, unknown>): boolean {
  const name = normalizeText(r.name ?? r.patientName);
  const date = normalizeText(r.reservationDate);
  return !!name && !!date;
}

// 중복 기준 키(원문) — 병원+부위 아님에 주의: 예약 중복은
// 이름/날짜/시간/전화/병원/유형/원장 조합으로 판정한다(구 normDupKey와 호환되는 필드 구성).
// doctors는 정규화 후 정렬해 순서 무관하게 동일 키를 만든다.
export function computeDupKey(r: Record<string, unknown>): string {
  const doctors = Array.isArray(r.doctors)
    ? [...(r.doctors as unknown[])].map(normalizeText).filter(Boolean).sort().join(",")
    : "";
  return [
    normalizeText(r.name ?? r.patientName),
    normalizeText(r.reservationDate),
    normalizeText(r.reservationTime),
    normalizePhone(r.phone),
    normalizeText(r.hospital),
    normalizeText(r.appointmentType),
    doctors,
  ].join("__");
}

// dupKey 원문 → lock 문서 ID(sha256 hex). 원문은 저장/노출하지 않는다.
export function lockIdForDupKey(dupKey: string): string {
  return createHash("sha256").update(dupKey).digest("hex");
}

// 예약 데이터로부터 바로 lockId 계산. 구성요소가 없으면 "".
export function lockIdForReservation(r: Record<string, unknown>): string {
  if (!hasDupKeyComponents(r)) return "";
  return lockIdForDupKey(computeDupKey(r));
}

// 예약이 "활성"인가 — lock을 소유해야 하는 상태(삭제/취소 아님).
export function isReservationActive(r: Record<string, unknown> | null | undefined): boolean {
  return !!r && r.isDeleted !== true && r.cancelled !== true;
}

// lock이 가리키는 예약이 stale(없음/삭제됨/취소됨)인가 → 자동 정리 대상.
export function isLockTargetStale(target: Record<string, unknown> | null | undefined): boolean {
  return !isReservationActive(target);
}

// lock 문서 본문 생성 — 민감정보 없이 식별자 + 해시 + 타임스탬프만.
export function buildLockDoc(params: {
  reservationDocId: string;
  reservationId: string;
  patientId: string;
  lockId: string;
  now: unknown;
}): Record<string, unknown> {
  return {
    reservationDocId: params.reservationDocId,
    reservationId: params.reservationId,
    patientId: params.patientId,
    dupKeyHash: params.lockId,
    createdAt: params.now,
    updatedAt: params.now,
  };
}
