// 설정 도메인 barrel — 실제 구현은 관심사별 모듈로 분리되어 있다.
// 관심사별 모듈을 한데 모아 노출하는 재-export 진입점.
//   - settingsApi                : /api/settings 공통 호출 래퍼
//   - settingsShared             : 권한 assert / HEX 정규화 등 공통 헬퍼
//   - settingsStatusColors       : 내원상태 색상 설정
//   - settingsGeneral            : 기본 설정(상담회 국가/시간대)
//   - settingsMemos              : 오늘의 메모
//   - settingsStaff              : 직원 관리 + 내 비밀번호 변경
//   - settingsAppointmentColors  : 예약 유형별 색상 설정
export * from "./settingsApi";
export * from "./settingsShared";
export * from "./settingsStatusColors";
export * from "./settingsGeneral";
export * from "./settingsMemos";
export * from "./settingsStaff";
export * from "./settingsAppointmentColors";
