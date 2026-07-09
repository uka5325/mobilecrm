import { cleanText } from "./stringUtils";

export type AmountRowType = "deposit" | "surgery";

export type AmountRow = {
  id: string;
  reservationId: string;
  patientId: string;
  date: string;
  hospital: string;
  amount: string;
};

export type AmountRowSource = {
  id?: unknown;
  reservationId?: unknown;
  patientId?: unknown;
  reservationDate?: unknown;
  hospital?: unknown;
  consultArea?: unknown;
  doctors?: unknown;
  depositAmount?: unknown;
  surgeryCost?: unknown;
};

export function hasAmountValue(value: unknown): boolean {
  return cleanText(value).trim().length > 0;
}

export function amountGroupKey(row: AmountRowSource): string {
  const doctors = Array.isArray(row.doctors)
    ? row.doctors
    : typeof row.doctors === "string" && row.doctors
      ? row.doctors.split("|")
      : [];
  return [
    cleanText(row.hospital).trim().toLowerCase(),
    cleanText(row.consultArea).trim().toLowerCase(),
    doctors.map((d) => cleanText(d).trim().toLowerCase()).filter(Boolean).sort().join(","),
  ].join("|");
}

export function amountFieldForType(type: AmountRowType): "depositAmount" | "surgeryCost" {
  return type === "deposit" ? "depositAmount" : "surgeryCost";
}

export function amountFlagFieldForType(type: AmountRowType): "hasDepositAmount" | "hasSurgeryCost" {
  return type === "deposit" ? "hasDepositAmount" : "hasSurgeryCost";
}

export function amountTypeFromUnknown(value: unknown): AmountRowType {
  return value === "surgery" ? "surgery" : "deposit";
}

export function buildAmountRowsFromReservations(
  list: AmountRowSource[],
  type: AmountRowType
): AmountRow[] {
  const field = amountFieldForType(type);
  const seen = new Set<string>();
  return [...list]
    .sort((a, b) => (hasAmountValue(b[field]) ? 1 : 0) - (hasAmountValue(a[field]) ? 1 : 0))
    .filter((row) => {
      if (!hasAmountValue(row[field])) return false;
      const key = amountGroupKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => {
      const id = cleanText(row.id);
      return {
        id,
        reservationId: cleanText(row.reservationId) || id,
        patientId: cleanText(row.patientId),
        date: cleanText(row.reservationDate),
        hospital: cleanText(row.hospital),
        amount: cleanText(row[field]),
      };
    });
}
