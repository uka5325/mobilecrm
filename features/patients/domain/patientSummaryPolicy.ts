export type SummaryDomain = "reservation" | "invoice" | "memo";

export const ALL_SUMMARY_DOMAINS: readonly SummaryDomain[] = [
  "reservation",
  "invoice",
  "memo",
] as const;

export function normalizeSummaryDomains(value: unknown): SummaryDomain[] {
  if (!Array.isArray(value)) return [...ALL_SUMMARY_DOMAINS];

  const seen = new Set<SummaryDomain>();
  for (const item of value) {
    if (item === "reservation" || item === "invoice" || item === "memo") {
      seen.add(item);
    }
  }

  return seen.size ? [...seen] : [...ALL_SUMMARY_DOMAINS];
}

export function summaryRetryDelayMs(attempts: number): number {
  const normalizedAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  return Math.min(oneHour * 2 ** (normalizedAttempts - 1), oneDay);
}
