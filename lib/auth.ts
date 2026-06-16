import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { collection, doc, getDocs, getDoc, query, where } from "firebase/firestore";
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

// 로그인 실패 시 모든 경우에 동일한 메시지를 반환합니다.
// 계정 존재 여부나 활성화 상태를 외부에서 추론할 수 없도록 합니다.
const LOGIN_FAIL_MESSAGE = "이메일 또는 비밀번호가 올바르지 않습니다.";

async function getStaffByEmail(email: string): Promise<StaffUser | null> {
  const snap = await getDocs(
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

    // Ensure the ID token is propagated to Firestore before reading
    await credential.user.getIdToken();

    // Google 연동으로 UID가 바뀐 경우를 위해 이메일로도 fallback 조회
    let staff = await getStaffByUid(credential.user.uid);
    if (!staff) {
      staff = await getStaffByEmail(email);
    }

    if (!staff || !staff.active) {
      await signOut(auth);
      return {
        success: false,
        message: LOGIN_FAIL_MESSAGE,
      };
    }

    return {
      success: true,
      user: staff,
      redirect: "/",
    };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    console.error("[Auth] 로그인 실패:", code, error);
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
    let staff = await getStaffByUid(user.uid);
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
  await signOut(auth);
  return { success: true };
}

export async function getStaffByUid(uid: string): Promise<StaffUser | null> {
  const ref = doc(db, "staff", uid);
  let snap;
  for (let i = 0; i < 3; i++) {
    try {
      snap = await getDoc(ref);
      break;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "unavailable" && i < 2) {
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  if (!snap) throw new Error("Firestore 연결 실패");

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
