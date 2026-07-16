export function todayString(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

// Firestore Timestamp / Date / number / string 을 Date 로 정규화하는 원시 헬퍼.
export function toDate(value: unknown): Date | null {
  try {
    if (!value) return null;

    if (
      typeof value === "object" &&
      value !== null &&
      "toDate" in value &&
      typeof (value as { toDate?: unknown }).toDate === "function"
    ) {
      return (value as { toDate: () => Date }).toDate();
    }

    if (value instanceof Date) return value;

    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return date;
    }

    return null;
  } catch {
    return null;
  }
}

export function toMillis(value: unknown): number {
  return toDate(value)?.getTime() ?? 0;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// offset개월 전/후 달의 [1일, 말일] 범위를 "YYYY-MM-DD"로 반환. (0=이번 달)
export function monthRange(offset: number): { start: string; end: string } {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const y = d.getFullYear();
  const m = d.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  return { start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
}
