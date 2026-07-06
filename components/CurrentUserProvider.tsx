"use client";

// ─────────────────────────────────────────────────────────────────────────────
// 전역 단일 직원 상태(#3 로그인 시점 중복 호출 제거 + 재검증 폴링 제거)
//
// 배경: AppShell과 각 페이지의 hooks/useCurrentUser.ts가 각자 자체적으로
// onAuthStateChanged 구독 + getStaffByUid()(→ /api/verify-staff, admin SDK 읽기)를
// 돌리던 걸 이 Provider 하나로 합친다. 캐시가 비어있는 시점(로그인 직후·새 탭)에는
// 두 로직이 경쟁하며 verify-staff를 중복 호출했는데, 구독이 하나뿐이면 경쟁 자체가 없다.
//
// 또한 "직원이 아직 active인가"를 focus/visibilitychange/라우트 변경 이벤트에 얹어
// 매번 폴링하던 방식(캐시/스로틀 없음 → 브라우저·OS가 그런 이벤트를 자주 발생시켜
// idle 상태에서도 읽기가 계속 쌓였다)을, 본인의 staff/{uid} 문서에 대한 Firestore
// 실시간 리스너(onSnapshot)로 교체한다. 최초 attach 1회 읽기 이후로는 그 문서가
// 실제로 바뀔 때만 서버가 푸시하므로 폴링 자체가 사라지고, 탐지 속도도 더 빨라진다
// (firestore.rules의 isActiveStaff()가 검사하는 문서와 리스너가 구독하는 문서가
// 정확히 같아, 관리자가 비활성화/삭제하는 즉시 규칙 재평가 트리거와 일치한다).
// ─────────────────────────────────────────────────────────────────────────────

import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { User } from "firebase/auth";
import { signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { listenCurrentUser } from "@/lib/auth";
import type { StaffUser } from "@/lib/auth";
import { clearAllClientCaches, clearFirestorePersistence } from "@/lib/clientCache";

const STAFF_CACHE_KEY = "arc_crm_staff_user";

// 로그아웃 재진입 방지 guard — signOut이 auth listener를 null로 트리거하면서
// 로그아웃 경로가 중복 실행되거나 무한 반복되는 것을 막는다(모듈 스코프 1회성).
let loggingOut = false;

// 안전 로그아웃: 앱 캐시/세션·Firestore 영속 캐시를 정리하고, 실패 여부와 무관하게
// 반드시 로그인 화면으로 hard redirect한다(공용기기 PII 잔존 + 부분 세션 잔존 차단).
async function runSecureLogout() {
  if (loggingOut || typeof window === "undefined") return;
  loggingOut = true;
  try {
    try { sessionStorage.removeItem(STAFF_CACHE_KEY); } catch {}
    clearAllClientCaches();
    try { await signOut(auth); } catch {}
    await clearFirestorePersistence();
  } finally {
    window.location.replace("/login");
  }
}

function getCachedStaff(): StaffUser | null {
  if (typeof window === "undefined") return null;

  try {
    const cached = sessionStorage.getItem(STAFF_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function setCachedStaff(staff: StaffUser) {
  if (typeof window === "undefined") return;

  try {
    sessionStorage.setItem(STAFF_CACHE_KEY, JSON.stringify(staff));
  } catch {
    // ignore
  }
}

function isSameStaff(a: StaffUser | null, b: StaffUser | null) {
  if (!a || !b) return false;

  return (
    a.uid === b.uid &&
    a.displayName === b.displayName &&
    a.email === b.email &&
    a.role === b.role &&
    a.active === b.active &&
    a.staffCode === b.staffCode
  );
}

type CurrentUserContextValue = {
  currentUser: StaffUser | null;
  authReady: boolean;
  firebaseReady: boolean;
  firebaseUser: User | null;
};

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [firebaseReady, setFirebaseReady] = useState(false);

  // 로그인 상태 추적 + 로그아웃(세션 종료)의 단일 권위 지점.
  useEffect(() => {
    if (isLoginPage) {
      // 로그인 페이지는 인증 게이팅이 없으므로 즉시 ready로 표시(1회성 초기화 — 의도된 패턴).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFirebaseReady(true);
      setAuthReady(true);
      return;
    }

    let alive = true;

    const unsubscribe = listenCurrentUser(async (user) => {
      if (!alive) return;

      setFirebaseUser(user);
      setFirebaseReady(true);

      if (!user) {
        setCurrentUser(null);
        setAuthReady(true);
        // 세션/업무 캐시 + Firestore 영속 캐시를 비우고 하드 리다이렉트(재진입 guard 적용).
        await runSecureLogout();
      }
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [isLoginPage]);

  // staff/{uid} 문서 실시간 리스너 — 최초 attach 1회 읽기, 이후로는 문서가
  // 실제로 바뀔 때만(관리자가 role/active 변경) 갱신된다. 폴링 없음.
  useEffect(() => {
    if (isLoginPage || !firebaseUser) return;

    const uid = firebaseUser.uid;

    // 즉시표시: 캐시가 있고 같은 uid면 리스너 응답 전에 먼저 그린다(기존 동작과 동일한 UX — 의도된 패턴).
    const cachedStaff = getCachedStaff();
    if (cachedStaff && cachedStaff.uid === uid && cachedStaff.active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentUser(cachedStaff);
      setAuthReady(true);
    }

    const unsubscribe = onSnapshot(
      doc(db, "staff", uid),
      (snap) => {
        const data = snap.data();

        if (!snap.exists() || data?.active !== true) {
          // 비활성/삭제된 직원 — 안전 로그아웃(캐시 정리 + signOut + 하드 redirect).
          setCurrentUser(null);
          setAuthReady(true);
          void runSecureLogout();
          return;
        }

        const staff: StaffUser = {
          uid,
          email: String(data.email || ""),
          displayName: String(data.displayName || ""),
          role: data.role || "staff",
          active: true,
          staffCode: data.staffCode || undefined,
        };

        setCachedStaff(staff);
        setCurrentUser((prev) => (isSameStaff(prev, staff) ? prev : staff));
        setAuthReady(true);
      },
      (error) => {
        // staff 문서 리스너 자체가 에러(권한 거부 등)를 받았다는 건 더 이상 안전하게
        // 세션을 유지할 근거가 없다는 뜻 — 다른 비활성화 경로와 동일하게 안전 로그아웃을 탄다
        // (캐시 정리는 runSecureLogout이 STAFF_CACHE_KEY 제거를 포함하므로 중복 호출 불필요).
        console.error("[staff listener error]", (error as Error)?.message ?? "");
        setCurrentUser(null);
        setAuthReady(true);
        void runSecureLogout();
      }
    );

    return () => unsubscribe();
  }, [firebaseUser, isLoginPage]);

  return (
    <CurrentUserContext.Provider value={{ currentUser, authReady, firebaseReady, firebaseUser }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUserContext(): CurrentUserContextValue {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) {
    // Provider 밖에서 호출 시 안전한 빈 값.
    return { currentUser: null, authReady: false, firebaseReady: false, firebaseUser: null };
  }
  return ctx;
}
