// 환자 요약(summary) 도메인 barrel — 구현은 관심사별 모듈로 분리되어 있다.
// 기존 `@/lib/patientSummary` import 경로 유지를 위한 재-export 진입점.
//   - patientSummaryCore         : createEmptyPatientSummary / mergeIntoPatients (foundation)
//   - patientSummaryReservations : 예약 요약 재계산 + 증분 업데이트
//   - patientSummaryDomains      : 인보이스 / 메모 요약 재계산
//   - patientSummaryDirty        : recompute 실패 dirty 표시 + reconcile worker
// (정책은 @/lib/patientSummaryPolicy에서 직접 import — barrel 대상 아님)
export * from "./patientSummaryCore";
export * from "./patientSummaryReservations";
export * from "./patientSummaryDomains";
export * from "./patientSummaryDirty";
