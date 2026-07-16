import type { StaffUser } from "./auth";

// 색상 설정(내원상태/예약유형)에서 공통으로 쓰는 HEX 정규화.
export function normalizeHexColor(value: unknown, fallback: string) {
  const raw = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}

function canManageSettings(staff: StaffUser | null | undefined) {
  const role = String(staff?.role || "").toLowerCase();
  return role === "admin";
}

function canEditMemo(staff: StaffUser | null | undefined) {
  const role = String(staff?.role || "").toLowerCase();
  return ["admin", "coordinator", "staff"].includes(role);
}

export function assertCanManageSettings(staff: StaffUser) {
  if (!staff?.uid) throw new Error("로그인 정보를 확인할 수 없습니다.");

  if (!canManageSettings(staff)) {
    throw new Error("설정 변경 권한이 없습니다. admin만 변경할 수 있습니다.");
  }
}

export function assertCanEditMemo(staff: StaffUser) {
  if (!staff?.uid) throw new Error("로그인 정보를 확인할 수 없습니다.");

  if (!canEditMemo(staff)) {
    throw new Error("메모 수정 권한이 없습니다.");
  }
}
