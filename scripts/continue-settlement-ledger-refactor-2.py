from pathlib import Path
import re


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    actual = text.count(old)
    if actual != expected:
        raise RuntimeError(f"{path}: expected {expected} matches, found {actual}: {old[:100]!r}")
    p.write_text(text.replace(old, new), encoding="utf-8")


def replace_first(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"{path}: first-match pattern missing: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def regex_replace(path: str, pattern: str, repl: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    updated, actual = re.subn(pattern, repl, text, count=expected, flags=re.S)
    if actual != expected:
        raise RuntimeError(f"{path}: expected {expected} regex matches, found {actual}: {pattern[:100]!r}")
    p.write_text(updated, encoding="utf-8")


replace_first(
    "lib/invoices.ts",
    '''  paymentMethod?: "card" | "cash" | "mixed";\n  cardAmount?: number;\n  cashAmount?: number;\n  commissionRate?: number;\n''',
    '''  paymentMethod?: "card" | "cash" | "mixed";\n  cardAmount?: number;\n  cashAmount?: number;\n  bankTransferAmount?: number;\n  foreignCardAmount?: number;\n  otherAmount?: number;\n  settlementPaidAmount?: number;\n  settlementRefundAmount?: number;\n  settlementCount?: number;\n  invoiceRevision?: number;\n  updatedAfterConfirmation?: boolean;\n  lastSettlementSyncedAt?: unknown;\n  commissionRate?: number;\n''',
)
replace_exact(
    "lib/invoices.ts",
    '''    cardAmount: data.cardAmount != null ? toNumber(data.cardAmount) : undefined,\n    cashAmount: data.cashAmount != null ? toNumber(data.cashAmount) : undefined,\n    commissionRate: data.commissionRate != null ? toNumber(data.commissionRate) : undefined,\n''',
    '''    cardAmount: data.cardAmount != null ? toNumber(data.cardAmount) : undefined,\n    cashAmount: data.cashAmount != null ? toNumber(data.cashAmount) : undefined,\n    bankTransferAmount: data.bankTransferAmount != null ? toNumber(data.bankTransferAmount) : undefined,\n    foreignCardAmount: data.foreignCardAmount != null ? toNumber(data.foreignCardAmount) : undefined,\n    otherAmount: data.otherAmount != null ? toNumber(data.otherAmount) : undefined,\n    settlementPaidAmount: data.settlementPaidAmount != null ? toNumber(data.settlementPaidAmount) : undefined,\n    settlementRefundAmount: data.settlementRefundAmount != null ? toNumber(data.settlementRefundAmount) : undefined,\n    settlementCount: data.settlementCount != null ? toNumber(data.settlementCount) : undefined,\n    invoiceRevision: data.invoiceRevision != null ? toNumber(data.invoiceRevision) : undefined,\n    updatedAfterConfirmation: data.updatedAfterConfirmation === true,\n    lastSettlementSyncedAt: data.lastSettlementSyncedAt,\n    commissionRate: data.commissionRate != null ? toNumber(data.commissionRate) : undefined,\n''',
)

replace_exact(
    "lib/invoiceConsistencyServer.ts",
    'import type { requireActiveStaff } from "@/lib/apiAuth";\n',
    'import type { requireActiveStaff } from "@/lib/apiAuth";\nimport { aggregateSettlementRows } from "@/lib/settlementMath";\nimport { calcCommission } from "@/lib/commissionUtils";\n',
)
replace_exact(
    "lib/invoiceConsistencyServer.ts",
    '''    const existing = existingSnap.docs.find((doc) => doc.data().isDeleted !== true);\n''',
    '''    const existing = existingSnap.docs.find((doc) => doc.data().isDeleted !== true);\n    const settlementSnap = await tx.get(\n      adminDb.collection("settlements").where("reservationDocId", "==", reservationDocId).limit(501)\n    );\n    const settlementAggregate = aggregateSettlementRows(\n      settlementSnap.docs.map((doc) => doc.data() as Record<string, unknown>)\n    );\n''',
)
regex_replace(
    "lib/invoiceConsistencyServer.ts",
    r'''      totalAmount: \(\(\) => \{.*?\}\)\(\),\n      memo: "",''',
    '''      totalAmount: settlementAggregate.netAmount,\n      paymentMethod: settlementAggregate.paymentMethod ?? null,\n      cardAmount: settlementAggregate.cardAmount,\n      cashAmount: settlementAggregate.cashAmount,\n      bankTransferAmount: settlementAggregate.methodTotals.bank_transfer,\n      foreignCardAmount: settlementAggregate.methodTotals.foreign_card,\n      otherAmount: settlementAggregate.methodTotals.other,\n      settlementPaidAmount: settlementAggregate.totalPaid,\n      settlementRefundAmount: settlementAggregate.totalRefunded,\n      settlementCount: settlementAggregate.count,\n      commissionBase: settlementAggregate.commissionBase,\n      commissionAmount: null,\n      invoiceRevision: 0,\n      updatedAfterConfirmation: false,\n      memo: "",''',
)
replace_exact(
    "lib/invoiceConsistencyServer.ts",
    '''    const reservation = reservationSnap.data() as Record<string, unknown>;\n    if (!invoiceReservationMatches(current, reservation)) return { kind: "linkMismatch" as const };\n\n    const now = FieldValue.serverTimestamp();\n    const patch: Record<string, unknown> = {\n''',
    '''    const reservation = reservationSnap.data() as Record<string, unknown>;\n    if (!invoiceReservationMatches(current, reservation)) return { kind: "linkMismatch" as const };\n    const settlementSnap = await tx.get(\n      adminDb.collection("settlements").where("reservationDocId", "==", reservationDocId).limit(501)\n    );\n    const settlementAggregate = aggregateSettlementRows(\n      settlementSnap.docs.map((doc) => doc.data() as Record<string, unknown>)\n    );\n    const hasSettlements = settlementAggregate.count > 0;\n    const commissionRate = payload.commissionRate !== undefined\n      ? toNumber(payload.commissionRate)\n      : current.commissionRate !== undefined && current.commissionRate !== null\n        ? toNumber(current.commissionRate)\n        : null;\n\n    const now = FieldValue.serverTimestamp();\n    const patch: Record<string, unknown> = {\n''',
)
replace_exact(
    "lib/invoiceConsistencyServer.ts",
    '''      totalAmount: toNumber(payload.totalAmount),\n      paymentMethod: payload.paymentMethod ?? null,\n      cardAmount: payload.cardAmount !== undefined ? toNumber(payload.cardAmount) : null,\n      cashAmount: payload.cashAmount !== undefined ? toNumber(payload.cashAmount) : null,\n      commissionRate: payload.commissionRate !== undefined ? toNumber(payload.commissionRate) : null,\n''',
    '''      totalAmount: hasSettlements ? settlementAggregate.netAmount : toNumber(payload.totalAmount),\n      paymentMethod: hasSettlements ? (settlementAggregate.paymentMethod ?? null) : (payload.paymentMethod ?? null),\n      cardAmount: hasSettlements ? settlementAggregate.cardAmount : (payload.cardAmount !== undefined ? toNumber(payload.cardAmount) : null),\n      cashAmount: hasSettlements ? settlementAggregate.cashAmount : (payload.cashAmount !== undefined ? toNumber(payload.cashAmount) : null),\n      bankTransferAmount: hasSettlements ? settlementAggregate.methodTotals.bank_transfer : (current.bankTransferAmount ?? null),\n      foreignCardAmount: hasSettlements ? settlementAggregate.methodTotals.foreign_card : (current.foreignCardAmount ?? null),\n      otherAmount: hasSettlements ? settlementAggregate.methodTotals.other : (current.otherAmount ?? null),\n      settlementPaidAmount: hasSettlements ? settlementAggregate.totalPaid : (current.settlementPaidAmount ?? null),\n      settlementRefundAmount: hasSettlements ? settlementAggregate.totalRefunded : (current.settlementRefundAmount ?? null),\n      settlementCount: hasSettlements ? settlementAggregate.count : (current.settlementCount ?? 0),\n      commissionRate,\n''',
)
replace_exact(
    "lib/invoiceConsistencyServer.ts",
    '''      commissionBase: payload.commissionBase !== undefined ? toNumber(payload.commissionBase) : null,\n      commissionAmount: payload.commissionAmount !== undefined ? toNumber(payload.commissionAmount) : null,\n''',
    '''      commissionBase: hasSettlements ? settlementAggregate.commissionBase : (payload.commissionBase !== undefined ? toNumber(payload.commissionBase) : null),\n      commissionAmount: hasSettlements\n        ? (commissionRate === null ? null : calcCommission(settlementAggregate.commissionBase, commissionRate))\n        : (payload.commissionAmount !== undefined ? toNumber(payload.commissionAmount) : null),\n''',
)

replace_exact(
    "tests/units.test.ts",
    'import { cleanText, toSerializable } from "../lib/adminUtils";\n',
    'import { cleanText, toSerializable } from "../lib/adminUtils";\nimport { aggregateSettlementRows } from "../lib/settlementMath";\n',
)
replace_exact(
    "tests/units.test.ts",
    'test("cleanText: null/undefined 안전", () => {\n',
    '''test("settlement aggregate: 실제 결제-환불 및 결제수단별 합계", () => {\n  const result = aggregateSettlementRows([\n    { direction: "payment", amount: 550000, paymentMethod: "card", status: "active", paidAt: "2026-07-01" },\n    { direction: "payment", amount: 500000, paymentMethod: "cash", status: "active", paidAt: "2026-07-02" },\n    { direction: "refund", amount: 50000, paymentMethod: "cash", status: "active", paidAt: "2026-07-03" },\n  ]);\n  assert.equal(result.totalPaid, 1050000);\n  assert.equal(result.totalRefunded, 50000);\n  assert.equal(result.netAmount, 1000000);\n  assert.equal(result.cardAmount, 550000);\n  assert.equal(result.cashAmount, 450000);\n  assert.equal(result.paymentMethod, "mixed");\n  assert.equal(result.commissionBase, 950000);\n});\n\ntest("settlement aggregate: void 기록 제외", () => {\n  const result = aggregateSettlementRows([\n    { direction: "payment", amount: 100000, paymentMethod: "cash", status: "void" },\n    { direction: "payment", amount: 200000, paymentMethod: "bank_transfer", status: "active" },\n  ]);\n  assert.equal(result.count, 1);\n  assert.equal(result.netAmount, 200000);\n  assert.equal(result.methodTotals.bank_transfer, 200000);\n});\n\ntest("cleanText: null/undefined 안전", () => {\n''',
)

print("Settlement ledger continuation 2 applied")
