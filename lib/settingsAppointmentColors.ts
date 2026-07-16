import type { StaffUser } from "./auth";
import { createLog } from "./logs";
import { callSettingsApi } from "./settingsApi";
import { assertCanManageSettings, normalizeHexColor } from "./settingsShared";

export type AppointmentTypeColorMap = {
  상담: string;
  수술: string;
  시술: string;
  치료: string;
  경과: string;
  진료: string;
  검진: string;
};

export const DEFAULT_APPOINTMENT_TYPE_COLORS: AppointmentTypeColorMap = {
  상담: "#2563eb",
  수술: "#ef4444",
  시술: "#db2777",
  치료: "#16a34a",
  경과: "#f59e0b",
  진료: "#7c3aed",
  검진: "#0891b2",
};

const APPT_COLOR_CACHE_KEY = "crm_appt_type_colors";
const APPT_COLOR_TTL_KEY = "crm_appt_type_colors_ts";
const APPT_COLOR_TTL_MS = 5 * 60 * 1000;

function normalizeAppointmentTypeColors(
  colors?: Partial<AppointmentTypeColorMap> | null
): AppointmentTypeColorMap {
  return {
    상담: normalizeHexColor(colors?.상담, DEFAULT_APPOINTMENT_TYPE_COLORS.상담),
    수술: normalizeHexColor(colors?.수술, DEFAULT_APPOINTMENT_TYPE_COLORS.수술),
    시술: normalizeHexColor(colors?.시술, DEFAULT_APPOINTMENT_TYPE_COLORS.시술),
    치료: normalizeHexColor(colors?.치료, DEFAULT_APPOINTMENT_TYPE_COLORS.치료),
    경과: normalizeHexColor(colors?.경과, DEFAULT_APPOINTMENT_TYPE_COLORS.경과),
    진료: normalizeHexColor(colors?.진료, DEFAULT_APPOINTMENT_TYPE_COLORS.진료),
    검진: normalizeHexColor(colors?.검진, DEFAULT_APPOINTMENT_TYPE_COLORS.검진),
  };
}

export function getCachedAppointmentTypeColors(): AppointmentTypeColorMap | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(APPT_COLOR_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedAppointmentTypeColors(colors: AppointmentTypeColorMap) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(APPT_COLOR_CACHE_KEY, JSON.stringify(colors));
    localStorage.setItem(APPT_COLOR_TTL_KEY, String(Date.now()));
  } catch {}
}

export async function getAppointmentTypeColors(): Promise<AppointmentTypeColorMap> {
  const cached = getCachedAppointmentTypeColors();
  if (cached && typeof window !== "undefined") {
    const ts = Number(localStorage.getItem(APPT_COLOR_TTL_KEY) || 0);
    if (Date.now() - ts < APPT_COLOR_TTL_MS) return cached;
  }

  const result = await callSettingsApi("get_appointment_colors");
  const data = result.data as { colors?: Partial<AppointmentTypeColorMap> } | null;
  if (!data) return DEFAULT_APPOINTMENT_TYPE_COLORS;
  const colors = normalizeAppointmentTypeColors(data.colors);
  setCachedAppointmentTypeColors(colors);
  return colors;
}

export async function saveAppointmentTypeColors(
  colors: AppointmentTypeColorMap,
  staff: StaffUser
) {
  assertCanManageSettings(staff);

  const normalizedColors = normalizeAppointmentTypeColors(colors);
  await callSettingsApi("save_appointment_colors", {
    colors: normalizedColors,
    updatedBy: staff.displayName || staff.email || "",
  });

  createLog({
    action: "settings_update",
    targetType: "settings",
    targetId: "appointmentTypeColors",
    staff,
    message: "유형별 색상 설정을 변경했습니다.",
    after: { colors: normalizedColors },
  }).catch((e) => console.warn("[saveAppointmentTypeColors] log write failed:", e));

  setCachedAppointmentTypeColors(normalizedColors);
  return normalizedColors;
}

export async function resetAppointmentTypeColors(staff: StaffUser) {
  return saveAppointmentTypeColors(DEFAULT_APPOINTMENT_TYPE_COLORS, staff);
}
