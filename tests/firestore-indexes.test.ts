import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 정적 인덱스 계약 테스트.
// Firestore emulator는 복합 인덱스 누락을 강제하지 않아, 필수 인덱스를 실수로 지워도
// 통합 테스트가 통과해버린다(실제로 프로덕션 500 장애가 이렇게 발생). 이 테스트는
// firestore.indexes.json이 프로덕션 쿼리가 요구하는 필수 인덱스 집합을 항상 포함하는지
// emulator/Java 없이 정적으로 검증한다.

type IndexField = { fieldPath: string; order?: string; arrayConfig?: string };
type CompositeIndex = { collectionGroup: string; queryScope?: string; fields: IndexField[] };

const indexPath = fileURLToPath(new URL("../firestore.indexes.json", import.meta.url));
const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as { indexes: CompositeIndex[] };
const indexes = parsed.indexes;

// canonical signature: 필드 순서(Firestore 의미상 중요)는 보존하되 order/arrayConfig를 한 토큰으로
// 정규화한다. 배열 내 인덱스들의 순서는 signature Set 비교로 무시된다.
function signature(index: CompositeIndex): string {
  const scope = index.queryScope ?? "COLLECTION";
  const fields = index.fields.map((f) => `${f.fieldPath}:${f.order ?? f.arrayConfig ?? "?"}`).join(",");
  return `${index.collectionGroup}|${scope}|${fields}`;
}

// 쿼리 감사로 도출한 필수 인덱스(각 줄 옆 주석 = 서빙 쿼리). 파일에서 누락되면 해당 쿼리는
// 런타임에 FAILED_PRECONDITION으로 깨진다.
const REQUIRED: string[] = [
  "reservations|COLLECTION|isDeleted:ASCENDING,reservationDate:DESCENDING", // 관리자 예약 조회(orderBy desc)
  "reservations|COLLECTION|isDeleted:ASCENDING,reservationDate:ASCENDING", // 실시간 범위 구독(range ASC)
  "reservations|COLLECTION|patientId:ASCENDING,isDeleted:ASCENDING,reservationDate:DESCENDING,reservationTime:DESCENDING", // 최신 예약(date,time)
  "reservations|COLLECTION|patientId:ASCENDING,isDeleted:ASCENDING,reservationDate:DESCENDING", // 환자 이력(date만 정렬) — 위 4필드로 대체 불가
  "invoices|COLLECTION|isDeleted:ASCENDING,createdAt:DESCENDING", // 인보이스 list 관리자 no-range
  "invoices|COLLECTION|patientId:ASCENDING,isDeleted:ASCENDING,createdAt:DESCENDING", // get_by_patient 관리자
  "invoices|COLLECTION|patientId:ASCENDING,coordinatorUids:CONTAINS,isDeleted:ASCENDING,createdAt:DESCENDING", // get_by_patient 코디(uid)
  "invoices|COLLECTION|patientId:ASCENDING,coordinators:CONTAINS,isDeleted:ASCENDING,createdAt:DESCENDING", // get_by_patient 코디(이름, 레거시)
  "invoices|COLLECTION|coordinatorUids:CONTAINS,isDeleted:ASCENDING,createdAt:DESCENDING", // list 코디 no-range
  "invoices|COLLECTION|coordinators:CONTAINS,isDeleted:ASCENDING,createdAt:DESCENDING", // list 코디 no-range(레거시)
  "invoices|COLLECTION|isDeleted:ASCENDING,surgeryDate:DESCENDING", // list 관리자 range
  "invoices|COLLECTION|coordinatorUids:CONTAINS,isDeleted:ASCENDING,surgeryDate:DESCENDING", // list 코디 range
  "invoices|COLLECTION|coordinators:CONTAINS,isDeleted:ASCENDING,surgeryDate:DESCENDING", // list 코디 range(레거시)
  "patients|COLLECTION|isDeleted:ASCENDING,lastReservationDate:DESCENDING", // 환자 목록 페이지네이션
  "logs|COLLECTION|reservationId:ASCENDING,createdAt:DESCENDING", // 로그 조회
  "logs|COLLECTION|targetId:ASCENDING,createdAt:DESCENDING", // 로그 조회
  "logs|COLLECTION|patientId:ASCENDING,createdAt:DESCENDING", // 로그 조회
  "reservationNotes|COLLECTION|patientId:ASCENDING,isDeleted:ASCENDING,createdAt:DESCENDING", // 메모 read(patientId)
  "reservationNotes|COLLECTION|reservationDocId:ASCENDING,isDeleted:ASCENDING,createdAt:DESCENDING", // 메모 read(reservationDocId)
  "reservationNotes|COLLECTION|reservationId:ASCENDING,isDeleted:ASCENDING,createdAt:DESCENDING", // 메모 read(reservationId)
  "conferenceMemos|COLLECTION|memoDate:ASCENDING,deleted:ASCENDING,createdAt:DESCENDING", // 컨퍼런스 메모
];

function assertRequiredIndexes(list: CompositeIndex[]) {
  const present = new Set(list.map(signature));
  const missing = REQUIRED.filter((sig) => !present.has(sig));
  assert.deepEqual(missing, [], `firestore.indexes.json에 필수 인덱스가 없습니다:\n${missing.join("\n")}`);
}

test("필수 인덱스 21개가 firestore.indexes.json에 모두 존재한다", () => {
  assert.equal(REQUIRED.length, 21);
  assertRequiredIndexes(indexes);
});

test("인덱스 정의에 중복 시그니처가 없다", () => {
  const counts = new Map<string, number>();
  for (const idx of indexes) {
    const sig = signature(idx);
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  const dups = [...counts.entries()].filter(([, n]) => n > 1).map(([s]) => s);
  assert.deepEqual(dups, [], `중복 인덱스: ${dups.join(", ")}`);
});

test("REQUIRED 목록 자체에 중복이 없다", () => {
  assert.equal(new Set(REQUIRED).size, REQUIRED.length);
});

test("reservations 3필드/4필드 인덱스는 서로 다른 계약이며 둘 다 필수다", () => {
  // 4필드(…,reservationTime DESC)는 3필드(date만 정렬) 쿼리를 서빙하지 못한다 — 프로덕션 장애의 교훈.
  const threeField = "reservations|COLLECTION|patientId:ASCENDING,isDeleted:ASCENDING,reservationDate:DESCENDING";
  const fourField = "reservations|COLLECTION|patientId:ASCENDING,isDeleted:ASCENDING,reservationDate:DESCENDING,reservationTime:DESCENDING";
  assert.notEqual(threeField, fourField);
  const present = new Set(indexes.map(signature));
  assert.ok(present.has(threeField), "3필드 reservations 인덱스가 누락됨");
  assert.ok(present.has(fourField), "4필드 reservations 인덱스가 누락됨");
});

test("필수 인덱스의 queryScope가 바뀌면 계약 검증이 실패한다", () => {
  const target = "reservations|COLLECTION|patientId:ASCENDING,isDeleted:ASCENDING,reservationDate:DESCENDING";
  const wrongScope = indexes.map((index) =>
    signature(index) === target ? { ...index, queryScope: "COLLECTION_GROUP" } : index
  );
  assert.throws(() => assertRequiredIndexes(wrongScope));
});

test("필수 인덱스가 하나라도 빠지면 계약 검증이 실패한다 (파일 미수정, 인메모리 fixture)", () => {
  // 추적 파일을 실제로 수정했다 복구하는 방식은 복구 누락 위험이 있어, 메모리에서만 하나를 제거한다.
  const target = "reservations|COLLECTION|patientId:ASCENDING,isDeleted:ASCENDING,reservationDate:DESCENDING";
  const missingOne = indexes.filter((i) => signature(i) !== target);
  assert.throws(() => assertRequiredIndexes(missingOne));
  // 원본은 그대로 통과 — 파일을 건드리지 않았음을 확인.
  assert.doesNotThrow(() => assertRequiredIndexes(indexes));
});
