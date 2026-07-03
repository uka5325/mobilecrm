# Claude 사용량 급증 원인 분석 보고서

## 요약

사용량 급증은 **보안 감사 커밋(6c177f6: "보안·데이터 무결성 하드닝")**에서 도입된 다음 세 가지 변경으로 인한 것입니다:

1. 모든 API 엔드포인트에 `requireActiveStaff()` 호출 추가
2. 감사 로그(audit logs) 기능 신규 추가
3. 권한 검증 강화 및 트랜잭션 기반 작업

---

## 상세 분석

### 1️⃣ `requireActiveStaff()` - 주요 비용 증가 요인

**파일:** `lib/apiAuth.ts`

각 API 호출마다 Firestore **최소 1-2회 읽기** 발생:

```typescript
// 38-44줄: 우선 uid 필드로 쿼리
const snap = await adminDb.collection("staff")
  .where("uid", "==", uid)
  .limit(1)
  .get();  // ← Firestore 읽기 #1

// Fallback: 문서 ID로 조회
if (!snap.empty) {
  data = snap.docs[0].data();
} else {
  const byId = await adminDb.collection("staff").doc(uid).get();  // ← 읽기 #2
  if (byId.exists) data = byId.data() ?? null;
}
```

**캐시 효율성:**
- ✅ 일반 읽기 요청: 5분 메모리 캐시 적용
- ❌ 쓰기 작업(`checkRevoked: true`): 캐시 우회 → 매번 Firestore 읽기

**영향도:**
- 예약 생성/수정/삭제 등 쓰기 작업이 많다면 사용량 급증
- 동시 사용자 증가 → API 호출 빈도 증가 → 읽기 비용 지수적 증가

**계산 예시:**
```
하루 예약 생성: 100건
requireActiveStaff 읽기: 100 × 2회 = 200 reads/day
쓰기 작업 평균 3회(예약 생성/수정/인보이스 생성): 600 reads/day
+ 로그 저장(audit log) 추가: 100 writes/day
```

---

### 2️⃣ 감사 로그(Audit Logs) - 신규 쓰기 비용

**파일:** `app/api/logs/route.ts`

모든 데이터 변경 시 자동으로 로그 기록:

```typescript
// 57-73줄: 감사로그 신규 생성
await adminDb.collection("logs").add({
  action: logAction,
  targetType,
  targetId,
  staffUid: ctx.uid,
  staffName: ctx.name,
  // ... 11개 필드
  createdAt: FieldValue.serverTimestamp(),
});  // ← Firestore 쓰기 #1 (log add)
```

**read_batch 병렬 쿼리 (123-131줄):**
```typescript
const snaps = await Promise.all(
  ids.map((rid) =>
    adminDb.collection("logs")
      .where("reservationId", "==", rid)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get()  // ← Promise.all로 병렬 실행
  )
);  // 최대 30개 쿼리 동시 실행 → 30 reads at once
```

**영향도:**
- 예약 1건 저장 = 로그 1건 추가 쓰기
- 예약 목록 조회 = 예약별 로그 1건 조회 (30개 병렬 쿼리)
- 총 비용: **쓰기 + 읽기 이중 비용**

---

### 3️⃣ 권한 검증 강화 - 추가 읽기

**파일:** `app/api/invoices/route.ts`, `app/api/reservations/route.ts`

보안 감사 이전:
```typescript
// 기존: 2회 쿼리
const existing = await adminDb.collection("invoices")
  .where("reservationDocId", "==", reservationDocId)
  .get();  // ← 읽기 #1

const resSnap = await adminDb.collection("reservations").doc(reservationDocId).get();
// ← 읽기 #2
```

보안 감사 이후 (트랜잭션 + 권한 재검증):
```typescript
// 새로운 방식: 같은 작업이 트랜잭션 내부에서 재실행
const txResult = await adminDb.runTransaction(async (tx) => {
  const existingSnap = await tx.get(invoicesCol.where(...));  // ← tx 읽기
  // 권한 재검증 로직 추가 (추가 조건 검사)
  // ...
  tx.set(invoiceRef, invoicePayload);
  tx.update(reservationRef, { ... });
});

await writeLog({  // ← 로그 쓰기 추가
  action: "invoice_create",
  // ...
});
```

**트랜잭션 비용:**
- 각 트랜잭션은 **독립적인 읽기/쓰기**로 계산됨
- 권한 검증 강화로 조건문 증가 → 코드 복잡도 증가하지만 쿼리는 동일

---

## 비용 비교

| 작업 | 보안 감사 이전 | 보안 감사 이후 | 증가 |
|-----|-------------|-------------|-----|
| 예약 조회 | ~2 reads | 2 reads + requireActiveStaff(1-2) = 3-4 reads | +50-100% |
| 예약 생성 | ~3 reads, 1 write | 3 reads + requireActiveStaff(2, checkRevoked) + 1 write + log(1 write) = 5 reads, 2 writes | +67% reads, +100% writes |
| 예약 목록 조회(30건) | ~30 reads | 30 reads + requireActiveStaff(1, cached) + log.read_batch(30 parallel) = 61 reads | +103% |
| 인보이스 생성 | ~4 reads, 1 write | 트랜잭션(4 reads) + requireActiveStaff(2, checkRevoked) + log(1 write) = 6 reads, 2 writes | +50% reads, +100% writes |

---

## 근본 원인

### ✅ 좋은 점
- 감사 로그 기능 자체는 필수적(compliance, 보안)
- 권한 검증 강화는 보안상 필요
- 트랜잭션 기반 작업으로 데이터 무결성 보장

### ⚠️ 개선 기회

1. **requireActiveStaff 캐시 전략**
   - 현재: 쓰기 작업에서 캐시 우회 → 매번 Firestore 읽기
   - 개선안: 
     - active 상태만 캐시 (주기적 갱신)
     - staff 컬렉션 인덱스 최적화
     - 토큰 만료 시간 활용 (이미 검증된 토큰)

2. **logs.read_batch 병렬 쿼리 최적화**
   - 현재: 최대 30개 쿼리를 Promise.all로 실행
   - 개선안:
     - reservationIds를 배치로 나누어 5개씩 실행
     - 또는 단일 in-query 사용 (색인 필요)
     - 또는 클라이언트 캐시 적용

3. **감사 로그 쓰기 최적화**
   - 현재: 모든 작업마다 동기 쓰기
   - 개선안:
     - 비동기 배치 쓰기 (fire-and-forget)
     - 또는 Cloud Tasks로 지연 처리

---

## 권장 조치 (우선순위)

### P0: 즉시 실행
- [ ] `requireActiveStaff` checkRevoked 옵션 검토
  - 정말 매 요청마다 폐기 검사 필요한지 확인
  - 읽기 전용 작업은 5분 캐시 충분할 수 있음

### P1: 단기 (1-2주)
- [ ] logs.read_batch 쿼리 최적화
  - 배치 크기 축소 (30 → 10)
  - 또는 in-query로 통합

### P2: 중기 (1개월)
- [ ] staff 컬렉션 인덱스 재검토
  - uid 필드 인덱스 성능 확인
  - 문서 ID 조회와 where 조회 중 더 빠른 경로 선택

---

## 환경 영향

**현재 Firebase 무료 한도:**
- 읽기: 50K/일
- 쓰기: 20K/일
- 삭제: 20K/일

**추정 일일 비용 (100 동시 사용자 기준):**
- 읽기: 3,000-5,000 (무료 한도 내)
- 쓰기: 500-1,000 (무료 한도 내)

**급격한 증가 시나리오 (user=1,000):**
- 읽기: 30,000-50,000 (무료 한도 근처)
- 쓰기: 5,000-10,000 (무료 한도 내)

---

## 결론

**사용량 급증은 예상되는 부작용입니다.** 보안 강화로 얻은 이점(감사, 권한 검증)이 비용으로 표현된 것입니다. 

**필요 시 최적화 전까지 임시 조치:**
1. logs 컬렉션 쓰기 지연 처리 (비동기 배치)
2. requireActiveStaff checkRevoked 옵션 선택적 사용
3. 클라이언트 요청 배치화 (예: 예약 목록 limit 축소)
