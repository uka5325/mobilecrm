export type PaymentMethod = "card" | "cash" | "mixed";

export function calcCommissionBase(
  finalTotal: number,
  paymentMethod: PaymentMethod,
  cardAmount?: number,
  cashAmount?: number
): number {
  if (paymentMethod === "cash") return finalTotal;
  if (paymentMethod === "card") return Math.round(finalTotal / 1.1);
  // mixed: 카드분만 VAT 제거
  return Math.round((cardAmount ?? 0) / 1.1) + (cashAmount ?? 0);
}

export function calcCommission(base: number, rate: number): number {
  return Math.round(base * (rate / 100));
}

export function paymentMethodLabel(method: PaymentMethod | undefined): string {
  if (method === "card") return "카드";
  if (method === "cash") return "현금";
  if (method === "mixed") return "혼합";
  return "-";
}
