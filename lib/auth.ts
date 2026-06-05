import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

export type StaffRole =
  | "admin"
  | "doctor"
  | "coordinator"
  | "staff"
  | "interpreter";

export type StaffUser = {
  uid: string;
  email: string;
  displayName: string;
  role: StaffRole;
  active: boolean;

  // 선택값: 내부 관리용으로 쓰고 싶을 때만 사용
  staffCode?: string;
};

const ROLE_LEVEL: Record<StaffRole, number> = {
  admin: 5,
  doctor: 4,
  coordinator: 3,
  staff: 2,
  interpreter: 1,
};

export async function loginWithEmail(email: string, password: string) {
  if (!email || !password) {
    return {
      success: false,
      message: "이메일과 비밀번호를 입력하세요.",
    };
  }

  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      email.trim(),
      password.trim()
    );

    const staff = await getStaffByUid(credential.user.uid);

    if (!staff) {
      await signOut(auth);
      return {
        success: false,
        message: "등록된 직원 계정이 아닙니다.",
      };
    }

    if (!staff.active) {
      await signOut(auth);
      return {
        success: false,
        message: "비활성화된 계정입니다.",
      };
    }

    return {
      success: true,
      user: staff,
      redirect: "/",
    };
  } catch (error) {
    return {
      success: false,
      message: "이메일 또는 비밀번호가 올바르지 않습니다.",
    };
  }
}

export async function logout() {
  await signOut(auth);
  return { success: true };
}

export async function getStaffByUid(uid: string): Promise<StaffUser | null> {
  const ref = doc(db, "staff", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  const data = snap.data();

  return {
    uid,
    email: String(data.email || ""),
    displayName: String(data.displayName || ""),
    role: (data.role || "staff") as StaffRole,
    active: data.active === true,
    staffCode: data.staffCode ? String(data.staffCode) : undefined,
  };
}

export function checkPermission(
  user: StaffUser | null,
  requiredRole: StaffRole
) {
  if (!user) return false;

  return (
    (ROLE_LEVEL[user.role] || 0) >=
    (ROLE_LEVEL[requiredRole] || 0)
  );
}

export function listenCurrentUser(
  callback: (user: User | null) => void
) {
  return onAuthStateChanged(auth, callback);
}
