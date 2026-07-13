// 예약/환자 도메인 barrel — 구현은 관심사별 모듈로 분리되어 있다.
// lib/reservations.ts가 `import * as base` / `export *`로 이 진입점을 감싸므로,
// 기존 `@/lib/reservations` import 경로는 그대로 유지된다.
//   - reservationModels     : 데이터 타입 + 순수 매퍼/빌더(mapReservationDoc 등)
//   - reservationClientApi  : /api/reservations 호출 래퍼
//   - reservationReads      : 의사 목록 / 범위 구독 / 범위·내보내기 조회
//   - reservationPatients   : 예약·환자 mutation + 환자 목록/검색 + 파생 캐시 무효화
//   - reservationHistory    : 환자 전체 이력 조회 + 세션 캐시
export * from "./reservationModels";
export * from "./reservationClientApi";
export * from "./reservationReads";
export * from "./reservationPatients";
export * from "./reservationHistory";
