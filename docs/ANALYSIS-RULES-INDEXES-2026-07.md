# MobileCRM firestore.rules / firestore.indexes.json 정밀 분석

> 분석일: 2026-07-01 · `docs/ANALYSIS-2026-06.md`(구조/기능/UX/비용 개요)에서 "별도 분석 예정"으로 남겨둔
> **firestore.rules 상세 + firestore.indexes.json 상세 + 규칙 자체의 읽기 비용**을 다룬다.
> 전제 지식(2-트랙 접근 모델, requireActiveStaff 가드 등)은 06월 문서를 참고하고 여기서는 반복하지 않는다.

---

## 0. 결론 먼저

| 항목 | 평가 |
|---|---|
| 컬렉션 단위 차단(admin 전용 vs 클라 직접) | ★★★★★ 설계 원칙이 명확하고 정확히 구현됨 |
| `reservations` 쓰기 규칙의 필드 단위 방어 | ★★☆☆☆ **주석이 말하는 것보다 훨씬 넓게 열려 있음 (아래 §1)** |
| 인덱스 ↔ 실제 쿼리 정합성 | ★★★☆☆ 죽은 인덱스 3개, 중복 인덱스 2개, 배포 상태 불일치 의심 (§2) |
| 규칙 평가 자체의 읽기 비용 | ★★★★★ `staffDoc()` 재귀 호출은 리스너/쿼리당 O(1) — 문제 아님 (§3) |
| 행(row) 단위 권한 분리 | ★★★☆☆ 전 역할이 전체 컬렉션 필드를 동일하게 열람 — 의도적 설계인지 확인 필요 (§4) |

---

## 1. `reservations` update 규칙 — 주석과 실제 동작의 괴리 (가장 중요)

`firestore.rules:46-56`의 주석:

> "생성은 admin API 전용. **클라 직접 update는 settings의 의사명 일괄변경(admin)뿐.**"

하지만 실제 조건은:

```
allow update: if isActiveStaff()
  && request.resource.data.isDeleted == resource.data.isDeleted
  && request.resource.data.createdByUid == resource.data.createdByUid;
```

`isAdmin()`이 아니라 `isActiveStaff()`다. 즉 **role이 `interpreter`/`staff`인 최하위 권한 직원도** 브라우저 콘솔에서
`updateDoc(doc(db,"reservations",id), {...})`를 직접 호출해 `isDeleted`/`createdByUid`를 제외한 **모든 필드**를
자유롭게 바꿀 수 있다 — 예약금(depositAmount), 수술비용(surgeryCost), 담당의(doctors), 예약상태
(doctorStatusMap), 인보이스 연결(invoiceId/invoiceStatus) 등.

이 경로로 수정하면:
- `/api/reservations`의 `update` 액션이 하는 **중복검사(normDupKey)/환자 동기화(patientPatch)/검색토큰 재생성**이
  전혀 실행되지 않는다.
- **감사 로그(`logs`)가 남지 않는다** — admin SDK 경유가 아니므로 `createLog` 호출 자체가 코드상 존재하지 않는
  경로다. 06월 문서가 강점으로 꼽은 "모든 변경에 logs 기록"이 **이 경로에서는 깨진다.**
- `updatedBy/updatedByUid`도 강제되지 않는다 — 클라이언트가 임의의 값을 써서 다른 직원이 수정한 것처럼
  위장 가능(신원 위조 방지가 API 레이어에만 있고 규칙에는 없음).

`lib/settings.ts:576`의 의사명 일괄변경(`where("doctors","array-contains",oldDisplayName)` → `batch.update`)은
분명 admin 전용 UI 흐름이지만, **규칙이 그 흐름만 허용하도록 좁혀져 있지 않다.** 실제로 이 흐름을 호출하는
`updateStaffFromSettings`는 `assertCanManageSettings(actor)`로 admin만 걸러내지만, 그건 **애플리케이션 코드의
방어일 뿐 Firestore 규칙의 방어가 아니다** — 즉 UI를 거치지 않고 Firebase 클라이언트 SDK를 직접 쓰면 누구나
(active staff이기만 하면) 우회 가능하다.

**권장 수정**:
```
allow update: if isActiveStaff()
  && request.resource.data.isDeleted == resource.data.isDeleted
  && request.resource.data.createdByUid == resource.data.createdByUid
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(["doctors", "updatedAt", "updatedBy", "updatedByUid"])
  && isAdmin();
```
처럼 **허용 필드 화이트리스트 + admin 한정**으로 좁히거나, 아예 클라 직접 update 자체를 막고(`allow update: if false`)
의사명 일괄변경도 `/api/reservations`의 새 action으로 옮기는 편이 "모든 쓰기는 admin SDK 경유"라는 설계
원칙과 일관된다.

---

## 2. 인덱스 ↔ 쿼리 정합성

### 2.1 죽은 인덱스 (쿼리에서 안 쓰임 — 쓰기 비용만 유발)

`firestore.indexes.json`의 `reservationNotes` 복합 인덱스 3개 전부가 **현재 코드에서 쓰이지 않는다.**

`app/api/reservation-notes/route.ts:28`의 실제 조회는:
```ts
adminDb.collection("reservationNotes").where(field, "==", value).limit(100).get();
```
단일 필드 `==` + `limit`뿐이고 `orderBy`가 없다 — 이건 자동 단일 필드 색인만으로 충분하다. 그런데 인덱스 파일에는:
- `reservationDocId + createdAt desc`
- `isDeleted + reservationId + createdAt desc`
- `patientId + createdAt asc`

3개 복합 인덱스가 선언돼 있다. 코드 어디에서도 이 조합으로 `orderBy`를 쓰지 않으므로 **읽기 성능에 아무 도움이
안 되고, `reservationNotes` 문서를 쓸 때마다(생성/수정/소프트삭제) 3개 인덱스 항목을 추가로 유지비용만
지불한다.** (아마 과거 쿼리 방식에서 지금의 단순 `where+limit` 방식으로 리팩터링하며 인덱스 정리를 빠뜨린 것으로 보임.)
→ **정리 권장**: 실제로 `orderBy(createdAt)`가 필요하면(현재는 클라에서 정렬하는지 확인 필요) 인덱스 1개만
남기고, 아니라면 3개 다 삭제.

### 2.2 중복 인덱스 (같은 목적에 인덱스 2개)

```json
{ "reservations": ["isDeleted asc", "reservationDate desc"] },
{ "reservations": ["isDeleted asc", "reservationDate asc"] }
```

`lib/reservations.ts:442-447`과 `app/api/reservations/route.ts`의 `read_all`은 모두
`where(isDeleted,"==",false).where(reservationDate,">=",fromDate)` 형태이고, `read_all`만 `orderBy(reservationDate,"desc")`를
쓴다. **`orderBy` 없는 범위 쿼리(client onSnapshot)는 두 방향 인덱스 중 아무거나로 서비스 가능**하므로,
`desc` 인덱스 하나만 있으면 `read_all`(orderBy desc)과 클라 구독(orderBy 없음) 둘 다 커버된다.
`asc` 버전은 실사용 쿼리가 없어 보이는데, 존재한다면 어디서 쓰는지 확인하고 없으면 삭제 — 있으나 마나 한
인덱스가 예약 문서 쓰기(생성/상태변경/삭제 모두 빈번)마다 유지비용을 더한다.

### 2.3 배포 상태 불일치 의심 (스크린샷 vs 인덱스 파일)

첨부 콘솔 캡처는 **"1–18/18"** — 총 18개 인덱스만 배포돼 있다. 그런데 `firestore.indexes.json`은
**20개**를 선언한다(스크린샷에 없는 2개: `patients[isDeleted+createdAt]`, `staff[role+active]`).

- `patients[isDeleted+createdAt]`은 코드 주석(`app/api/reservations/route.ts:199-203`)에 명시된 대로
  **의도적으로 미리 선언만 해둔 "미래용" 인덱스**다 — 지금의 `list_patients`는 `orderBy(createdAt)`만 쓰고
  `where(isDeleted)`는 메모리 필터라 이 인덱스가 없어도 정상 동작한다. **문제 없음.**
- `staff[role+active]`는 다르다 — `getClientDoctors()`(`lib/reservations.ts:400`)와
  `getCachedDoctors()`(`app/api/reservations/route.ts:23`) **둘 다 지금 당장** `where("role","==","doctor").where("active","==",true)`를
  쓴다. 다만 이 쿼리는 **동등(`==`) 조건 2개뿐이고 `orderBy`가 없어서, Firestore 자동 단일 필드 인덱스만으로도
  서비스 가능한 패턴**이다(복합 인덱스가 필요한 건 range/array-contains 조합이나 다른 필드 `orderBy`가 붙을 때).
  즉 스크린샷에 이 인덱스가 없어도 지금은 정상 동작 중일 가능성이 높다 — 그래서 파일에는 있는데 콘솔엔 없는
  상태가 방치돼도 티가 안 났을 것이다.

**확인 필요 액션**: `firebase deploy --only firestore:indexes`로 실제 배포 상태를 파일과 동기화하거나,
`staff[role+active]`가 정말 필요없다면(위 추론이 맞다면) 파일에서 제거해 "선언과 배포가 항상 일치"하는
상태로 되돌릴 것. 지금처럼 파일과 콘솔이 어긋난 채로 두면, 나중에 이 쿼리에 `orderBy`(예: `orderBy("orderNo")`)가
추가되는 순간 복합 인덱스가 진짜로 필요해지는데 **"파일에 이미 있으니 됐다"고 착각**하고 실제 배포를 빼먹기
쉽다.

---

## 3. 규칙 평가 자체의 읽기 비용 — 우려할 수준 아님

`isActiveStaff()`/`isAdmin()`이 `get(staff/{request.auth.uid})`를 호출하는데, 이 조건은 **응답으로 반환되는
문서(resource) 데이터에 의존하지 않고 오직 `request.auth.uid`(요청자 자신)만 본다.** Firestore는 이런 규칙을
쿼리/리스너 attach당 **한 번만 평가**하며, 매칭된 문서 수(N)에 비례해 반복 평가하지 않는다.

즉 `subscribeAllReservations`가 예약 문서 300~1,500건을 읽는 06월 문서의 "읽기 비용 폭증" 문제와, 이번에 본
`staffDoc()` get() 비용은 **완전히 별개**다 — 규칙 평가 비용은 리스너 attach당 +1 read 수준으로 무시 가능하고,
진짜 병목은 여전히 06월 문서가 짚은 "`limit` 없는 onSnapshot 재구독"이다. (`staff/create`처럼 `isAdmin()`이
`exists()`+`data.role` 두 번 접근을 요구하는 경로가 있지만, 이는 admin의 신규 직원 생성처럼 저빈도 쓰기
경로라 실질 영향 없음.)

---

## 4. 행(row) 단위 권한 분리 부재 — 설계 확인 필요

`isActiveStaff()`는 **role과 무관하게** `reservations`/`staff`/`reservationPhotos`/`reservationCharts`
전체 컬렉션의 모든 필드에 대한 read를 허용한다. 즉:
- `interpreter` role도 모든 환자의 이름·연락처·예약금·수술비용·전체 스태프 이메일 목록을 클라 SDK로 직접
  읽을 수 있다.
- 코디네이터별 스코프 제한은 `/api/invoices`(서버 API)에만 있고, `reservations` 자체에는 그런 스코프가
  전혀 없다.

CRM 특성상 "모든 직원이 전체 일정을 봐야 한다"는 업무 요구일 가능성이 높아 **버그라기보단 설계 선택**으로
보이지만, 지금 규칙/코드 어디에도 이게 의도적 결정이라는 근거(주석)가 없다. 실제로 그렇다면 문제 없고, 만약
"통역사는 자기 담당 예약만" 같은 요구가 나중에 생기면 지금 구조(전체 오픈)에서 되돌리는 비용이 크므로 **지금
문서화**해두는 걸 권장.

---

## 5. 정리 — 실사용 전 체크리스트 (rules/indexes 한정)

- [ ] **P0** `reservations` update 규칙을 admin + 필드 화이트리스트로 좁히기 (§1) — 지금은 최하위 권한
      직원도 임의 필드를 감사로그 없이 수정 가능한 실질적 구멍.
- [ ] **P1** `reservationNotes` 죽은 복합 인덱스 3개 삭제 또는 실제 `orderBy` 코드 추가 (§2.1).
- [ ] **P1** `reservations[isDeleted+reservationDate]` asc/desc 중복 인덱스 중 미사용 방향 제거 (§2.2).
- [ ] **P1** `firestore.indexes.json` ↔ 콘솔 배포 상태 동기화, 특히 `staff[role+active]` 필요 여부 재확인 (§2.3).
- [ ] **P2** 역할별 row-level 스코프가 의도된 설계인지 문서화 (§4).

06월 문서의 P0(전역 단일 구독 통합, persistentLocalCache, 대시보드 실시간 해제)는 여전히 **비용 개선의
1순위**이며, 이번 문서의 §1(권한 구멍)이 **보안 관점의 1순위**다. 둘 다 실사용 전 처리 권장.
