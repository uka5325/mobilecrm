# 배포 · Rollback · Smoke Test 절차

MobileCRM 데이터 무결성 변경(예약 partial patch, lock lifecycle, summary, storage) 배포용 운영 런북.

## 배포 순서

1. 최신 production backup 또는 Firestore export 확인(복구 지점 확보).
2. 환자 summary reconciliation **dry-run** — `npx tsx scripts/reconcile-patient-summaries.ts --project <PROJECT_ID> --dry-run`
3. 예약 lock reconciliation **dry-run** — `npx tsx scripts/reconcile-reservation-locks.ts --project <PROJECT_ID> --dry-run`
4. CI 전체 통과 확인(lint/tsc/unit/rules/storage/api/build).
5. 코드 배포(앱) + rules 배포(CI 게이트 통과 후 firestore-deploy).
6. production **smoke test**(아래 목록) 수행.
7. summary reconciliation **apply**(dry-run 결과 검토 후) — `--apply`
8. lock reconciliation **apply**(dry-run 결과 검토 후, conflict/ownership mismatch는 수동 확인) — `--apply`
9. 결과 재검증(다시 dry-run으로 잔여 드리프트 0 확인).
10. 실행/결과 보고서 보관.

## Smoke test 체크리스트

- [ ] 환자만 신규 등록 → 고객 목록에 노출(reservationCount=0, lastReservationDate 존재)
- [ ] 예약 신규 생성 성공
- [ ] 동일 예약 동시 생성 → 하나만 성공, 하나 duplicate
- [ ] 예약 시간 수정(10:00→11:00) 성공, old lock 해제
- [ ] 예약 일부 필드만 수정 후 cancelled/completed/금액/담당자 유지
- [ ] 예약 취소 후 같은 조합 재등록 가능
- [ ] 취소 복구(다른 활성 예약 없을 때) 성공 / 있으면 실패(409)
- [ ] 고객 목록에서 삭제 → 목록에서 숨김(soft delete), 인보이스/사진/메모 보존
- [ ] 사진 업로드(이미지, 10MB 이하)
- [ ] 사진 인증 proxy 조회(private, no-store)
- [ ] 사진 삭제 → 원본 삭제 실패 시 오류 표시(숨기지 않음)
- [ ] 인보이스 생성 / 삭제(트랜잭션, 예약 연결 해제)
- [ ] 대시보드 KPI(기간 전체 정확 집계, 상한 초과 시 명시적 오류)
- [ ] CSV 다운로드(=,+,-,@ 값이 수식으로 실행되지 않음)
- [ ] 직원 비활성화 후 해당 계정 접근 차단(세션 즉시 로그아웃)

## Rollback 조건 (아래 중 하나라도 관측되면 롤백 검토)

- 예약 저장 실패율 증가
- 예약 수정 후 상태값(취소/완료/금액) 불일치
- 중복 예약 차단 오류(정상 예약이 duplicate로 거부)
- 환자 목록 누락(신규/기존 환자 미노출)
- 사진 로딩 실패 / Storage 삭제 실패 증가
- 인보이스-예약 연결 불일치
- KPI 수치 불일치
- 비활성 직원이 여전히 접근 가능

## Rollback 절차

1. 이전 배포(앱/rules)로 복구.
2. 진행 중인 reconciliation `--apply` **즉시 중단**.
3. dry-run 보고서 보관(무엇을 바꾸려 했는지 기록).
4. 이미 적용된 데이터 변경 목록 확인(apply 로그/summaryUpdatedAt·lock 변경).
5. 복구 스크립트(backup restore) 실행 여부 판단 — 데이터 변경이 광범위하면 백업 지점으로 복원.

## 데이터 삭제 정책 (배포 시 유지)

- 환자(patients): **soft delete** (목록에서 숨김)
- 예약(reservations): **soft delete**
- 예약 lock(reservationLocks): **hard delete**
- 인보이스 / 메모 / 사진 / Storage 원본: **보존**

UI는 "영구/전체 삭제"가 아니라 "고객 삭제(목록에서 숨김)"로 표현한다. 관리자 영구 삭제 기능은 이번 범위에 포함하지 않는다.
