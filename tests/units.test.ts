import { test } from "node:test";
import assert from "node:assert/strict";

import { parseBirthInfo } from "../lib/invoiceUtils";
import { calcCommissionBase, calcCommission, paymentMethodLabel } from "../lib/commissionUtils";
import { cleanText, toSerializable } from "../lib/adminUtils";

test("parseBirthInfo: 주민번호 앞자리+성별코드 (남)", () => {
  const r = parseBirthInfo("900101-1");
  assert.equal(r.birth, "1990-01-01");
  assert.equal(r.birthDisplay, "900101");
  assert.equal(r.gender, "남");
});

test("parseBirthInfo: 2000년대 출생 (성별코드 3 → 남)", () => {
  const r = parseBirthInfo("050203-3");
  assert.equal(r.birth, "2005-02-03");
  assert.equal(r.gender, "남");
});

test("parseBirthInfo: 7자리 (여, 코드 4)", () => {
  const r = parseBirthInfo("0502034");
  assert.equal(r.birth, "2005-02-03");
  assert.equal(r.gender, "여");
});

test("parseBirthInfo: 8자리 YYYYMMDD, 성별 폴백", () => {
  const r = parseBirthInfo("19900101", "여");
  assert.equal(r.birth, "1990-01-01");
  assert.equal(r.gender, "여");
});

test("parseBirthInfo: 빈 입력", () => {
  const r = parseBirthInfo("");
  assert.equal(r.birth, "");
  assert.equal(r.birthDisplay, "");
});

test("calcCommissionBase: 현금은 전액", () => {
  assert.equal(calcCommissionBase(1100000, "cash"), 1100000);
});

test("calcCommissionBase: 카드는 VAT 제거", () => {
  assert.equal(calcCommissionBase(1100000, "card"), 1000000);
});

test("calcCommissionBase: 혼합은 카드분만 VAT 제거", () => {
  // 카드 550000 → 500000, 현금 500000 → 합 1000000
  assert.equal(calcCommissionBase(0, "mixed", 550000, 500000), 1000000);
});

test("calcCommission: 비율 계산 반올림", () => {
  assert.equal(calcCommission(1000000, 7.5), 75000);
});

test("paymentMethodLabel", () => {
  assert.equal(paymentMethodLabel("card"), "카드");
  assert.equal(paymentMethodLabel(undefined), "-");
});

test("cleanText: null/undefined 안전", () => {
  assert.equal(cleanText(null), "");
  assert.equal(cleanText("  hi "), "hi");
});

test("toSerializable: Timestamp형(toMillis) 변환", () => {
  const ts = { toMillis: () => 1234 };
  assert.equal(toSerializable(ts), 1234);
  assert.deepEqual(toSerializable({ a: ts, b: [ts] }), { a: 1234, b: [1234] });
});

// ── buildReservationUpdatePayload: 부분 patch(생략 필드 보존) ──────────────
import { buildReservationUpdatePayload } from "../lib/reservations";

const _staff = { uid: "u1", displayName: "Tester" } as unknown as Parameters<typeof buildReservationUpdatePayload>[1];
const _base = { name: "홍길동", reservationDate: "2026-07-06" };

test("payload: hospital만 전달 → 상태/금액/담당자 키 없음", () => {
  const { reservationPatch: p } = buildReservationUpdatePayload({ ..._base, hospital: "ARC" }, _staff);
  assert.equal(p.hospital, "ARC");
  assert.ok(!("completed" in p));
  assert.ok(!("cancelled" in p));
  assert.ok(!("coordinators" in p));
  assert.ok(!("depositAmount" in p));
  assert.ok(!("surgeryCost" in p));
});

test("payload: completed만 전달 → completed 포함, cancelled 없음", () => {
  const { reservationPatch: p } = buildReservationUpdatePayload({ ..._base, completed: true }, _staff);
  assert.equal(p.completed, true);
  assert.ok(!("cancelled" in p));
});

test("payload: coordinators:[] → 빈 배열 포함", () => {
  const { reservationPatch: p } = buildReservationUpdatePayload({ ..._base, coordinators: [] }, _staff);
  assert.ok("coordinators" in p);
  assert.deepEqual(p.coordinators, []);
});

test("payload: coordinators:undefined → 키 자체가 없음", () => {
  const { reservationPatch: p } = buildReservationUpdatePayload({ ..._base, coordinators: undefined }, _staff);
  assert.ok(!("coordinators" in p));
});

test("payload: depositAmount:'0' → 포함", () => {
  const { reservationPatch: p } = buildReservationUpdatePayload({ ..._base, depositAmount: "0" }, _staff);
  assert.ok("depositAmount" in p);
  assert.equal(p.depositAmount, "0");
});

test("payload: depositAmount:undefined → 키 자체가 없음", () => {
  const { reservationPatch: p } = buildReservationUpdatePayload({ ..._base, depositAmount: undefined }, _staff);
  assert.ok(!("depositAmount" in p));
});

test("payload: cancelled:false → false 포함", () => {
  const { reservationPatch: p } = buildReservationUpdatePayload({ ..._base, cancelled: false }, _staff);
  assert.ok("cancelled" in p);
  assert.equal(p.cancelled, false);
});

test("payload: name/reservationDate는 항상 포함, updatedBy 강제", () => {
  const { reservationPatch: p } = buildReservationUpdatePayload(_base, _staff);
  assert.equal(p.name, "홍길동");
  assert.equal(p.patientName, "홍길동");
  assert.equal(p.reservationDate, "2026-07-06");
  assert.equal(p.updatedBy, "Tester");
  assert.equal(p.updatedByUid, "u1");
  // 생년/성별 입력 없으면 파생 필드 미포함(기존값 보존)
  assert.ok(!("birth" in p));
  assert.ok(!("gender" in p));
});

// ── sanitizeCsvCell: formula injection 방어 (3단계) ────────────────────────
import { sanitizeCsvCell, buildCsvContent, CSV_BOM } from "../lib/csv";

test("sanitizeCsvCell: 위험 접두(=,+,-,@,tab,CR)는 ' 프리픽스 후 quoting", () => {
  assert.equal(sanitizeCsvCell("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
  assert.equal(sanitizeCsvCell("+SUM(1,2)"), `"'+SUM(1,2)"`);
  assert.equal(sanitizeCsvCell("-10+20"), `"'-10+20"`);
  assert.equal(sanitizeCsvCell("@SUM(A1)"), `"'@SUM(A1)"`);
  assert.equal(sanitizeCsvCell("\tCMD"), `"'\tCMD"`);
  assert.equal(sanitizeCsvCell("\rFORMULA"), `"'\rFORMULA"`);
});

test("sanitizeCsvCell: 일반 텍스트/따옴표/줄바꿈/쉼표 처리", () => {
  assert.equal(sanitizeCsvCell("홍길동"), `"홍길동"`);
  assert.equal(sanitizeCsvCell('a"b'), `"a""b"`);
  assert.equal(sanitizeCsvCell("a\nb"), `"a\nb"`);
  assert.equal(sanitizeCsvCell("a,b"), `"a,b"`);
  assert.equal(sanitizeCsvCell(null), `""`);
  assert.equal(sanitizeCsvCell(0), `"0"`);
});

test("buildCsvContent: BOM 포함 + 행/열 조립", () => {
  const csv = buildCsvContent([["a", "b"], ["=1", "c,d"]]);
  assert.ok(csv.startsWith(CSV_BOM));
  assert.equal(csv, `${CSV_BOM}"a","b"\n"'=1","c,d"`);
  // BOM 비활성 옵션
  assert.ok(!buildCsvContent([["x"]], { bom: false }).startsWith(CSV_BOM));
});

// ── reservationLocks: patientId 기반 identity (P0 수정) ────────────────────
import { computeDupKey, lockIdForReservation } from "../lib/reservationLocks";

const _lockBase = {
  patientId: "P-1",
  reservationDate: "2027-01-01",
  reservationTime: "10:00",
  hospital: "H1",
  appointmentType: "상담",
  doctors: ["김원장", "이원장"],
};

test("lock identity: patientId 동일 + name만 다름 → 동일 lockId", () => {
  const a = lockIdForReservation({ ..._lockBase, name: "홍길동" });
  const b = lockIdForReservation({ ..._lockBase, name: "김철수" });
  assert.equal(a, b);
});

test("lock identity: patientId 동일 + phone만 다름 → 동일 lockId", () => {
  const a = lockIdForReservation({ ..._lockBase, name: "홍길동", phone: "010-1111-2222" });
  const b = lockIdForReservation({ ..._lockBase, name: "홍길동", phone: "010-9999-8888" });
  assert.equal(a, b);
});

test("lock identity: doctors 순서만 달라도 같은 lockId", () => {
  const a = lockIdForReservation({ ..._lockBase, name: "홍길동", doctors: ["김원장", "이원장"] });
  const b = lockIdForReservation({ ..._lockBase, name: "홍길동", doctors: ["이원장", "김원장"] });
  assert.equal(a, b);
});

test("lock identity: patientId 없는 레거시는 name+phone fallback으로 lockId 산출", () => {
  const legacy = lockIdForReservation({
    reservationDate: "2027-01-01", reservationTime: "10:00", hospital: "H1",
    appointmentType: "상담", doctors: [], name: "홍길동", phone: "010-1111-2222",
  });
  assert.ok(legacy);
  // patientId 있는 케이스와는 다른 lockId(신원 소스가 다름)
  const withPid = lockIdForReservation({ ..._lockBase, name: "홍길동", phone: "010-1111-2222" });
  assert.notEqual(legacy, withPid);
});

test("lock identity: patientId 있으면 dupKey에 phone이 별도로 들어가지 않는다", () => {
  const k1 = computeDupKey({ ..._lockBase, name: "홍길동", phone: "010-1111-2222" });
  const k2 = computeDupKey({ ..._lockBase, name: "홍길동", phone: "010-9999-8888" });
  assert.equal(k1, k2);
});

// ── reconcile-patient-summaries: pagination 집계 (300건 상한 없음, P0 후속) ──────
import { aggregateReservationPages } from "../scripts/reconcile-patient-summaries";

function makeReservations(n: number, offset = 0): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => {
    const idx = offset + i;
    return {
      reservationDate: `2027-01-${String((idx % 28) + 1).padStart(2, "0")}`,
      reservationTime: "10:00",
      depositAmount: "10000",
      hospital: "H1",
      consultArea: "코",
      doctors: ["김원장"],
    };
  });
}

test("aggregateReservationPages: 301건이 여러 페이지로 나뉘어도 reservationCount=301", () => {
  const pages = [makeReservations(250, 0), makeReservations(51, 250)];
  const agg = aggregateReservationPages(pages);
  assert.equal(agg.reservationCount, 301);
});

test("aggregateReservationPages: 650건 전체 페이지 합계가 정확하다(300건 cap 없음)", () => {
  const pages = [makeReservations(500, 0), makeReservations(150, 500)];
  const agg = aggregateReservationPages(pages);
  assert.equal(agg.reservationCount, 650);
  // 모두 같은 그룹(H1+코+김원장)의 예약금이므로 depositCount는 그룹 수(1)로 묶인다.
  assert.equal(agg.depositCount, 1);
  assert.equal(agg.totalDepositAmount, 650 * 10000);
});

test("aggregateReservationPages: 빈 페이지 배열은 0건으로 집계된다", () => {
  const agg = aggregateReservationPages([]);
  assert.equal(agg.reservationCount, 0);
  assert.equal(agg.totalDepositAmount, 0);
});

// ── clientCache: mcrm_ 레거시 prefix도 purge 대상에 포함 (P0 후속) ────────────────
import { clearAllClientCaches, APP_CACHE_PREFIXES } from "../lib/clientCache";

test("APP_CACHE_PREFIXES: mcrm_ 레거시 prefix가 포함되어 있다", () => {
  assert.ok(APP_CACHE_PREFIXES.includes("mcrm_"));
  assert.ok(APP_CACHE_PREFIXES.includes("arc_crm_"));
});

test("clearAllClientCaches: mcrm_/arc_crm_ 키는 삭제하고 무관한 키는 유지한다", () => {
  const store: Record<string, string> = {
    mcrm_staff_list: "x",
    arc_crm_staff_user: "y",
    unrelated_app_key: "z",
    other_vendor_token: "w",
  };
  const fakeStorage = {
    get length() { return Object.keys(store).length; },
    key(i: number) { return Object.keys(store)[i] ?? null; },
    removeItem(k: string) { delete store[k]; },
  } as unknown as Storage;

  (globalThis as unknown as { window?: unknown }).window = {};
  (globalThis as unknown as { localStorage: Storage }).localStorage = fakeStorage;
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
    length: 0, key: () => null, removeItem: () => {},
  } as unknown as Storage;

  try {
    clearAllClientCaches();

    assert.ok(!("mcrm_staff_list" in store));
    assert.ok(!("arc_crm_staff_user" in store));
    assert.ok("unrelated_app_key" in store);
    assert.ok("other_vendor_token" in store);
  } finally {
    // 다른 테스트에 전역 window/localStorage/sessionStorage 목이 새지 않게 정리한다.
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    delete (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage;
  }
});

// ── reservationFiles: Storage 삭제 실패 분류 (재시도 가능 로직, P0 후속) ────────────
import { classifyStorageDeleteError } from "../lib/reservationFiles";

test("classifyStorageDeleteError: object-not-found는 성공(deleted)으로 분류한다", () => {
  const result = classifyStorageDeleteError({ code: "storage/object-not-found" });
  assert.deepEqual(result, { status: "deleted" });
});

test("classifyStorageDeleteError: 그 외 에러는 failed + errorCode로 분류한다", () => {
  const result = classifyStorageDeleteError({ code: "storage/unauthorized" });
  assert.deepEqual(result, { status: "failed", errorCode: "storage/unauthorized" });
});

test("classifyStorageDeleteError: code가 없는 에러는 unknown으로 분류한다", () => {
  const result = classifyStorageDeleteError(new Error("boom"));
  assert.deepEqual(result, { status: "failed", errorCode: "unknown" });
});
