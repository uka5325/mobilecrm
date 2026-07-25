import { todayString } from "@/lib/dateUtils";

// 스케줄 화면 전용 날짜 헬퍼 — 모두 "YYYY-MM-DD" 문자열 기준.

export function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, days: number) {
  const d = parseDate(s);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export function getWeekStart(dateStr: string) {
  const d = parseDate(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

export function getMonthStart(dateStr: string) {
  const [y, m] = dateStr.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

export function getMonthEnd(dateStr: string) {
  const [y, m] = dateStr.split("-").map(Number);
  const last = new Date(y, m, 0);
  return formatDate(last);
}

export function formatDayLabel(dateStr: string) {
  const d = parseDate(dateStr);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

export function isToday(dateStr: string) {
  return dateStr === todayString();
}

export function formatLog(updatedBy: unknown, updatedAt: unknown): string {
  const name = typeof updatedBy === "string" ? updatedBy.trim() : "";
  let dateStr = "";
  if (updatedAt) {
    try {
      // toSerializable converts Firestore Timestamp to milliseconds (number)
      const ms =
        typeof updatedAt === "number"
          ? updatedAt
          : typeof (updatedAt as { toMillis?: () => number }).toMillis === "function"
          ? (updatedAt as { toMillis: () => number }).toMillis()
          : Number(updatedAt);
      if (ms && ms > 0) {
        const d = new Date(ms);
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        const hh = String(d.getHours()).padStart(2, "0");
        const min = String(d.getMinutes()).padStart(2, "0");
        dateStr = `${mm}/${dd} ${hh}:${min}`;
      }
    } catch {
      // ignore
    }
  }
  return [name, dateStr].filter(Boolean).join(" · ");
}
