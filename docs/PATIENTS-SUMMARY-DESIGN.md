# patients summary 설계안 (Stage 4-1)

## 1. 배경 / 목표
현재 고객관리 목록은 **최근 45일 예약 구독 데이터를 patientId로 그룹핑**해 만든다
(`app/reservations/page.tsx:159-212`). 그래서:
- 45일 지난 환자는 기본 목록에 안 보임(구조적 한계).
- row 배지(총 건수/예약금/수술비용/인보이스/메모)를 위해 `patient_full_history_batch`,
  `counts_by_patients` 등 **환자별 추가 조회**가 필요.

목표: `patients` 문서에 **요약(summary) 필드**를 저장해서
- 고객관리 첫 화면 = `patients` 10건만 읽기(≈10 reads),
- 배지 = summary 값으로 즉시 표시,
- 45일 지난 환자도 노출,
- 상세(전체 이력/인보이스/메모 내용)는 클릭 시에만 조회.

---

## 2. 스키마 (patients 문서에 추가할 필드)
기존 필드(patientId, name, birth, gender, phone, nationality, searchTokens,
isDeleted, created*/updated*)는 유지하고 아래를 추가한다. 모두 **선택적(optional)**
으로 타입 정의 → 백필 전 문서와 호환.

```ts
type PatientSummary = {
  // 정렬/표시용 최근 예약
  lastReservationDate?: string;   // "YYYY-MM-DD" (orderBy 키)
  lastReservationTime?: string;   // "HH:mm"
  lastReservationAt?: string;     // "YYYY-MM-DD HH:mm" (표시/tiebreak)

  // 카운트 배지
  reservationCount?: number;      // isDeleted=false 예약 수
  depositCount?: number;          // depositAmount>0 예약 수
  surgeryCostCount?: number;      // surgeryCost>0 예약 수
  invoiceCount?: number;          // isDeleted=false 인보이스 수(뷰어 무관 총계)
  memoCount?: number;             // isDeleted=false 메모 수

  // 합계
  totalDepositAmount?: number;
  totalSurgeryCost?: number;

  // 편의 플래그(쿼리/아이콘용)
  hasMemo?: boolean;
  hasInvoice?: boolean;

  summaryUpdatedAt?: FieldValue;  // 요약 갱신 시각(디버깅/정합성 점검용)
};
```

---

## 3. 유지 전략: **recompute-on-write (도메인별 재계산)**  ← 권장

두 가지 후보:

| 방식 | 쓰기당 read | 정확성 | 복잡도 |
|---|---|---|---|
| A. 증분(FieldValue.increment) | 0 | **드리프트 위험**(부분수정/삭제/백필 불일치) | 높음(diff 로직) |
| **B. 재계산(권장)** | 환자당 N(해당 도메인 문서 수) | **항상 정확** | 낮음 |

의료 CRM은 카운트/합계 **정확성**이 중요하고, 예약 수정은 임의 필드(예약금·수술비
등)를 바꾸므로 증분 diff가 취약하다. 환자당 문서 수는 적고(보통 1~20건), **읽기가
쓰기보다 압도적으로 많으므로** 재계산 방식이 전체적으로 유리하다.

### 재계산 단위 = 변경된 도메인만
쓰기 경로에서, **바뀐 도메인의 슬라이스만** 재계산해 patients 문서에 병합한다.

- **예약 쓰기** → 예약 파생 필드 재계산
  (`reservationCount, lastReservation*, depositCount, surgeryCostCount,
  totalDepositAmount, totalSurgeryCost`)
  - 쿼리: `reservations where patientId==X and isDeleted==false`
    orderBy reservationDate desc limit CAP(=300)
  - 금액 파싱: 공용 `parseAmount()`(cleanText→숫자) 신설(invoices의 인라인 파싱 재사용).
- **인보이스 쓰기** → `invoiceCount, hasInvoice` 재계산
  - `invoices where patientId==X and isDeleted==false` **count()** 집계(문서 안 읽고 개수만).
- **메모 쓰기** → `memoCount, hasMemo` 재계산
  - `reservationNotes where patientId==X and isDeleted==false` **count()** 집계.

### 적용 대상 쓰기 경로(서버, Admin SDK)
- `app/api/reservations/route.ts`: `create`, `update`, `toggleSurgery`(금액 무관이라
  예약 파생 재계산 불필요—단 lastReservation 영향 없음, 생략 가능), `delete`,
  `delete_patient`(환자 soft-delete → summary 0/보류), `update_patient_profile`(금액 무관, 생략)
- `app/api/invoices/route.ts`: `create`, `update`(status만 바뀌면 count 불변이나
  안전하게 재계산), `delete`
- `app/api/reservation-notes/route.ts`: `create`, `delete`(update는 개수 불변 → 생략)

공용 헬퍼 신설: `lib/patientSummary.ts`
```ts
recomputeReservationSummary(patientId)   // 예약 파생 필드 patch 반환/적용
recomputeInvoiceSummary(patientId)       // invoiceCount/hasInvoice
recomputeMemoSummary(patientId)          // memoCount/hasMemo
```
각 헬퍼는 `patients where patientId==X` 문서(들)에 `summaryUpdatedAt`와 함께 병합 update.
(동일 patientId 문서가 복수일 수 있어 배치 update — 기존 delete_patient 패턴과 동일)

---

## 4. 읽기 경로 변경(고객관리 첫 화면)
백필 완료 후에만 전환한다(§6).

```ts
// 1페이지
query(collection(db,"patients"),
  where("isDeleted","==",false),
  orderBy("lastReservationDate","desc"),
  limit(10))
// 다음 페이지: startAfter(cursor)
// 검색: 기존 searchTokens array-contains (변경 없음)
```
- row 배지 = summary 값(추가 조회 0).
- 전체 이력/인보이스/메모 **내용**은 기존 클릭-시-조회 유지
  (`patient_full_history`, invoices `get_by_patient`, notes `read`).
- 필요 인덱스: `patients (isDeleted ASC, lastReservationDate DESC)` — `firestore.indexes.json` 추가.

---

## 5. 비용 비교
- 현재: 고객관리 첫 화면 = 최근 45일 예약 전체(수백 reads) + 배지용 배치 조회.
- 변경 후: 첫 화면 = patients 10 reads, 배지 0. 다음 페이지 +10, 검색 1~50.
- 쓰기: 예약 1건 쓰기당 +N(해당 환자 예약 수) read + patients 1 write.
  인보이스/메모는 count() 집계라 +1 read. 읽기 절감이 훨씬 큼.

---

## 6. 롤아웃 순서(안전)
1. **(추가·무해)** summary 타입 + `lib/patientSummary.ts` + 각 쓰기 경로에 재계산 호출.
   이 시점엔 읽기 경로 그대로 → 기존 동작 불변, summary는 신규 쓰기부터 채워짐.
2. **백필 스크립트** `scripts/backfill-patient-summary.ts`:
   전 patients 순회 → 3개 recompute 실행. 재실행 안전(idempotent).
3. 백필 검증 후 **읽기 경로 전환**(§4) + 인덱스 배포. (별도 커밋/PR 단계)
4. (선택) 기존 45일-구독 그룹핑 코드 정리.

→ 1~2는 이번 구현 범위. 3은 백필 완료 확인 후 별도 진행(회귀 위험 격리).

---

## 7. 엣지 케이스
- 동일 patientId 문서 복수 → 모두 병합 update(기존 패턴).
- 예약 patientId 변경 불가(update 화이트리스트에 patientId 없음) → 이전 없음.
- toggleSurgery/update_patient_profile은 금액·예약 수 불변 → 재계산 생략(비용 절약).
- 인보이스 count는 **뷰어 권한 무관 총계**(coordinator 필터 미적용) — 배지는 존재/개수만 표시.
- CAP(300) 초과 환자: reservationCount는 "300+"로 표기 가능(capped 플래그 병행 저장 고려).

---

## 8. 테스트 계획(에뮬레이터)
- `tests/api/` 확장:
  - 예약 create/delete 시 patients summary 필드가 정확히 갱신되는지.
  - 인보이스 create/delete 시 invoiceCount/hasInvoice.
  - 메모 create/delete 시 memoCount/hasMemo.
  - 금액 합계(totalDepositAmount/totalSurgeryCost) 파싱 정확성.
- 백필 스크립트: 시드 데이터로 실행 후 summary 일치 검증.
```
```

---

## 결정 필요(구현 착수 전)
1. 유지 전략 = **B. 재계산(권장)** 확정?
2. summary 필드 세트(§2) 이대로? 추가/삭제할 것?
3. 이번 범위 = 롤아웃 **1~2단계(쓰기 유지 + 백필 스크립트, 읽기 전환은 다음)**로 격리?
