# lib 실제 로직 분류표

> 기준 브랜치: `refactor/reservations-client-structure`  
> 작성일: 2026-07-25  
> 목적: 남은 `lib/*` 파일을 공통 인프라, feature 이동 후보, facade/entrypoint로 분류해 다음 리팩터링 순서를 정한다.

## 결론 요약

현재 `lib`에는 더 이상 단순 re-export facade만 남아 있는 상태는 아니다. 대부분은 실제 로직이다.

다만 아래 5개 덩어리는 feature 구조로 옮길 후보가 명확하다.

| 우선순위 | 덩어리 | 현재 위치 | 추천 위치 | 판단 |
|---:|---|---|---|---|
| 1 | 인보이스 서버 mutation | `lib/invoice*Server.ts`, `lib/invoiceConsistencyShared.ts`, `lib/invoiceUtils.ts` | `features/invoices/data/server`, `features/invoices/domain` | 실제 로직. 이동 후보 명확 |
| 2 | 정산/매출 | `lib/settlements.ts`, `lib/settlementServer.ts`, `lib/settlementMath.ts` | `features/settlements/data/client`, `data/server`, `domain` | 실제 로직. feature 구조와 잘 맞음 |
| 3 | 설정 | `lib/settings*.ts` | `features/settings/...` 신설 후 이동 | 실제 로직 + `lib/settings.ts`는 re-export entrypoint |
| 4 | 예약 서버 command/query | `lib/server/reservations/**`, `lib/reservationApiContracts.ts`, `lib/reservationLocks.ts` | `features/reservations/data/server`, `domain` | 핵심 mutation 경로라 신중히 |
| 5 | 예약 UI/보조 로직 | `lib/reservationNotes.ts`, `lib/logs.ts`, `lib/timelineUtils.ts`, `lib/scheduleLayout.ts` | `features/reservations/data/client`, `ui`, 또는 별도 `features/schedule` | 실제 로직. 화면 영향 검증 필요 |

## 유지 권장: 공통 인프라/범용 유틸

아래 파일들은 특정 feature로 옮기기보다 `lib`에 유지하는 편이 자연스럽다.

| 파일 | 분류 | 이유 | 조치 |
|---|---|---|---|
| `lib/firebase.ts` | Client Firebase infra | 앱 전역 Firebase client singleton | 유지 |
| `lib/firebaseAdmin.ts` | Server Firebase infra | API/job 전역 Admin singleton | 유지 |
| `lib/apiAuth.ts` | API 인증 infra | 여러 API route에서 공통 사용 | 유지 |
| `lib/auth.ts` | Client auth infra | 로그인/권한/현재 사용자 공통 | 유지 |
| `lib/adminUtils.ts` | Server utility | Firestore doc 직렬화/clean helper | 유지 |
| `lib/dateUtils.ts` | 범용 날짜 유틸 | dashboard/home/export 등 다수 사용 | 유지 |
| `lib/stringUtils.ts` | 범용 문자열 유틸 | domain/data에서 공통 사용 | 유지 |
| `lib/clientCache.ts` | 전역 client cache 관리 | 로그아웃 purge 등 앱 전역 관심사 | 유지 |
| `lib/csv.ts` | 범용 CSV 유틸 | 예약/커미션 export 공통 | 유지 |
| `lib/colorUtils.ts` | 범용 색상 유틸 | 설정 UI에서 사용하지만 범용성 있음 | 유지 가능 |
| `lib/imageCompress.ts` | 범용 브라우저 이미지 유틸 | 현재 photos만 쓰지만 범용 유틸 성격 | 유지 가능 |

## 이동 후보: invoices

| 파일 | 현재 역할 | 추천 위치 | 위험도 | 비고 |
|---|---|---|---|---|
| `lib/invoiceCreateServer.ts` | 인보이스 생성 atomic mutation | `features/invoices/data/server/createInvoice.ts` | 중간 | 예약/환자 summary/정산 집계 연동 |
| `lib/invoiceUpdateServer.ts` | 인보이스 수정 atomic mutation | `features/invoices/data/server/updateInvoice.ts` | 중간 | 정산 재계산과 연결 |
| `lib/invoiceDeleteServer.ts` | 인보이스 삭제 atomic mutation | `features/invoices/data/server/deleteInvoice.ts` | 중간 | 환자 summary 연동 |
| `lib/invoiceConsistencyShared.ts` | 인보이스 mutation 공통 helper | `features/invoices/data/server/shared.ts` | 낮음~중간 | 위 3개 이동과 같이 처리 |
| `lib/invoiceUtils.ts` | 인보이스용 birth parsing | `features/invoices/domain/invoiceUtils.ts` 또는 공통 birth util로 통합 | 낮음 | `reservationUtils`와 중복 성격 확인 필요 |

추천 작업 단위:

1. `features/invoices/data/server` 파일 생성
2. import 이행
3. 기존 `lib/invoice*` 파일 삭제
4. `/api/invoices` 검증

## 이동 후보: settlements

| 파일 | 현재 역할 | 추천 위치 | 위험도 | 비고 |
|---|---|---|---|---|
| `lib/settlementMath.ts` | 정산 순수 계산/집계 | `features/settlements/domain/settlementMath.ts` | 낮음 | 단위 테스트로 보호 가능 |
| `lib/settlements.ts` | client 정산 조회/변경 API wrapper/cache | `features/settlements/data/client/settlements.ts` | 중간 | dashboard/예약 상세/정산 패널 사용 |
| `lib/settlementServer.ts` | server 정산 mutation/list logic | `features/settlements/data/server/settlementServer.ts` | 중간 | API route와 인보이스 연동 확인 필요 |
| `lib/commissionUtils.ts` | 커미션/결제수단 계산 | `features/settlements/domain/commissionUtils.ts` 또는 공통 `lib` 유지 | 낮음 | invoices/commission에서 함께 사용 |

추천 작업 단위:

1. 순수 계산 `settlementMath` 먼저 이동
2. client wrapper 이동
3. server mutation 이동

## 이동 후보: settings

| 파일 | 현재 역할 | 추천 위치 | 위험도 | 비고 |
|---|---|---|---|---|
| `lib/settings.ts` | settings re-export entrypoint | 최종 삭제 후보 | 낮음 | 아직 사용처 많음. 바로 삭제 금지 |
| `lib/settingsApi.ts` | settings API client wrapper | `features/settings/data/client/settingsApi.ts` | 낮음 |
| `lib/settingsShared.ts` | 설정 권한/공통 검증 | `features/settings/domain/settingsShared.ts` | 낮음 |
| `lib/settingsGeneral.ts` | 일반 설정 | `features/settings/data/client/settingsGeneral.ts` | 중간 |
| `lib/settingsMemos.ts` | 회의 메모 client data | `features/settings/data/client/settingsMemos.ts` 또는 `features/memos` 후보 | 중간 | schedule/home과 연결 |
| `lib/settingsStaff.ts` | 직원 설정/계정 관리 | `features/settings/data/client/settingsStaff.ts` | 중간~높음 | auth/staff 권한 영향 |
| `lib/settingsStatusColors.ts` | 방문상태 색상 설정 | `features/settings/data/client/settingsStatusColors.ts` | 낮음 |
| `lib/settingsAppointmentColors.ts` | 예약유형 색상 설정 | `features/settings/data/client/settingsAppointmentColors.ts` | 낮음 |
| `lib/settingsUtils.ts` | 설정 UI helper | `features/settings/ui/settingsUtils.ts` 또는 `domain` | 낮음 |

추천 작업 단위:

1. `features/settings` 뼈대 추가
2. 색상/일반 설정처럼 낮은 위험 파일부터 이동
3. 마지막에 `settingsStaff`, `settingsMemos`
4. `lib/settings.ts` 사용처 0개 후 삭제

## 이동 후보: reservations server

| 파일 | 현재 역할 | 추천 위치 | 위험도 | 비고 |
|---|---|---|---|---|
| `lib/server/reservations/requestHandler.ts` | `/api/reservations` 요청 분기 | `features/reservations/data/server/requestHandler.ts` | 높음 | API 중심부 |
| `lib/server/reservations/commands/createReservation.ts` | 예약 생성 command | `features/reservations/data/server/commands/createReservation.ts` | 높음 | lock/patient summary/log 연동 |
| `lib/server/reservations/commands/updateReservation.ts` | 예약 수정 command | `features/reservations/data/server/commands/updateReservation.ts` | 높음 |
| `lib/server/reservations/commands/deleteReservation.ts` | 예약 삭제 command | `features/reservations/data/server/commands/deleteReservation.ts` | 높음 |
| `lib/server/reservations/commands/toggleSurgery.ts` | 수술예약 토글 command | `features/reservations/data/server/commands/toggleSurgery.ts` | 중간 |
| `lib/server/reservations/commands/support.ts` | command 공통 helper | `features/reservations/data/server/commands/support.ts` | 중간 |
| `lib/server/reservations/queries/readReservations.ts` | 예약 server read action | `features/reservations/data/server/queries/readReservations.ts` | 중간~높음 |
| `lib/reservationApiContracts.ts` | API action/payload contract | `features/reservations/domain/reservationApiContracts.ts` 또는 `data/server/contracts.ts` | 중간 | client/server 양쪽 사용 |
| `lib/reservationLocks.ts` | 예약 중복 lock/identity | `features/reservations/domain/reservationLocks.ts` | 중간 | patients job도 사용 |

추천 작업 단위:

1. `reservationApiContracts`와 `reservationLocks`를 먼저 domain으로 이동
2. queries 이동
3. commands 이동
4. requestHandler 이동

주의:

- 이 묶음은 실제 예약 mutation의 중심부라 한 번에 옮기지 않는 것이 좋다.
- emulator/API 테스트 또는 최소 `tsc + build + 핵심 API smoke`가 필요하다.

## 이동 후보: reservations client/ui 주변

| 파일 | 현재 역할 | 추천 위치 | 위험도 | 비고 |
|---|---|---|---|---|
| `lib/reservationNotes.ts` | 예약 메모 client data API | `features/reservations/data/client/reservationNotes.ts` | 중간 | notes route와 UI가 함께 사용 |
| `lib/logs.ts` | 예약/인보이스/사진 audit log client read/write | `features/reservations/data/client/logs.ts` 또는 공통 `features/audit` 후보 | 중간 | 여러 feature에서 사용 |
| `lib/reservationUtils.ts` | 예약 birth parsing/display helper | `features/reservations/domain/reservationUtils.ts` 또는 공통 patient util | 낮음~중간 | invoices와 중복 확인 |
| `lib/timelineUtils.ts` | timeline UI layout/status/date helper | `features/reservations/ui/timelineUtils.ts` | 중간 | timeline 화면 영향 |
| `lib/scheduleLayout.ts` | schedule UI layout helper | `features/reservations/ui/scheduleLayout.ts` 또는 `features/schedule` 후보 | 중간 | schedule 화면 영향 |
| `lib/scheduleDates.ts` | schedule date helper | `features/reservations/ui/scheduleDates.ts` 또는 `lib` 유지 | 낮음 | 범용 날짜보다는 schedule 특화 |
| `lib/patientSummaryClientCache.ts` | 환자 summary client cache | `features/patients/data/client/patientSummaryClientCache.ts` | 낮음 | `PatientSummaryProvider`와 reservation mutation에서 사용 |

추천 작업 단위:

1. `patientSummaryClientCache` 이동
2. `reservationUtils` 이동
3. `reservationNotes` 이동
4. `timelineUtils` / `scheduleLayout` / `scheduleDates`는 UI 화면별로 검증하며 이동

## 이동/유지 판단 보류

| 파일 | 판단 | 이유 |
|---|---|---|
| `lib/searchTokens.ts` | 보류 | patients/reservations 양쪽에서 사용. `features/patients/domain` 후보지만 공통 검색 유틸로 유지도 가능 |
| `lib/patientIdentity.ts` | 보류 | patients/reservations/jobs에서 함께 사용. `features/patients/domain` 후보지만 lock/예약 생성과 결합 |
| `lib/commissionUtils.ts` | 보류 | invoices, settlements, commission page가 함께 사용. `features/settlements/domain` 후보 |
| `lib/imageCompress.ts` | 유지 가능 | 현재 photos만 사용하지만 브라우저 이미지 범용 유틸 성격 |
| `lib/colorUtils.ts` | 유지 가능 | 현재 settings UI만 사용하지만 범용 색상 유틸 |

## 다음 추천 작업

바로 다음 커밋으로는 `invoices server 이동`보다 `settlements domain/client 정리`가 더 안전하다.

추천 순서:

1. `settlementMath.ts` → `features/settlements/domain/settlementMath.ts`
2. `settlements.ts` → `features/settlements/data/client/settlements.ts`
3. 검증/커밋
4. 이후 `settlementServer.ts` 이동

이유:

- `settlementMath`는 순수 계산이라 이동 위험이 낮다.
- `settlements.ts`는 client wrapper라 import 이행 중심이다.
- `settlementServer.ts`는 API mutation이므로 한 단계 뒤가 안전하다.

