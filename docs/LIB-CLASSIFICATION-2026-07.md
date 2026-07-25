# lib 실제 로직 분류표

> 기준 브랜치: `refactor/reservations-client-structure`  
> 최종 갱신: 2026-07-25
> 목적: feature 구조 이동 이후에도 `lib/*`에 남겨야 하는 공유 인프라와, 향후 이동/정리 후보를 구분한다.

## 결론 요약

초기 분류표에 있던 큰 이동 후보 5개 덩어리는 대부분 feature 구조로 이동 완료됐다.

완료된 대표 이동:

| 덩어리 | 현재 위치 | 상태 |
|---|---|---|
| 인보이스 client/server/domain | `features/invoices/...` | 완료 |
| 정산 client/server | `features/settlements/data/...` | 완료 |
| 설정 client data/helper | `features/settings/data/client/...` | 완료 |
| 예약 server command/query/request handler | `features/reservations/data/server/...` | 완료 |
| 예약 메모/스케줄/타임라인/birth helper | `features/reservations/data/client`, `domain`, `ui` | 완료 |
| 환자 summary cache / patient record | `features/patients/data/client`, `features/patients/domain` | 완료 |
| 사진 client/server/job/domain | `features/photos/...` | 완료 |

현재 `lib`에는 특정 feature의 소유로 보기 어려운 공유 인프라와 공통 primitive만 남기는 방향이 맞다.

## 현재 lib 유지 권장

| 파일 | 분류 | 유지 이유 |
|---|---|---|
| `lib/firebase.ts` | Client Firebase infra | 앱 전역 Firebase client singleton |
| `lib/firebaseAdmin.ts` | Server Firebase infra | API/job 전역 Admin singleton |
| `lib/apiAuth.ts` | API 인증 infra | 여러 API route에서 공통 사용 |
| `lib/auth.ts` | Client auth infra | 로그인/권한/현재 사용자 공통 |
| `lib/adminUtils.ts` | Server utility | Firestore doc 직렬화/clean helper |
| `lib/birthUtils.ts` | 공통 생년/성별 파서 | reservations와 invoices가 같은 canonical birth format을 공유 |
| `lib/dateUtils.ts` | 범용 날짜 유틸 | dashboard/home/export/settings 등 다수 사용 |
| `lib/stringUtils.ts` | 범용 문자열 유틸 | domain/data에서 공통 사용 |
| `lib/clientCache.ts` | 전역 client cache 관리 | 로그아웃 purge 등 앱 전역 관심사 |
| `lib/csv.ts` | 범용 CSV 유틸 | 예약/커미션 export 공통 |
| `lib/colorUtils.ts` | 범용 색상 유틸 | 현재 settings UI 중심이지만 일반 색상 helper |
| `lib/commissionUtils.ts` | 공통 결제/커미션 계산 | invoices, settlements, commission page가 함께 사용 |
| `lib/logs.ts` | 공통 audit log client | 예약/사진/설정 등 여러 feature에서 생성/조회 |
| `lib/reservationLocks.ts` | 공유 write-time primitive | reservations와 patients delete job/test가 함께 사용 |
| `lib/patientIdentity.ts` | 공유 patient identity primitive | patients/reservations/job에서 함께 사용 |
| `lib/searchTokens.ts` | 공유 검색 token helper | patients 생성/수정과 reservations 생성에서 함께 사용 |
| `lib/settlementMath.ts` | 공유 정산 순수 계산 | settlements, invoices, dashboard, tests가 함께 사용 |

## 명시적으로 이동하지 않는 항목

| 항목 | 결정 | 이유 |
|---|---|---|
| `reservationLocks` | `lib` 유지 | patients job이 예약 lock을 정리해야 하므로 reservations domain으로 넣으면 feature 간 역의존이 생김 |
| `logs` | `lib` 유지 | audit log는 예약만의 소유가 아니라 photos/settings 등 여러 feature의 횡단 관심사 |
| `settlementMath` | 현재 `lib` 유지 | invoice server, settlement UI/server, dashboard가 함께 사용하는 순수 계산 primitive |
| `patients/jobs` 호출 | 유지 | 예약/인보이스 변경이 환자 summary를 갱신하는 것은 자연스러운 단방향 의존이며 순환이 없음 |
| `features/reservations/data/client/index.ts` | 유지 가능 | 사용처가 많은 deliberate public API surface. 무리한 제거보다 안정적 |

## 남은 정리 후보

| 우선순위 | 항목 | 현재 상태 | 추천 |
|---:|---|---|---|
| 1 | `features/patients/data/server` barrel | 제거 완료 | 직접 import 유지 |
| 2 | `tests/patientSummaryClientCache.test.ts` | top-level await 제거 완료 | 기본 테스트에 포함할지 별도 판단 |
| 3 | 빈 feature slice `.gitkeep` | 제거 완료 | 구조 의도는 `features/README.md`로 관리 |
| 4 | `features/reservations/data/client/index.ts` | 남김 | API 표면으로 유지 권장 |
| 5 | `patients/jobs` 직접 호출 | 남김 | 이벤트 계층 도입 전에는 유지 권장 |

## 현재 feature 경계

| Feature | 주요 소유 |
|---|---|
| `features/reservations` | 예약 domain/contracts, client/server data, schedule/timeline UI helper |
| `features/patients` | patient record/domain, patient server queries/create, summary cache, mutation/reconcile jobs |
| `features/photos` | 사진 metadata/storage client, cleanup repository/worker, storage cleanup policy, image compression |
| `features/invoices` | invoice client data, invoice server mutation, invoice domain helper |
| `features/settlements` | settlement client/server data |
| `features/settings` | settings client data/helper |
| `features/dashboard` | dashboard KPI domain 계산 |

## 검증 기준

구조 정리 후 최소 검증:

1. `npx tsc --noEmit`
2. `node --import tsx --test tests/units.test.ts tests/firestore-indexes.test.ts`
3. `node --import tsx --test tests/patientSummaryClientCache.test.ts`
4. `npm run lint`
5. `npm run build`

API/emulator 테스트는 Firebase emulator와 service account 환경이 준비된 곳에서 별도로 수행한다.
