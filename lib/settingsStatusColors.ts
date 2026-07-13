import type { StaffUser } from "./auth";
import { createLog } from "./logs";
import { callSettingsApi } from "./settingsApi";
import { assertCanManageSettings, normalizeHexColor } from "./settingsShared";

export type VisitStatus =
  | "내원전"
  | "대기"
  | "원상중"
  | "후상중"
  | "귀가"
  | "부도";

export type VisitStatusColorMap = Record<VisitStatus, string>;

export const VISIT_STATUS_LIST: VisitStatus[] = [
  "내원전",
  "대기",
  "원상중",
  "후상중",
  "귀가",
  "부도",
];

export const DEFAULT_VISIT_STATUS_COLORS: VisitStatusColorMap = {
  내원전: "#6b7280",
  대기: "#f59e0b",
  원상중: "#2563eb",
  후상중: "#14b8a6",
  귀가: "#16a34a",
  부도: "#dc2626",
};

export type VisitStatusColorSetting = {
  id: "visitStatusColors";
  colors: VisitStatusColorMap;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByUid?: string;
};

function normalizeVisitStatusColors(
  colors?: Partial<VisitStatusColorMap> | null
): VisitStatusColorMap {
  return {
    내원전: normalizeHexColor(colors?.내원전, DEFAULT_VISIT_STATUS_COLORS.내원전),
    대기: normalizeHexColor(colors?.대기, DEFAULT_VISIT_STATUS_COLORS.대기),
    원상중: normalizeHexColor(colors?.원상중, DEFAULT_VISIT_STATUS_COLORS.원상중),
    후상중: normalizeHexColor(colors?.후상중, DEFAULT_VISIT_STATUS_COLORS.후상중),
    귀가: normalizeHexColor(colors?.귀가, DEFAULT_VISIT_STATUS_COLORS.귀가),
    부도: normalizeHexColor(colors?.부도, DEFAULT_VISIT_STATUS_COLORS.부도),
  };
}

const STATUS_COLOR_CACHE_KEY = "crm_visit_status_colors";
const STATUS_COLOR_TTL_KEY = "crm_visit_status_colors_ts";
const STATUS_COLOR_TTL_MS = 5 * 60 * 1000;

export function getCachedVisitStatusColors(): VisitStatusColorMap | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STATUS_COLOR_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedVisitStatusColors(colors: VisitStatusColorMap) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STATUS_COLOR_CACHE_KEY, JSON.stringify(colors));
    localStorage.setItem(STATUS_COLOR_TTL_KEY, String(Date.now()));
  } catch {}
}

export async function getVisitStatusColors(): Promise<VisitStatusColorMap> {
  const cached = getCachedVisitStatusColors();
  if (cached) {
    const ts = Number(localStorage.getItem(STATUS_COLOR_TTL_KEY) || 0);
    if (Date.now() - ts < STATUS_COLOR_TTL_MS) return cached;
  }

  const result = await callSettingsApi("get_visit_status_colors");
  const data = result.data as Partial<VisitStatusColorSetting> | null;
  if (!data) return DEFAULT_VISIT_STATUS_COLORS;
  const colors = normalizeVisitStatusColors(data.colors);
  setCachedVisitStatusColors(colors);
  return colors;
}

export async function saveVisitStatusColors(
  colors: VisitStatusColorMap,
  staff: StaffUser
) {
  assertCanManageSettings(staff);

  const normalizedColors = normalizeVisitStatusColors(colors);
  await callSettingsApi("save_visit_status_colors", {
    colors: normalizedColors,
    updatedBy: staff.displayName || staff.email || "",
  });

  createLog({
    action: "settings_update",
    targetType: "settings",
    targetId: "visitStatusColors",
    staff,
    message: "내원상태 색상 설정을 변경했습니다.",
    after: { colors: normalizedColors },
  }).catch((e) => console.warn("[saveVisitStatusColors] log write failed:", e));

  setCachedVisitStatusColors(normalizedColors);
  return normalizedColors;
}

export async function resetVisitStatusColors(staff: StaffUser) {
  return saveVisitStatusColors(DEFAULT_VISIT_STATUS_COLORS, staff);
}
