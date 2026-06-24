import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  type QueryDocumentSnapshot,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { auth, db } from "./firebase";

async function callSettingsApi(action: string, payload: Record<string, unknown> = {}) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error("로그인 상태를 확인할 수 없습니다.");
  const idToken = await firebaseUser.getIdToken();
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action, payload }),
  });
  const data = await res.json() as Record<string, unknown> & { success: boolean; message?: string };
  if (!data.success) throw new Error(data.message || "API 요청에 실패했습니다.");
  return data;
}
import type { StaffUser } from "./auth";
import { createLog } from "./logs";
import { invalidateDoctorsCache } from "./reservations";
import { cleanText } from "./stringUtils";
import { toMillis } from "./settingsUtils";

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

export type CountryKey =
  | "Korea"
  | "Mongolia"
  | "Japan"
  | "Vietnam"
  | "Thailand";

export type CountryTimezone = {
  label: string;
  timezone: string;
};

export const COUNTRY_TIMEZONES: Record<CountryKey, CountryTimezone> = {
  Korea: { label: "대한민국", timezone: "Asia/Seoul" },
  Mongolia: { label: "몽골", timezone: "Asia/Ulaanbaatar" },
  Japan: { label: "일본", timezone: "Asia/Tokyo" },
  Vietnam: { label: "베트남", timezone: "Asia/Ho_Chi_Minh" },
  Thailand: { label: "태국", timezone: "Asia/Bangkok" },
};

export type GeneralSettings = {
  id: "general";
  appCountry: CountryKey;
  appCountryLabel: string;
  appTimezone: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByUid?: string;
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  id: "general",
  appCountry: "Korea",
  appCountryLabel: COUNTRY_TIMEZONES.Korea.label,
  appTimezone: COUNTRY_TIMEZONES.Korea.timezone,
};

export type ConferenceMemo = {
  id: string;
  memoDate: string;
  memoText: string;
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  deleted?: boolean;
  deletedAt?: unknown;
  deletedBy?: string;
};

export type SettingsStaffRole =
  | "admin"
  | "coordinator"
  | "staff"
  | "interpreter";

export type SettingsStaffRecord = {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: SettingsStaffRole | string;
  active: boolean;
  staffCode?: string;
  orderNo?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByUid?: string;
};

export type StaffUpdatePayload = {
  displayName?: string;
  role?: SettingsStaffRole | string;
  active?: boolean;
  orderNo?: number;
};

function canManageSettings(staff: StaffUser | null | undefined) {
  const role = String(staff?.role || "").toLowerCase();
  return role === "admin";
}

function canEditMemo(staff: StaffUser | null | undefined) {
  const role = String(staff?.role || "").toLowerCase();
  return ["admin", "coordinator", "staff"].includes(role);
}

function assertCanManageSettings(staff: StaffUser) {
  if (!staff?.uid) throw new Error("로그인 정보를 확인할 수 없습니다.");

  if (!canManageSettings(staff)) {
    throw new Error("설정 변경 권한이 없습니다. admin만 변경할 수 있습니다.");
  }
}

function assertCanEditMemo(staff: StaffUser) {
  if (!staff?.uid) throw new Error("로그인 정보를 확인할 수 없습니다.");

  if (!canEditMemo(staff)) {
    throw new Error("메모 수정 권한이 없습니다.");
  }
}

function normalizeHexColor(value: unknown, fallback: string) {
  const raw = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}

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

function normalizeCountryKey(value: unknown): CountryKey {
  const raw = String(value || "").trim() as CountryKey;
  return Object.prototype.hasOwnProperty.call(COUNTRY_TIMEZONES, raw)
    ? raw
    : "Korea";
}

function normalizeDateOnly(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return todayString();

  const dash = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (dash) {
    return `${dash[1]}-${String(Number(dash[2])).padStart(2, "0")}-${String(
      Number(dash[3])
    ).padStart(2, "0")}`;
  }

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  return raw.slice(0, 10);
}

function todayString() {
  const d = new Date();

  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}


function cleanRole(value: unknown): SettingsStaffRole | string {
  const role = cleanText(value).toLowerCase();

  if (["admin", "coordinator", "staff", "interpreter"].includes(role)) {
    return role as SettingsStaffRole;
  }

  return role || "staff";
}

/* ============================================================
   내원상태 색상 설정
============================================================ */

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

/* ============================================================
   기본 설정 — 상담회 국가 / 시간대
============================================================ */

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const result = await callSettingsApi("get_general_settings");
  const data = result.data as Partial<GeneralSettings> | null;
  if (!data) return DEFAULT_GENERAL_SETTINGS;
  const appCountry = normalizeCountryKey(data.appCountry);
  const country = COUNTRY_TIMEZONES[appCountry] || COUNTRY_TIMEZONES.Korea;
  return {
    id: "general",
    appCountry,
    appCountryLabel: country.label,
    appTimezone: cleanText(data.appTimezone) || country.timezone,
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy || "",
    updatedByUid: data.updatedByUid || "",
  };
}

export async function saveGeneralSettings(
  appCountry: CountryKey,
  staff: StaffUser
) {
  assertCanManageSettings(staff);

  const normalizedCountry = normalizeCountryKey(appCountry);
  const country = COUNTRY_TIMEZONES[normalizedCountry] || COUNTRY_TIMEZONES.Korea;

  const nextSettings = {
    id: "general",
    appCountry: normalizedCountry,
    appCountryLabel: country.label,
    appTimezone: country.timezone,
  };

  await callSettingsApi("save_general_settings", {
    settings: nextSettings,
    updatedBy: staff.displayName || staff.email || "",
  });

  return nextSettings as GeneralSettings;
}

/* ============================================================
   오늘의 메모
============================================================ */

const MEMO_CACHE_PREFIX = "crm_memos_";

function invalidateMemoCache(memoDate: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(MEMO_CACHE_PREFIX + memoDate);
  } catch {}
}

export async function getConferenceMemos(
  memoDate: string,
  limit = 50
): Promise<ConferenceMemo[]> {
  const targetDate = normalizeDateOnly(memoDate);
  const cacheKey = MEMO_CACHE_PREFIX + targetDate;

  if (typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) return JSON.parse(raw) as ConferenceMemo[];
    } catch {}
  }

  const result = await callSettingsApi("get_memos", { memoDate: targetDate, limit });
  const memos = (result.memos as ConferenceMemo[]) ?? [];

  setTimeout(() => {
    try { sessionStorage.setItem(cacheKey, JSON.stringify(memos)); } catch {}
  }, 0);

  return memos;
}

export async function addConferenceMemo(
  memoDate: string,
  memoText: string,
  staff: StaffUser
) {
  assertCanEditMemo(staff);

  const targetDate = normalizeDateOnly(memoDate);
  const text = cleanText(memoText);

  if (!text) throw new Error("메모 내용을 입력하세요.");

  const result = await callSettingsApi("add_memo", {
    memoDate: targetDate,
    memoText: text,
    createdByName: staff.displayName || staff.email || "",
  });

  invalidateMemoCache(targetDate);
  return result.id as string;
}

export async function deleteConferenceMemo(memoId: string, staff: StaffUser, memoDate?: string) {
  assertCanEditMemo(staff);

  const id = cleanText(memoId);
  if (!id) throw new Error("메모 ID가 없습니다.");

  await callSettingsApi("delete_memo", { memoId: id });

  if (memoDate) invalidateMemoCache(normalizeDateOnly(memoDate));
  return true;
}

export async function updateConferenceMemo(memoId: string, memoText: string, staff: StaffUser, memoDate?: string) {
  assertCanEditMemo(staff);

  const id = cleanText(memoId);
  if (!id) throw new Error("메모 ID가 없습니다.");

  const text = cleanText(memoText);
  if (!text) throw new Error("메모 내용을 입력하세요.");

  await callSettingsApi("update_memo", { memoId: id, memoText: text });

  if (memoDate) invalidateMemoCache(normalizeDateOnly(memoDate));
  return true;
}

/* ============================================================
   직원 관리
============================================================ */

let _staffListCache: SettingsStaffRecord[] | null = null;
const _STAFF_CACHE_KEY = "mcrm_staff_list";
const _STAFF_CACHE_TTL = 5 * 60 * 1000;

export function clearStaffListCache() {
  _staffListCache = null;
  try { localStorage.removeItem(_STAFF_CACHE_KEY); } catch {}
}

export async function getStaffListForSettings(): Promise<SettingsStaffRecord[]> {
  if (_staffListCache) return _staffListCache;
  try {
    const raw = localStorage.getItem(_STAFF_CACHE_KEY);
    if (raw) {
      const { ts, data } = JSON.parse(raw) as { ts: number; data: SettingsStaffRecord[] };
      if (Date.now() - ts < _STAFF_CACHE_TTL) { _staffListCache = data; return data; }
    }
  } catch {}
  const result = await callSettingsApi("get_staff_list");
  const rawList = (result.staff as Record<string, unknown>[] | undefined) || [];

  const sorted = rawList
    .map((data) => ({
      id: cleanText(data.id),
      uid: cleanText(data.uid || data.id),
      email: cleanText(data.email),
      displayName: cleanText(data.displayName || data["display_name"] || data.email || data.id),
      role: cleanRole(data.role),
      active: data.active !== false,
      staffCode: cleanText(data.staffCode || data["staff_code"]),
      orderNo:
        typeof data.orderNo === "number"
          ? data.orderNo
          : typeof data["order_no"] === "number"
            ? data["order_no"] as number
            : 999999,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      updatedBy: cleanText(data.updatedBy),
      updatedByUid: cleanText(data.updatedByUid),
    }))
    .sort((a, b) => {
      const roleOrder: Record<string, number> = {
        admin: 1,
        coordinator: 2,
        staff: 3,
        interpreter: 4,
      };
      const ar = roleOrder[String(a.role)] || 99;
      const br = roleOrder[String(b.role)] || 99;
      return (
        ar - br ||
        Number(a.orderNo || 999999) - Number(b.orderNo || 999999) ||
        a.displayName.localeCompare(b.displayName)
      );
    });
  try { localStorage.setItem(_STAFF_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: sorted })); } catch {}
  _staffListCache = sorted;
  return _staffListCache;
}

export async function updateStaffFromSettings(
  staffId: string,
  payload: StaffUpdatePayload,
  actor: StaffUser
) {
  assertCanManageSettings(actor);

  const id = cleanText(staffId);
  if (!id) throw new Error("직원 ID가 없습니다.");

  const updatePayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    updatedBy: actor.displayName || actor.email || "",
    updatedByUid: actor.uid,
  };

  const ref = doc(db, "staff", id);
  let oldDisplayName = "";

  if (payload.displayName !== undefined) {
    const oldSnap = await getDoc(ref);
    oldDisplayName = cleanText(oldSnap.data()?.displayName);
    updatePayload.displayName = cleanText(payload.displayName);
  }

  if (payload.role !== undefined) {
    updatePayload.role = cleanRole(payload.role);
  }

  if (payload.active !== undefined) {
    updatePayload.active = Boolean(payload.active);
  }

  if (payload.orderNo !== undefined) {
    updatePayload.orderNo = Number(payload.orderNo || 999999);
  }

  await updateDoc(ref, updatePayload);
  invalidateDoctorsCache();

  const newDisplayName = typeof updatePayload.displayName === "string" ? updatePayload.displayName : "";
  if (oldDisplayName && newDisplayName && oldDisplayName !== newDisplayName) {
    const CHUNK = 400;
    let lastDoc: QueryDocumentSnapshot | null = null;
    let hasMore = true;

    while (hasMore) {
      const constraints = [
        where("doctors", "array-contains", oldDisplayName),
        limit(CHUNK),
        ...(lastDoc ? [startAfter(lastDoc)] : []),
      ];
      const snap = await getDocs(query(collection(db, "reservations"), ...constraints));
      if (snap.empty) break;

      const batch = writeBatch(db);
      snap.docs.forEach((d) => {
        const doctors = (d.data().doctors as string[] | undefined) || [];
        batch.update(d.ref, { doctors: doctors.map((n) => (n === oldDisplayName ? newDisplayName : n)) });
      });
      await batch.commit();

      lastDoc = snap.docs[snap.docs.length - 1];
      hasMore = snap.docs.length === CHUNK;
    }
  }

  createLog({
    action: "settings_update",
    targetType: "settings",
    targetId: id,
    staff: actor,
    message: "직원 설정을 수정했습니다.",
    after: updatePayload,
  }).catch((e) => console.warn("[updateStaffFromSettings] log write failed:", e));

  return true;
}

export async function createStaffFromSettings(
  params: {
    email: string;
    password: string;
    displayName: string;
    role: SettingsStaffRole;
    staffCode?: string;
  },
  actor: StaffUser
): Promise<void> {
  assertCanManageSettings(actor);

  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/staff/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...params }),
  });

  const data = (await res.json()) as { success: boolean; message?: string };
  if (!data.success) {
    throw new Error(data.message || "직원 생성에 실패했습니다.");
  }
  invalidateDoctorsCache();
}

export async function deactivateStaffFromSettings(
  staffId: string,
  actor: StaffUser
) {
  assertCanManageSettings(actor);

  const id = cleanText(staffId);
  if (!id) throw new Error("직원 ID가 없습니다.");

  if (id === actor.uid) {
    throw new Error("본인 계정은 비활성화할 수 없습니다.");
  }

  return updateStaffFromSettings(id, { active: false }, actor);
}

/* ============================================================
   보안 — 내 비밀번호 변경
============================================================ */

export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
  staff: StaffUser
) {
  if (!staff?.uid) throw new Error("로그인 정보를 확인할 수 없습니다.");

  const user = auth.currentUser;

  if (!user || !user.email) {
    throw new Error("현재 로그인 계정을 확인할 수 없습니다.");
  }

  const current = cleanText(currentPassword);
  const next = cleanText(newPassword);

  if (!current) throw new Error("현재 비밀번호를 입력하세요.");
  if (!next) throw new Error("새 비밀번호를 입력하세요.");
  if (next.length < 6) {
    throw new Error("새 비밀번호는 최소 6자 이상 입력하세요.");
  }

  const credential = EmailAuthProvider.credential(user.email, current);

  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, next);

  createLog({
    action: "settings_update",
    targetType: "settings",
    targetId: "password",
    staff,
    message: "내 비밀번호를 변경했습니다.",
    after: { changed: true },
  }).catch((e) => console.warn("[changeMyPassword] log write failed:", e));

  return true;
}

/* ============================================================
   예약 유형별 색상 설정
============================================================ */

export type AppointmentTypeColorMap = {
  상담: string;
  수술: string;
  치료: string;
  경과: string;
  진료: string;
  검진: string;
};

export const DEFAULT_APPOINTMENT_TYPE_COLORS: AppointmentTypeColorMap = {
  상담: "#2563eb",
  수술: "#ef4444",
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
