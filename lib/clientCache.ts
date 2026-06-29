// ─────────────────────────────────────────────────────────────────────────────
// 클라이언트 localStorage 캐시 키 + 로그아웃 purge
//
// 배경: 읽기 비용 절감을 위해 스케줄/인보이스를 localStorage에 캐싱한다.
// localStorage는 영구 저장이므로, 로그아웃/세션 종료 시 비우지 않으면 공용기기에서
// 다음 사용자가 이전 사용자의 환자 PII·인보이스 금액을 직접 읽을 수 있다.
// 키 상수를 이 leaf 모듈 한 곳에 모아(다른 lib/app을 import하지 않음 → 순환 없음)
// 캐시 소유 모듈과 purge가 동일 출처를 공유하게 한다.
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEDULE_CACHE_KEY = "crm_schedule_v1";
export const INVOICE_LIST_CACHE_PREFIX = "crm_invoices_v1_";

// 로그아웃/세션 종료 시 클라 캐시 일괄 삭제 (공용기기 PII/금액 잔존 차단).
export function clearAllClientCaches() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SCHEDULE_CACHE_KEY);
    Object.keys(localStorage)
      .filter((k) => k.startsWith(INVOICE_LIST_CACHE_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore (Quota/SecurityError 등)
  }
}
