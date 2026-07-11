
import { calcCommissionBase, type PaymentMethod } from "./commissionUtils";

export type SettlementDirection = "payment" | "refund";
export type SettlementCategory = "deposit" | "surgery_fee" | "procedure_fee" | "other";
export type SettlementPaymentMethod = "card" | "cash" | "bank_transfer" | "foreign_card" | "other";
export type SettlementStatus = "active" | "void";

export type SettlementMathRow = {
  direction?: unknown;
  amount?: unknown;
  paymentMethod?: unknown;
  status?: unknown;
  isDeleted?: unknown;
  paidAt?: unknown;
};

export type SettlementAggregate = {
  count: number;
  paymentCount: number;
  refundCount: number;
  totalPaid: number;
  totalRefunded: number;
  netAmount: number;
  methodTotals: Record<SettlementPaymentMethod, number>;
  cardAmount: number;
  cashAmount: number;
  paymentMethod?: PaymentMethod;
  commissionBase: number;
  lastPaidAt: string;
};

const PAYMENT_METHODS = new Set<SettlementPaymentMethod>([
  "card",
  "cash",
  "bank_transfer",
  "foreign_card",
  "other",
]);

export function settlementAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(Math.abs(value)) : 0;
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(Math.abs(parsed)) : 0;
}

export function isSettlementPaymentMethod(value: unknown): value is SettlementPaymentMethod {
  return PAYMENT_METHODS.has(String(value) as SettlementPaymentMethod);
}

export function aggregateSettlementRows(rows: SettlementMathRow[]): SettlementAggregate {
  const methodTotals: Record<SettlementPaymentMethod, number> = {
    card: 0,
    cash: 0,
    bank_transfer: 0,
    foreign_card: 0,
    other: 0,
  };

  let count = 0;
  let paymentCount = 0;
  let refundCount = 0;
  let totalPaid = 0;
  let totalRefunded = 0;
  let lastPaidAt = "";

  for (const row of rows) {
    if (row.isDeleted === true || row.status === "void") continue;
    const direction = row.direction === "refund" ? "refund" : "payment";
    const amount = settlementAmount(row.amount);
    if (amount <= 0) continue;
    const method = isSettlementPaymentMethod(row.paymentMethod) ? row.paymentMethod : "other";
    const sign = direction === "refund" ? -1 : 1;

    count += 1;
    if (direction === "refund") {
      refundCount += 1;
      totalRefunded += amount;
    } else {
      paymentCount += 1;
      totalPaid += amount;
    }
    methodTotals[method] += sign * amount;
    const paidAt = String(row.paidAt || "");
    if (paidAt > lastPaidAt) lastPaidAt = paidAt;
  }

  const netAmount = totalPaid - totalRefunded;
  const cardAmount = methodTotals.card + methodTotals.foreign_card;
  const cashAmount = methodTotals.cash + methodTotals.bank_transfer + methodTotals.other;
  const hasCard = cardAmount !== 0;
  const hasCash = cashAmount !== 0;
  const paymentMethod: PaymentMethod | undefined = hasCard && hasCash
    ? "mixed"
    : hasCard
      ? "card"
      : hasCash
        ? "cash"
        : undefined;
  const commissionBase = paymentMethod
    ? Math.max(0, calcCommissionBase(netAmount, paymentMethod, cardAmount, cashAmount))
    : 0;

  return {
    count,
    paymentCount,
    refundCount,
    totalPaid,
    totalRefunded,
    netAmount,
    methodTotals,
    cardAmount,
    cashAmount,
    paymentMethod,
    commissionBase,
    lastPaidAt,
  };
}
