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
