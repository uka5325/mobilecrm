import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { collection, getDocsFromServer, query, where } from "firebase/firestore";
import { auth, db } from "./firebase";
import { clearAllClientCaches } from "./clientCache";

export type StaffRole =
  | "admin"
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
  admin: 4,
  coordinator: 3,
  staff: 2,
  interpreter: 1,
};

// 로그인 실패 시 모든 경우에 동일한 메시지를 반환합니다.
// 계정 존재 여부나 활성화 상태를 외부에서 추론할 수 없도록 합니다.
const LOGIN_FAIL_MESSAGE = "이메일 또는 비밀번호가 올바르지 않습니다.";

async function getStaffByEmail(email: string): Promise<StaffUser | null> {
  const snap = await getDocsFromServer(
    query(collection(db, "staff"), where("email", "==", email.toLowerCase().trim()))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data();
  return {
    uid: d.id,
    email: String(data.email || ""),
    displayName: String(data.displayName || ""),
    role: (data.role || "staff") as StaffRole,
    active: data.active === true,
    staffCode: data.staffCode ? String(data.staffCode) : undefined,
  };
}

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

    const idToken = await credential.user.getIdToken();

    const res = await fetch("/api/verify-staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json();

    if (!data.success) {
      await signOut(auth);
      return { success: false, message: LOGIN_FAIL_MESSAGE };
    }

    return { success: true, user: data.user, redirect: "/" };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    console.error("[Auth] 로그인 실패:", code, (error as Error)?.message ?? "");
    return {
      success: false,
      message: LOGIN_FAIL_MESSAGE,
      _debug: code,
    };
  }
}

const googleProvider = new GoogleAuthProvider();

export async function loginWithGoogle() {
  try {
    const credential = await signInWithPopup(auth, googleProvider);
    const user = credential.user;

    // UID로 먼저 찾고, 없으면 이메일로 fallback
    let staff = await getStaffByUid();
    if (!staff && user.email) {
      staff = await getStaffByEmail(user.email);
    }

    if (!staff || !staff.active) {
      await signOut(auth);
      return {
        success: false,
        message: "이 Google 계정은 등록된 직원 계정이 아닙니다. 관리자에게 문의하세요.",
      };
    }

    return { success: true, user: staff, redirect: "/" };
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Auth] Google 로그인 실패:", error);
    }
    const code = (error as { code?: string }).code;
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      return { success: false, message: "" };
    }
    if (code === "auth/operation-not-allowed") {
      return { success: false, message: "Google 로그인이 비활성화되어 있습니다. Firebase Console → Authentication → Sign-in method에서 Google을 활성화하세요." };
    }
    if (code === "auth/unauthorized-domain") {
      return { success: false, message: "이 도메인은 Firebase에서 허용되지 않습니다. Firebase Console → Authentication → Settings → Authorized domains에 현재 도메인을 추가하세요." };
    }
    const msg = (error as { message?: string }).message || String(error);
    return { success: false, message: `Google 로그인 실패 (${code ?? msg})` };
  }
}

export async function logout() {
  // 로그아웃 즉시 클라 캐시 비우기(공용기기 PII/금액 잔존 차단).
  clearAllClientCaches();
  await signOut(auth);
  return { success: true };
}

export async function getStaffByUid(): Promise<StaffUser | null> {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    const idToken = await currentUser.getIdToken();
    const res = await fetch("/api/verify-staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json();
    if (!data.success) return null;
    return data.user as StaffUser;
  } catch {
    return null;
  }
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

export async function resetPassword(email: string) {
  if (!email) return { success: false, message: "이메일을 입력하세요." };
  try {
    await sendPasswordResetEmail(auth, email.trim());
    return { success: true };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/user-not-found") {
      return { success: false, message: "등록된 이메일이 없습니다." };
    }
    return { success: false, message: "재설정 메일 전송에 실패했습니다." };
  }
}
