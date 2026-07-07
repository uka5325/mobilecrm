# 배포 안전 정책 (Deployment Safety)

MobileCRM은 환자 의료정보(PII)를 다루므로, 코드/rules 배포는 반드시 자동 검증을 통과한 뒤에만 수행한다.

## Branch protection (GitHub UI 설정 체크리스트)

`main` 브랜치에 다음 보호 규칙을 설정한다(Settings → Branches → Branch protection rules).

- [ ] `main` 직접 push 금지 (Require a pull request before merging)
- [ ] PR 필수, 최소 1명 이상 리뷰 승인 (Require approvals: 1)
- [ ] 미해결 review conversation이 있으면 merge 금지 (Require conversation resolution before merging)
- [ ] Status check 필수 — **CI** job이 반드시 통과해야 merge 가능 (Require status checks to pass: `CI`)
- [ ] Status check는 최신 브랜치 기준 (Require branches to be up to date before merging)
- [ ] force push / branch 삭제 금지

## 자동 검증 게이트 (CI)

`.github/workflows/ci.yml`의 **CI** job이 아래를 모두 실행한다. 하나라도 실패하면 merge/배포가 차단된다.

```
npm ci
npm run lint
npx tsc --noEmit
npm test            # 단위
npm run test:rules  # Firestore 보안 규칙 (에뮬레이터)
npm run test:storage# Storage 보안 규칙 (에뮬레이터)
npm run test:api    # API 라우트 (Firestore+Auth 에뮬레이터)
npm run build
```

## 배포 게이트 (rules 배포)

`.github/workflows/firestore-deploy.yml`는 **CI 워크플로가 main에서 성공(`workflow_run.conclusion == success`)**한 경우에만 실행된다.

- Firestore/Storage/API 테스트가 실패하면 rules 배포가 실행되지 않는다.
- 조건: `head_branch == main` 그리고 `head_repository == 현재 저장소`(포크 PR로 배포 트리거 방지).
- 배포 대상: `firestore:rules`, `firestore:indexes`, `storage`(rules). 인덱스 삭제(`--force`)는 수동 실행(workflow_dispatch) 전용.

## Reconciliation 운영 원칙

- reconciliation 스크립트는 **항상 `--dry-run`을 먼저** 실행해 영향 범위를 확인한다.
- `--apply`는 dry-run 보고서 검토 후, 담당자 승인 하에만 실행한다.
- 대상 스크립트:
  - `scripts/reconcile-patient-summaries.ts` (환자 summary 정합성)
  - `scripts/reconcile-reservation-locks.ts` (예약 lock 정합성 — conflict/ownership mismatch는 자동수정 금지, 보고만)

## 구조화된 운영 오류코드

핵심 API는 아래 `code`(또는 로그 action)를 사용한다. 로그에는 **환자 이름·전화·생년월일·사진 URL·메모 본문을 남기지 않는다**(식별자 uid/patientId/reservationDocId + errorCode만).

| 코드 | 의미 |
| --- | --- |
| `DUPLICATE_RESERVATION` | 동일 조합의 활성 예약 중복 |
| `LOCK_OWNERSHIP_MISMATCH` | 예약 lock 소유권 불일치 |
| `STALE_LOCK_REPAIRED` | stale lock 자동 정리·재사용 |
| `PATIENT_ID_MISMATCH` | patient/reservation patientId 불일치 |
| `DISALLOWED_FIELD` | 화이트리스트 밖 필드 주입 |
| `STORAGE_DELETE_FAILED` | 사진 Storage 원본 삭제 실패 |
| `SUMMARY_RECOMPUTE_FAILED` | 환자 summary 재계산 실패(best-effort) |
| `TOKEN_REVOKE_FAILED` | 비활성화 후 refresh token revoke 실패 |
| `KPI_QUERY_LIMIT_EXCEEDED` | KPI 조회 기간 예약 수 하드 상한 초과 |

핵심 감사로그는 서버 API 내부에서 기록한다. 클라이언트가 임의로 `/api/logs`에 핵심 감사로그를 생성하지 않는다.
