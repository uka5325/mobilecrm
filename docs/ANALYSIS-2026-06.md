# MobileCRM 실사용 전 심층 분석 평가

> 분석일: 2026-06-30 · 대상 브랜치 기준 코드 스냅샷 (Next.js 16.2.9 / React 19 / Firebase 11 / firebase-admin 13)
> 범위: 구조·기능·UX·성능·보안 개요·**Firebase 무료 한도 비용 예측**
> 제외(별도 분석 예정): **firestore.rules 상세 / firestore.indexes.json 상세**

---

## 0. 한눈에 보기 (Executive Summary)

상담회/병원 운영을 위한 모바일 우선(Mobile-first) CRM. 예약·고객·KPI·인보이스·커미션·로그를
하나의 Next.js App Router 앱에 담았고, 데이터는 Firestore + Cloud Storage, 인증은 Firebase Auth를 사용한다.

**핵심 설계는 견고하다.** 민감 컬렉션(인보이스/로그/환자/메모/설정)은 전부 firebase-admin SDK를 쓰는
서버 API(`/api/*`)를 경유하고, 클라이언트 SDK 직접 접근은 실시간이 꼭 필요한 `reservations`·`staff`·
사진/차트로만 제한했다. 서버 API는 공통 가드(`requireActiveStaff`)로 "로그인 여부"가 아니라 "active 직원인지"를
검증하고, 작성자 신원을 토큰에서 강제로 덮어써 위조를 막는다. 감사 로그, 소프트 삭제, 토큰 폐기 검사,
로그아웃 시 공용기기 캐시 purge 등 실무 보안 감각이 곳곳에 배어 있다.

**가장 큰 실사용 리스크는 보안이 아니라 "Firestore 읽기 비용"이다.** 스케줄·대시보드·고객관리 3개 페이지가
모두 **`limit` 없는 클라이언트 `onSnapshot`** 으로 최근 45일 전체 예약을 실시간 구독한다. localStorage 캐시는
체감 속도만 개선할 뿐, `onSnapshot`은 리스너가 붙을 때마다 서버를 읽으므로 **무료 한도(읽기 5만/일)를 중간 규모
이상에서 쉽게 초과**한다. 이 부분이 "무료 한도 내 운영" 목표의 1순위 병목이다.

### 종합 평점

| 항목 | 점수 | 코멘트 |
|---|---|---|
| 아키텍처/구조 | ★★★★☆ (4.3) | 서버/클라 경계, 캐시 계층, 모듈 분리가 명확. 일부 read 함수 중복. |
| 보안 설계 | ★★★★☆ (4.2) | admin 경유·신원 강제·감사로그·캐시 purge. (규칙 상세는 별도) |
| 기능 완성도 | ★★★★☆ (4.0) | 예약·KPI·인보이스·커미션·로그·파일까지 실무 범위를 폭넓게 커버. |
| 사용 편의(UX) | ★★★★☆ (3.9) | 모바일 최적화·즉시표시 캐시·오프라인 배너 良. 에러/빈상태 처리 보강 여지. |
| **비용 효율(무료한도)** | **★★☆☆☆ (2.5)** | **무한정 onSnapshot 재구독이 읽기 비용을 폭증시킴. 최우선 개선 대상.** |
| 코드 품질/유지보수 | ★★★★☆ (4.0) | 주석·네이밍·타입 우수. 테스트는 units/rules 2종으로 얇음. |
| **총평** | **★★★★☆ (3.8)** | 소규모(직원 수명·예약 저volume)면 즉시 실사용 가능. 중규모 이상은 비용 개선 선행 권장. |

---

## 1. 아키텍처 & 구조

### 1.1 데이터 접근 2-트랙 모델 (좋은 설계)

```
                    ┌─ 클라이언트 SDK 직접 (firestore.rules가 방어선)
                    │     reservations(onSnapshot 읽기/일괄 update)
  브라우저 ─────────┤     staff(읽기), reservationPhotos, reservationCharts
                    │
                    └─ 서버 API /api/* (firebase-admin, 규칙 우회)
                          invoices · logs · patients · reservationNotes
                          conferenceMemos · settings · staff/create ...
                          └ requireActiveStaff() 공통 가드 + ctx로 신원 강제
```

- **장점**: 민감 데이터는 규칙을 우회하는 admin SDK로만 다루되, 그 앞단에 `requireActiveStaff`(active 직원 검증
  + 쓰기 시 `checkRevoked`)를 둬 "Firebase 로그인 ≠ 접근 권한"을 분명히 했다. 작성자/수정자 필드는 항상
  `ctx.uid/ctx.name`으로 덮어써 클라이언트 위조를 차단(`reservations`·`invoices`·`logs` 모두 일관).
- **캐시 계층화**: 서버 메모리 캐시(doctors 10분, staff 검증 5분) + 클라 캐시(localStorage/sessionStorage,
  TTL 2~10분, uid별 키, 로그아웃 purge)를 분리. `lib/clientCache.ts`를 leaf 모듈로 두어 순환 의존 없이
  purge 출처를 단일화한 점이 깔끔하다.

### 1.2 모듈 구성

- `lib/*`: 도메인 로직(reservations 1,132줄, settings 793줄, invoices 357줄 등) — 페이지에서 분리 良.
- `hooks/*`: `useCurrentUser`, `useReservationData`, `useTimelineData` — 데이터 구독/캐시 캡슐화.
- `components/*`: 대시보드/예약/타임라인/설정/인보이스 도메인별 폴더 분리 良.
- `app/api/*`: 8개 라우트가 `{action, payload}` 디스패치 패턴으로 통일.
- 총 ~17k 줄, 외부 의존성 최소(firebase, next, react, dnd-kit만). 군더더기 없음.

### 1.3 구조적 약점

1. **read 함수 3중 중복**: `getAllReservations` / `fetchAllReservationsOnce`는 본문이 거의 동일하고,
   `getTimelineReservations`도 매핑·정렬 로직이 반복된다. 45일 계산 IIFE가 4곳에 복붙되어 있다 → 공용 헬퍼화 권장.
2. **실시간 구독이 페이지마다 독립**: schedule·dashboard·reservations가 각각 `subscribeAllReservations`를
   마운트한다. App Router는 페이지 이동 시 언마운트→재마운트하므로 **이동할 때마다 리스너가 새로 붙는다**(비용 직결, §5).
3. **Firestore 영속 캐시 미사용**: `initializeFirestore`에 `experimentalForceLongPolling`만 켜고
   `persistentLocalCache`(IndexedDB)는 미설정. 재구독 시 델타만 읽는 최적화를 못 살리고 매번 전량 읽는다.
4. `firebaseAdmin` 미초기화 시 `adminDb`/`adminAuth`가 `null!`이라 가드를 통과하면 NPE 가능(다만 `requireActiveStaff`가
   `adminInitialized`를 먼저 503으로 막아 실질 영향은 작음).

---

## 2. 기능 분석

| 영역 | 구현 | 평가 |
|---|---|---|
| 인증/권한 | 이메일·Google 로그인, 4단계 role(admin>coordinator>staff>interpreter), active 검사, 토큰 폐기 | 실무적. 로그인 실패 메시지 단일화로 계정 열거 방지까지 신경 씀. |
| 예약/스케줄 | 일·주·월 뷰, 실시간 반영, 의사별 상태맵(doctorStatusMap), 수술예약 토글, 중복 등록 차단 | 도메인 모델 풍부. 상태 메타(updatedBy/At/role)까지 기록. |
| 고객관리 | 환자 목록(최대 2,000), 이력 페이지네이션(cursor), 시트 import | 검색이 전량 클라 필터 → 대용량 시 서버검색 전환 필요(코드에 주석으로 인지됨). |
| KPI 대시보드 | 병원·유형·부위 필터, 기간 집계 | 45일 구독 위에서 클라 집계. 실시간일 필요는 낮음(§5 개선 후보). |
| 인보이스/커미션 | 생성/수정/삭제, 권한 스코프 쿼리(coordinatorUids 우선·이름 폴백), 합계 정확화 | 권한을 쿼리로 내려 누락/오합계를 막은 설계가 특히 좋음. HARD_CAP 1000 경고 플래그 제공. |
| 감사 로그 | 모든 변경에 logs 기록, 예약별 최신 1건 배치 조회 | 추적성 우수. 단 logs는 무한 증가(보존정책 없음 → 저장/쓰기 비용·§5). |
| 파일/사진 | Storage 업로드, 이미지 압축, 인증 프록시 다운로드 | proxy-image가 인증+도메인 화이트리스트+20MB 제한으로 오픈프록시/SSRF 방어 良. |

**기능 공백/제안**
- 비밀번호 재설정은 있으나 **회원가입 UI 없음**(직원 생성은 admin의 `/api/staff/create` 경유) — 의도된 폐쇄형. 문서화 권장.
- 예약 **하드 삭제 불가**(소프트 삭제만) — 데이터 안전상 적절. 단 logs/soft-deleted 누적 정리 배치가 없음.
- KPI **CSV/엑셀 내보내기**, 인보이스 **PDF 출력**이 있으면 실무 가치 큼(현재 미확인/부재).

---

## 3. 사용 편의 (UX)

**잘 된 점**
- 모바일 우선 레이아웃, 데스크톱 사이드바/모바일 상단탭 분기, 빠른 실행·권한칩 등 운영자 친화적.
- **즉시 표시 캐시**: 홈/스케줄/예약이 캐시를 먼저 그리고 백그라운드 갱신 → 재진입 시 로딩 깜빡임 최소화.
- 오프라인 배너(`navigator.onLine`), 포커스/가시성 변경 시 직원정보 silent 재검증 → 비활성화 즉시 반영.
- 로그인 실패·권한 부족 등 한국어 안내 메시지가 친절하고 일관적.

**개선 여지**
1. **에러 상태가 콘솔 중심**: 여러 로드 실패가 `console.error`로만 끝나고 사용자에겐 빈 화면/무반응으로 보이는
   경로가 있다(예: 대시보드 일부, 이력 조회). 토스트/재시도 버튼 일관 적용 권장.
2. **빈 상태(empty state)**: "등록된 OO이 없습니다" 패턴은 있으나, 필터 결과 0건/검색 0건 구분 안내가 약함.
3. **대시보드·고객 목록 대용량 UX**: 전량 로드 후 클라 필터라 데이터가 커질수록 입력 지연 가능 → 서버 페이징/검색.
4. 접근성: 이모지 아이콘 + 색상 의존 상태표시 → 색맹/스크린리더 보조 라벨(aria) 보강 권장.
5. `v1.0 · Firebase / Vercel` 정적 버전 표기 → 실제 배포 버전/빌드 해시 노출이면 지원에 유용.

---

## 4. 보안 개요 (규칙 상세는 별도 분석)

- **강점**: ① 민감 컬렉션 admin 경유 + 클라 직접 접근 차단, ② 신원 토큰 강제(위조 차단), ③ 쓰기 시 토큰 폐기 검사,
  ④ 로그인 실패 메시지 단일화(계정 열거 방지), ⑤ 로그아웃/세션 종료 시 공용기기 캐시 purge(PII·금액 잔존 차단),
  ⑥ proxy-image 오픈프록시 방어.
- **점검 포인트**(별도 규칙 분석에서 교차검증 필요):
  - `verify-staff`는 `checkRevoked` 없이 토큰 검증 → 세션 캐시 갱신용이라 영향은 제한적이나, 비활성화 즉시성은
    쓰기 경로(`checkRevoked:true`)와 5분 staff 캐시에 의존.
  - `NEXT_PUBLIC_*` 노출로 직원이 클라 SDK로 직접 `reservations`/`staff`를 읽을 수 있음 → **방어선이 전적으로
    firestore.rules**라는 점에서, 규칙 별도 분석의 우선순위가 높다(특히 `reservations` 필드 단위 검증).
  - 서버 메모리 staff 캐시 5분: 권한 강등이 최대 5분 지연될 수 있음(보안/UX 트레이드오프, 문서화 권장).

---

## 5. Firebase 무료 한도(Spark) 비용 예측 — 핵심

### 5.1 무료 한도(일/월) 기준

| 리소스 | 무료 한도 | 본 앱 사용 |
|---|---|---|
| Firestore **읽기** | **50,000 / 일** | **● 병목 1순위** |
| Firestore 쓰기 | 20,000 / 일 | 여유(△ 로그가 2배율) |
| Firestore 삭제 | 20,000 / 일 | 거의 없음(소프트삭제) |
| Firestore 저장 | 1 GiB | 로그/예약 누적 주시 |
| Auth | 50,000 MAU | 충분 |
| Cloud Storage | (신규 프로젝트는 **Blaze 필요**) 레거시 5GB/1GB일 다운로드 | 사진/파일 → 주의 |
| Cloud Functions | — | **미사용**(Vercel API) → 비용 0, 좋음 |
| Hosting | — | **Vercel 사용** → Firebase Hosting 비용 0 |

### 5.2 읽기 비용이 폭증하는 구조 (가장 중요)

`subscribeAllReservations`(lib/reservations.ts)와 `subscribeTimelineReservations`는 **클라이언트 onSnapshot**이며
쿼리에 **`limit`이 없다**:

```ts
onSnapshot(query(
  collection(db, "reservations"),
  where("isDeleted", "==", false),
  where("reservationDate", ">=", today-45d)   // ← 상한 없음
))
```

이 구독을 **schedule·dashboard·reservations 3개 페이지가 각각** 마운트한다. 중요한 사실 두 가지:

1. **onSnapshot은 리스너가 붙을 때마다 매칭 문서 전량을 서버에서 읽는다.** localStorage 캐시는 화면만 먼저
   채울 뿐 Firestore 읽기를 줄이지 못한다. 게다가 **persistentLocalCache 미설정**이라 재구독 시 델타 최적화도 없다.
2. App Router는 페이지 이동마다 언마운트→재마운트 → **schedule↔dashboard↔reservations를 오갈 때마다 전량 재읽기.**
3. 추가로, 누군가 예약 상태를 바꾸면 **열려 있는 모든 리스너가 변경 문서를 1건씩 다시 읽는다**(N리스너 × 변경 건수).

### 5.3 시나리오별 일일 읽기 추정

`N` = 최근 45일 윈도우의 미삭제 예약 문서 수. (`onSnapshot` 1회 attach = 약 `N` reads)

| 시나리오 | N(문서) | 직원 | 구독페이지 이동/인1일 | 라이브갱신 reads | **예상 reads/일** | 무료한도(5만) |
|---|---:|---:|---:|---:|---:|---|
| 소형(저volume) | 300 | 3 | 10 | ~1k | **~10,000** | ✅ 여유 |
| 소~중형 | 600 | 5 | 15 | ~3k | **~48,000** | ⚠️ 임계 |
| 중형 | 900 | 7 | 20 | ~5k | **~131,000** | ❌ 2.6배 초과 |
| 중~대형 | 1,500 | 10 | 20 | ~8k | **~308,000** | ❌ 6배 초과 |

> 계산식 ≈ `N × (이동횟수) × 직원수 + 라이브갱신`. 상담회처럼 상태 변경이 잦은 날은 라이브갱신분이 더 커진다.
> 즉 **직원 수명·하루 수십 건 규모면 무료로 충분**하지만, **예약이 수백~천 단위로 쌓이고 직원이 5명을 넘으면
> 무료 한도를 초과**한다.

### 5.4 쓰기/저장 비용

- **쓰기**: 예약 생성=2~3 writes(patient+reservation+log), 상태변경=2 writes(doc+log), 인보이스=3~4 writes.
  하루 수백 작업이어도 보통 수천 writes로 **20,000/일 한도 내**. 다만 **모든 변경이 logs를 1건 더 쓰므로 실효 2배율**.
- **저장(1GiB)**: 예약/환자/인보이스 문서는 가벼우나 **logs가 보존정책 없이 무한 증가**한다. before/after 스냅샷까지
  담으면 장기적으로 1GiB 압박 가능 → TTL/주기 아카이브 필요.
- **Storage(사진/파일)**: `imageCompress`로 업로드 전 압축하는 점은 비용에 유리. 단 **신규 Firebase 프로젝트는
  Cloud Storage 사용에 Blaze(결제수단 등록) 필요** → "완전 무료" 전제라면 사진 기능 사용 가능 여부를 먼저 확인해야 함.

### 5.5 비용 절감 우선순위 (적용 시 효과 큰 순)

1. **[효과 최대] 전역 단일 구독으로 통합** — `subscribeAllReservations`를 AppShell/Context에서 1회만 마운트하고
   schedule·dashboard·reservations가 공유. 페이지 이동 시 재읽기가 사라져 **읽기를 수배~수십배 절감**.
2. **[효과 큼] Firestore 영속 캐시 활성화** — `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })`.
   재구독 시 변경 델타만 읽어 attach당 전량 읽기를 제거.
3. **[효과 큼] 대시보드는 실시간 해제** — KPI는 즉시성이 낮음. `onSnapshot` 대신 1회 `getDocs`(+캐시)로 전환하고
   기간도 사용자가 고른 범위만 조회(현재 45일 전량 후 클라 필터).
4. **[중] onSnapshot에 `limit`/날짜 상한 부여** — 스케줄은 보는 주/월 범위로 쿼리를 좁힌다.
5. **[중] logs 보존정책** — N개월 경과 로그 TTL 또는 아카이브로 저장/쓰기·조회 비용 관리.
6. **[소] 라이브 갱신 최소화** — 동일 데이터를 보는 화면이 여럿일 때 리스너 수를 구조적으로 제한.

> 위 1·2만 적용해도 §5.3의 "중형" 시나리오 읽기를 무료 한도 안으로 되돌릴 여지가 크다.

---

## 6. 개선 사항 (우선순위)

### P0 — 실사용 전 처리 권장 (비용/안정성 직결)
- [ ] 예약 실시간 구독을 **전역 단일 리스너**로 통합(§5.5-1).
- [ ] **persistentLocalCache** 활성화(§5.5-2).
- [ ] **대시보드 실시간 해제** + 기간 한정 조회(§5.5-3).
- [ ] Cloud Storage **Blaze 필요 여부 확인**(사진/파일 기능 사용 전제 시).

### P1 — 출시 직후 개선
- [ ] read 함수 3종(`getAllReservations`/`fetchAllReservationsOnce`/`getTimelineReservations`) 공용화, 45일 IIFE 헬퍼화.
- [ ] 로드 실패 UX 일원화(토스트+재시도), 빈상태/검색 0건 구분.
- [ ] logs **보존정책**(TTL/아카이브) 도입.
- [ ] 고객/대시보드 **서버사이드 검색·페이징** 전환(대용량 대비, 코드 주석에 이미 인지됨).

### P2 — 품질/운영
- [ ] 테스트 보강: 현재 units/rules 2종 → API 라우트·권한 분기·커미션 합계 단위테스트 추가.
- [ ] KPI CSV 내보내기 / 인보이스 PDF 출력.
- [ ] 접근성(aria 라벨, 색상 외 상태표시), 실제 빌드 버전 표기.
- [ ] README가 create-next-app 기본 문구 → 프로젝트 실제 셋업/환경변수 문서로 교체.

---

## 7. 결론

- **지금 바로 실사용 가능한가?** — **소규모(직원 수명·하루 수십 건)면 Yes.** 설계·보안·기능이 그 규모에서 충분히 견고하다.
- **무료 한도 내 지속 가능?** — **구조 개선 없이는 중규모부터 No.** 원인은 보안이 아니라 **무한정 onSnapshot 재구독**이다.
  §5.5의 1·2(전역 단일 구독 + 영속 캐시)만 선반영하면 무료 한도 운영 범위를 크게 넓힐 수 있다.
- **다음 단계** — 본 평가에서 의도적으로 제외한 **firestore.rules / firestore.indexes.json 상세 분석**을 이어서 진행하면,
  클라 직접 접근(`reservations`/`staff`)의 필드 단위 방어선과 쿼리-인덱스 정합성까지 마무리된다.
</content>
</invoke>
