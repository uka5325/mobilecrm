import { test } from "node:test";
import assert from "node:assert/strict";

import { parseBirthInfo } from "../lib/invoiceUtils";
import { calcCommissionBase, calcCommission, paymentMethodLabel } from "../lib/commissionUtils";
import { cleanText, toSerializable } from "../lib/adminUtils";
import {
  computePatientIdentityKey,
  identityKeyForPatient,
  normalizeBirth,
} from "../lib/patientIdentity";

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

test("computePatientIdentityKey: 대소문자/공백 정규화 후 동일 키", () => {
  const a = computePatientIdentityKey({ name: "우르체흐(BAYARSAIKHAN)", birth: "19910531", nationality: "몽골", gender: "여" });
  const b = computePatientIdentityKey({ name: "  우르체흐(bayarsaikhan)  ", birth: "19910531", nationality: " 몽골 ", gender: "여" });
  assert.notEqual(a, "");
  assert.equal(a, b);
});

test("computePatientIdentityKey: 이름/생년월일 없으면 빈 문자열(식별 불가)", () => {
  assert.equal(computePatientIdentityKey({ name: "", birth: "19910531" }), "");
  assert.equal(computePatientIdentityKey({ name: "홍길동", birth: "" }), "");
});

test("computePatientIdentityKey: 성별이 다르면 다른 키", () => {
  const f = computePatientIdentityKey({ name: "홍길동", birth: "19910531", nationality: "몽골", gender: "여" });
  const m = computePatientIdentityKey({ name: "홍길동", birth: "19910531", nationality: "몽골", gender: "남" });
  assert.notEqual(f, m);
});

test("normalizeBirth: birth 우선, 없으면 birthInput 숫자 앞 8자리", () => {
  assert.equal(normalizeBirth({ birth: "19910531", birthInput: "무시됨" }), "19910531");
  assert.equal(normalizeBirth({ birthInput: "1991-05-31-1" }), "19910531");
  assert.equal(normalizeBirth({}), "");
});

test("identityKeyForPatient: 해시(sha256 64hex), 구성요소 없으면 빈 문자열", () => {
  const h = identityKeyForPatient({ name: "홍길동", birth: "19910531", nationality: "몽골", gender: "여" });
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(identityKeyForPatient({ name: "", birth: "" }), "");
});
