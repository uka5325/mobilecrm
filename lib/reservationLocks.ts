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

// 중복 판정의 "신원" 부분 — patientId가 있으면 그것만 쓴다(이름/전화 수정으로 lock이 흔들리지
// 않게 하기 위함). patientId가 없는 레거시 예약만 name+phone으로 fallback한다.
// prefix("pid:"/"legacy:")로 두 경로의 값이 우연히 충돌하지 않게 한다.
function computeIdentityKey(r: Record<string, unknown>): string {
  const patientId = normalizeText(r.patientId);
  if (patientId) return `pid:${patientId}`;
  const name = normalizeText(r.name ?? r.patientName);
  if (!name) return "";
  return `legacy:${name}__${normalizePhone(r.phone)}`;
}

// dupKey 구성요소(신원·날짜)가 있어야 lock을 만든다. 둘 중 하나라도 없으면 lock 생략.
export function hasDupKeyComponents(r: Record<string, unknown>): boolean {
  const identity = computeIdentityKey(r);
  const date = normalizeText(r.reservationDate);
  return !!identity && !!date;
}

// 중복 기준 키(원문) — 신원(patientId 우선, 레거시는 name+phone)/날짜/시간/병원/유형/원장 조합.
// doctors는 정규화 후 정렬해 순서 무관하게 동일 키를 만든다. patientId가 있으면 phone은
// key에 별도로 들어가지 않는다(신원이 이미 patientId로 고정되므로).
export function computeDupKey(r: Record<string, unknown>): string {
  const doctors = Array.isArray(r.doctors)
    ? [...(r.doctors as unknown[])].map(normalizeText).filter(Boolean).sort().join(",")
    : "";
  return [
    computeIdentityKey(r),
    normalizeText(r.reservationDate),
    normalizeText(r.reservationTime),
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

// lock이 stale(자동 정리 대상)인가 — 두 가지 경우:
//   1) 가리키는 예약이 없음/삭제됨/취소됨
//   2) 예약은 활성이지만, 그 예약 데이터로 지금 다시 계산한 lockId가 이 lock 문서 ID와 다름
//      (예: identity 스킴 변경, 데이터 정정 등으로 이 예약의 "현재" lock이 이미 다른 문서로 옮겨감)
export function isLockStale(
  lockDocId: string,
  target: Record<string, unknown> | null | undefined
): boolean {
  if (!isReservationActive(target)) return true;
  return lockIdForReservation(target as Record<string, unknown>) !== lockDocId;
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
