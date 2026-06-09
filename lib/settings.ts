import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { auth, db } from "./firebase";
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
  | "doctor"
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
  return role === "admin" || role === "doctor";
}

function canEditMemo(staff: StaffUser | null | undefined) {
  const role = String(staff?.role || "").toLowerCase();
  return ["admin", "doctor", "coordinator", "staff"].includes(role);
}

function assertCanManageSettings(staff: StaffUser) {
  if (!staff?.uid) throw new Error("로그인 정보를 확인할 수 없습니다.");

  if (!canManageSettings(staff)) {
    throw new Error("설정 변경 권한이 없습니다. admin 또는 doctor만 변경할 수 있습니다.");
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

  if (["admin", "doctor", "coordinator", "staff", "interpreter"].includes(role)) {
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

  const ref = doc(db, "appSettings", "visitStatusColors");
  const snap = await getDoc(ref);

  if (!snap.exists()) return DEFAULT_VISIT_STATUS_COLORS;

  const data = snap.data() as Partial<VisitStatusColorSetting>;
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
  const ref = doc(db, "appSettings", "visitStatusColors");

  await setDoc(
    ref,
    {
      id: "visitStatusColors",
      colors: normalizedColors,
      updatedAt: serverTimestamp(),
      updatedBy: staff.displayName || staff.email || "",
      updatedByUid: staff.uid,
    },
    { merge: true }
  );

  await createLog({
    action: "settings_update",
    targetType: "settings",
    targetId: "visitStatusColors",
    staff,
    message: "내원상태 색상 설정을 변경했습니다.",
    after: { colors: normalizedColors },
  });

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
  const ref = doc(db, "appSettings", "general");
  const snap = await getDoc(ref);

  if (!snap.exists()) return DEFAULT_GENERAL_SETTINGS;

  const data = snap.data() as Partial<GeneralSettings>;
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

  const nextSettings: GeneralSettings = {
    id: "general",
    appCountry: normalizedCountry,
    appCountryLabel: country.label,
    appTimezone: country.timezone,
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName || staff.email || "",
    updatedByUid: staff.uid,
  };

  const ref = doc(db, "appSettings", "general");
  await setDoc(ref, nextSettings, { merge: true });

  await createLog({
    action: "settings_update",
    targetType: "settings",
    targetId: "general",
    staff,
    message: `상담회 국가를 ${country.label} / ${country.timezone}으로 변경했습니다.`,
    after: {
      appCountry: normalizedCountry,
      appCountryLabel: country.label,
      appTimezone: country.timezone,
    },
  });

  return { ...nextSettings, updatedAt: undefined };
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

  const q = query(
    collection(db, "conferenceMemos"),
    where("memoDate", "==", targetDate)
  );

  const snap = await getDocs(q);

  const result = snap.docs
    .map((docSnap) => {
      const data = docSnap.data() as Omit<ConferenceMemo, "id">;

      return {
        id: docSnap.id,
        memoDate: normalizeDateOnly(data.memoDate),
        memoText: cleanText(data.memoText),
        createdBy: cleanText(data.createdBy),
        createdByName: cleanText(data.createdByName),
        createdAt: data.createdAt,
        deleted: Boolean(data.deleted),
        deletedAt: data.deletedAt,
        deletedBy: cleanText(data.deletedBy),
      };
    })
    .filter((memo) => memo.deleted !== true)
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    .slice(0, limit);

  setTimeout(() => {
    try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch {}
  }, 0);

  return result;
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

  const docRef = await addDoc(collection(db, "conferenceMemos"), {
    memoDate: targetDate,
    memoText: text,
    createdBy: staff.uid,
    createdByName: staff.displayName || staff.email || "",
    createdAt: serverTimestamp(),
    deleted: false,
    deletedAt: null,
    deletedBy: "",
  });

  await createLog({
    action: "memo_create",
    targetType: "memo",
    targetId: docRef.id,
    staff,
    message: `${targetDate} 전체 메모를 추가했습니다.`,
    after: {
      memoDate: targetDate,
      memoText: text,
    },
  });

  invalidateMemoCache(targetDate);
  return docRef.id;
}

export async function deleteConferenceMemo(memoId: string, staff: StaffUser, memoDate?: string) {
  assertCanEditMemo(staff);

  const id = cleanText(memoId);
  if (!id) throw new Error("메모 ID가 없습니다.");

  const ref = doc(db, "conferenceMemos", id);

  await updateDoc(ref, {
    deleted: true,
    deletedAt: serverTimestamp(),
    deletedBy: staff.uid,
  });

  await createLog({
    action: "memo_delete",
    targetType: "memo",
    targetId: id,
    staff,
    message: "전체 메모를 삭제했습니다.",
    after: { deleted: true },
  });

  if (memoDate) invalidateMemoCache(normalizeDateOnly(memoDate));
  return true;
}

/* ============================================================
   직원 관리
============================================================ */

export async function getStaffListForSettings(): Promise<SettingsStaffRecord[]> {
  const snap = await getDocs(collection(db, "staff"));

  return snap.docs
    .map((docSnap) => {
      const data = docSnap.data();

      return {
        id: docSnap.id,
        uid: cleanText(data.uid || docSnap.id),
        email: cleanText(data.email),
        displayName: cleanText(
          data.displayName ||
            data["display_name"] ||
            data.email ||
            docSnap.id
        ),
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
      };
    })
    .sort((a, b) => {
      const roleOrder: Record<string, number> = {
        admin: 1,
        doctor: 2,
        coordinator: 3,
        staff: 4,
        interpreter: 5,
      };

      const ar = roleOrder[String(a.role)] || 99;
      const br = roleOrder[String(b.role)] || 99;

      return (
        ar - br ||
        Number(a.orderNo || 999999) - Number(b.orderNo || 999999) ||
        a.displayName.localeCompare(b.displayName)
      );
    });
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

  if (payload.displayName !== undefined) {
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

  const ref = doc(db, "staff", id);
  await updateDoc(ref, updatePayload);
  invalidateDoctorsCache();

  await createLog({
    action: "settings_update",
    targetType: "settings",
    targetId: id,
    staff: actor,
    message: "직원 설정을 수정했습니다.",
    after: updatePayload,
  });

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

  await createLog({
    action: "settings_update",
    targetType: "settings",
    targetId: "password",
    staff,
    message: "내 비밀번호를 변경했습니다.",
    after: { changed: true },
  });

  return true;
}
