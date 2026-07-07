/**
 * 환자 신원(identity) 키 — 서버 전용.
 *
 * 같은 사람(이름+생년월일+국적+성별)이 서로 다른 patientId로 중복 저장되는 것을 막기 위해,
 * 신원을 정규화해 해시(identityKey)로 만든다. create 경로의 중복 차단과 reconcile
 * 스크립트가 "동일한" 규칙을 쓰도록 한 곳에 모은다. 규칙이 갈라지면 같은 환자가 서로
 * 다른 신원 키를 가져 dedup이 깨진다.
 *
 * 신원 키 = 이름 + 생년월일(birth, YYYYMMDD) + 국적 + 성별. 전화번호는 같은 사람도 다르게
 * 입력/누락되는 경우가 많아 제외한다.
 */
import { createHash } from "node:crypto";

// 공백/대소문자/유니코드 정규화 — 이름·국적·성별 텍스트에 일관 적용.
export function normalizeIdentityText(v: unknown): string {
  return String(v ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// 생년월일 정규화 — birth(표준 YYYYMMDD) 우선, 없으면 birthInput에서 숫자만 추출해 앞 8자리.
export function normalizeBirth(p: Record<string, unknown>): string {
  const birth = String(p.birth ?? "").trim();
  if (birth) return birth;
  const digits = String(p.birthInput ?? "").replace(/[^0-9]/g, "");
  return digits.slice(0, 8);
}

// 신원 키 원문 — 이름/생년월일/국적/성별 조합. 이름 또는 생년월일이 없으면 ""(식별 불가 →
// dedup 대상에서 제외하고 개별 문서로 둔다).
export function computePatientIdentityKey(p: Record<string, unknown>): string {
  const name = normalizeIdentityText(p.name ?? p.patientName);
  const birth = normalizeBirth(p);
  if (!name || !birth) return "";
  const nationality = normalizeIdentityText(p.nationality);
  const gender = normalizeIdentityText(p.gender);
  return [name, birth, nationality, gender].join("__");
}

// 신원 키 원문 → 저장/조회용 해시(sha256 hex). patients 문서의 identityKey 필드로 저장한다.
export function patientIdentityId(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// 환자 데이터로부터 바로 identityKey(해시) 계산. 구성요소가 없으면 "".
export function identityKeyForPatient(p: Record<string, unknown>): string {
  const key = computePatientIdentityKey(p);
  if (!key) return "";
  return patientIdentityId(key);
}
