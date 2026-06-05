import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { StaffUser } from "./auth";
import { createLog } from "./logs";

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

function normalizeHexColor(value: unknown, fallback: string) {
  const raw = String(value || "").trim();

  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw;
  }

  return fallback;
}

function normalizeVisitStatusColors(
  colors?: Partial<VisitStatusColorMap> | null
): VisitStatusColorMap {
  return {
    내원전: normalizeHexColor(
      colors?.내원전,
      DEFAULT_VISIT_STATUS_COLORS.내원전
    ),
    대기: normalizeHexColor(colors?.대기, DEFAULT_VISIT_STATUS_COLORS.대기),
    원상중: normalizeHexColor(
      colors?.원상중,
      DEFAULT_VISIT_STATUS_COLORS.원상중
    ),
    후상중: normalizeHexColor(
      colors?.후상중,
      DEFAULT_VISIT_STATUS_COLORS.후상중
    ),
    귀가: normalizeHexColor(colors?.귀가, DEFAULT_VISIT_STATUS_COLORS.귀가),
    부도: normalizeHexColor(colors?.부도, DEFAULT_VISIT_STATUS_COLORS.부도),
  };
}

export async function getVisitStatusColors(): Promise<VisitStatusColorMap> {
  const ref = doc(db, "appSettings", "visitStatusColors");
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return DEFAULT_VISIT_STATUS_COLORS;
  }

  const data = snap.data() as Partial<VisitStatusColorSetting>;
  const colors = data.colors as Partial<VisitStatusColorMap> | undefined;

  return normalizeVisitStatusColors(colors);
}

export async function saveVisitStatusColors(
  colors: VisitStatusColorMap,
  staff: StaffUser
) {
  if (!staff?.uid) {
    throw new Error("로그인 정보를 확인할 수 없습니다.");
  }

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
    after: {
      colors: normalizedColors,
    },
  });

  return normalizedColors;
}

export async function resetVisitStatusColors(staff: StaffUser) {
  return saveVisitStatusColors(DEFAULT_VISIT_STATUS_COLORS, staff);
}
