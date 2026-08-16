import {
  aggregateSettlementRows,
  type SettlementAggregate,
  type SettlementMathRow,
  type SettlementPaymentMethod,
} from "./settlementMath";

export const SURGERY_CASE_AGGREGATE_VERSION = 1;

const METHOD_FIELDS: Record<SettlementPaymentMethod, string> = {
  card: "methodCardAmount",
  cash: "methodCashAmount",
  bank_transfer: "bankTransferAmount",
  foreign_card: "foreignCardAmount",
  other: "otherAmount",
};

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export function emptySettlementAggregate(): SettlementAggregate {
  return aggregateSettlementRows([]);
}

export function aggregateFromSurgeryCase(
  data: Record<string, unknown> | undefined
): SettlementAggregate | null {
  if (!data || finiteNumber(data.aggregateVersion) !== SURGERY_CASE_AGGREGATE_VERSION) {
    return null;
  }

  const rows: SettlementMathRow[] = [];
  const methodTotals = {
    card: finiteNumber(data.methodCardAmount),
    cash: finiteNumber(data.methodCashAmount),
    bank_transfer: finiteNumber(data.bankTransferAmount),
    foreign_card: finiteNumber(data.foreignCardAmount),
    other: finiteNumber(data.otherAmount),
  } satisfies Record<SettlementPaymentMethod, number>;

  for (const [paymentMethod, total] of Object.entries(methodTotals) as Array<[
    SettlementPaymentMethod,
    number,
  ]>) {
    if (total === 0) continue;
    rows.push({
      direction: total < 0 ? "refund" : "payment",
      amount: Math.abs(total),
      paymentMethod,
      paidAt: String(data.lastPaidAt || ""),
    });
  }

  const derived = aggregateSettlementRows(rows);
  return {
    ...derived,
    count: Math.max(0, finiteNumber(data.settlementCount)),
    paymentCount: Math.max(0, finiteNumber(data.settlementPaymentCount)),
    refundCount: Math.max(0, finiteNumber(data.settlementRefundCount)),
    totalPaid: Math.max(0, finiteNumber(data.totalPaid)),
    totalRefunded: Math.max(0, finiteNumber(data.totalRefunded)),
    netAmount: finiteNumber(data.netAmount),
    commissionBase: Math.max(0, finiteNumber(data.commissionBase)),
    lastPaidAt: String(data.lastPaidAt || ""),
  };
}

export function surgeryCaseAggregatePatch(aggregate: SettlementAggregate) {
  return {
    aggregateVersion: SURGERY_CASE_AGGREGATE_VERSION,
    settlementCount: aggregate.count,
    settlementPaymentCount: aggregate.paymentCount,
    settlementRefundCount: aggregate.refundCount,
    totalPaid: aggregate.totalPaid,
    totalRefunded: aggregate.totalRefunded,
    netAmount: aggregate.netAmount,
    methodCardAmount: aggregate.methodTotals.card,
    methodCashAmount: aggregate.methodTotals.cash,
    bankTransferAmount: aggregate.methodTotals.bank_transfer,
    foreignCardAmount: aggregate.methodTotals.foreign_card,
    otherAmount: aggregate.methodTotals.other,
    paymentMethod: aggregate.paymentMethod ?? null,
    cardAmount: aggregate.cardAmount,
    cashAmount: aggregate.cashAmount,
    commissionBase: aggregate.commissionBase,
    lastPaidAt: aggregate.lastPaidAt,
  };
}

type Contribution = {
  active: boolean;
  direction: "payment" | "refund";
  amount: number;
  paymentMethod: SettlementPaymentMethod;
  paidAt: string;
};

function contribution(row: SettlementMathRow | null | undefined): Contribution {
  const aggregate = aggregateSettlementRows(row ? [row] : []);
  const paymentMethod = row && typeof row.paymentMethod === "string"
    ? row.paymentMethod as SettlementPaymentMethod
    : "other";
  return {
    active: aggregate.count === 1,
    direction: row?.direction === "refund" ? "refund" : "payment",
    amount: aggregate.count === 1
      ? (row?.direction === "refund" ? aggregate.totalRefunded : aggregate.totalPaid)
      : 0,
    paymentMethod: Object.prototype.hasOwnProperty.call(METHOD_FIELDS, paymentMethod)
      ? paymentMethod
      : "other",
    paidAt: aggregate.count === 1 ? String(row?.paidAt || "") : "",
  };
}

export function applySettlementDelta(
  base: SettlementAggregate,
  before: SettlementMathRow | null | undefined,
  after: SettlementMathRow | null | undefined
): { aggregate: SettlementAggregate; lastPaidAtMayBeStale: boolean } {
  const previous = contribution(before);
  const next = contribution(after);
  const state = {
    count: base.count,
    paymentCount: base.paymentCount,
    refundCount: base.refundCount,
    totalPaid: base.totalPaid,
    totalRefunded: base.totalRefunded,
    methodTotals: { ...base.methodTotals },
  };

  const apply = (item: Contribution, sign: 1 | -1) => {
    if (!item.active) return;
    state.count += sign;
    if (item.direction === "refund") {
      state.refundCount += sign;
      state.totalRefunded += sign * item.amount;
      state.methodTotals[item.paymentMethod] -= sign * item.amount;
    } else {
      state.paymentCount += sign;
      state.totalPaid += sign * item.amount;
      state.methodTotals[item.paymentMethod] += sign * item.amount;
    }
  };

  apply(previous, -1);
  apply(next, 1);

  const syntheticRows: SettlementMathRow[] = [];
  for (const [paymentMethod, total] of Object.entries(state.methodTotals) as Array<[
    SettlementPaymentMethod,
    number,
  ]>) {
    if (!total) continue;
    syntheticRows.push({
      direction: total < 0 ? "refund" : "payment",
      amount: Math.abs(total),
      paymentMethod,
    });
  }
  const derived = aggregateSettlementRows(syntheticRows);
  const lastPaidAtMayBeStale = previous.active
    && previous.paidAt === base.lastPaidAt
    && (!next.active || next.paidAt < previous.paidAt);
  const lastPaidAt = next.active && next.paidAt > base.lastPaidAt
    ? next.paidAt
    : base.lastPaidAt;

  return {
    aggregate: {
      ...derived,
      count: Math.max(0, state.count),
      paymentCount: Math.max(0, state.paymentCount),
      refundCount: Math.max(0, state.refundCount),
      totalPaid: Math.max(0, state.totalPaid),
      totalRefunded: Math.max(0, state.totalRefunded),
      netAmount: state.totalPaid - state.totalRefunded,
      lastPaidAt,
    },
    lastPaidAtMayBeStale,
  };
}
