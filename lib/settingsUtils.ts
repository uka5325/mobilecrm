import { toDate } from "./dateUtils";

export function normalizeHexInput(value: string) {
  const raw = value.trim();
  if (!raw) return "#000000";
  if (raw.startsWith("#")) return raw;
  return `#${raw}`;
}

export function isValidHex(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "오류가 발생했습니다.";
}

export function formatDateTime(value: unknown) {
  const date = toDate(value);
  if (!date) return "";

  return (
    date.getFullYear() +
    "." +
    String(date.getMonth() + 1).padStart(2, "0") +
    "." +
    String(date.getDate()).padStart(2, "0") +
    " " +
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0") +
    ":" +
    String(date.getSeconds()).padStart(2, "0")
  );
}

export function notifyStaffSettingsUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("arc-crm-staff-updated"));
}
