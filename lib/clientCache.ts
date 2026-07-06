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
// 전역 단일 구독(ReservationsProvider)의 즉시표시 캐시 키.
// schedule(crm_schedule_v1)·고객관리(crm_reservations_v2)의 분리 캐시를 일원화.
export const RESERVATIONS_CACHE_KEY = "crm_reservations_v3";
export const INVOICE_LIST_CACHE_PREFIX = "crm_invoices_v1_";

// 앱 전용 캐시 키 prefix 목록 — 이 접두로 시작하는 키만 purge한다(타 앱/서비스 키 보존).
// 신규 캐시 키는 arc_crm_ 하나로 통일하는 것을 지향한다(현 코드의 crm_/inv_/conference_는 레거시).
export const APP_CACHE_PREFIXES = ["arc_crm_", "crm_", "inv_", "conference_"];

function purgeByPrefix(storage: Storage) {
  // 삭제 중 인덱스 변동을 피하려고 키를 먼저 모은 뒤 제거한다.
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && APP_CACHE_PREFIXES.some((p) => k.startsWith(p))) keys.push(k);
  }
  keys.forEach((k) => storage.removeItem(k));
}

// 로그아웃/세션 종료 시 클라 캐시 일괄 삭제 (공용기기 PII/금액 잔존 차단).
// localStorage/sessionStorage 양쪽에서 앱 전용 prefix 키만 제거한다.
export function clearAllClientCaches() {
  if (typeof window === "undefined") return;
  try {
    purgeByPrefix(localStorage);
    purgeByPrefix(sessionStorage);
  } catch {
    // ignore (Quota/SecurityError 등)
  }
}

// Firestore 영속 캐시(IndexedDB) purge.
// persistentLocalCache는 예약 PII를 기기 IndexedDB에 영구 저장하므로, 로그아웃/세션 종료 시
// 비워야 공용기기에서 다음 사용자에게 잔존하지 않는다(#4 보안 동반 변경).
// 주의: terminate → clearIndexedDbPersistence 후 db 인스턴스는 사용 불가가 되므로,
//       호출 측은 직후 하드 리로드로 새 인스턴스를 생성해야 한다.
// 동적 import로 leaf 모듈의 정적 순환 의존을 피한다.
export async function clearFirestorePersistence(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { db } = await import("./firebase");
    if (!db) return;
    const { terminate, clearIndexedDbPersistence } = await import("firebase/firestore");
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch {
    // 다른 탭이 캐시 사용 중이거나 미지원 환경 — best-effort.
  }
}
