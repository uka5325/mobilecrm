"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { logout } from "@/lib/auth";
import { ReservationsProvider } from "@/components/ReservationsProvider";
import { TodayMemosProvider } from "@/components/TodayMemosProvider";
import { CurrentUserProvider, useCurrentUserContext } from "@/components/CurrentUserProvider";

type AppShellProps = {
  children: ReactNode;
};

const allMenuItems = [
  { href: "/", label: "홈", icon: "🏠", roles: null },
  { href: "/schedule", label: "스케줄", icon: "📅", roles: null },
  { href: "/reservations", label: "고객관리", icon: "👥", roles: null },
  { href: "/dashboard", label: "KPI 대시보드", icon: "📊", roles: null },
  { href: "/invoice", label: "인보이스", icon: "🧾", roles: null },
  { href: "/commission", label: "커미션", icon: "💰", roles: ["admin", "coordinator"] },
  { href: "/settings", label: "설정", icon: "⚙️", roles: null },
];

const pageInfo: Record<string, { title: string; description: string }> = {
  "/": {
    title: "홈",
    description: "오늘의 운영 현황을 확인하고 필요한 메뉴로 이동하세요",
  },
  "/schedule": {
    title: "스케줄",
    description: "상담·수술·치료·경과 일정을 일·주·월 단위로 확인합니다.",
  },
  "/timeline": {
    title: "스케줄",
    description: "상담·수술·치료·경과 일정을 확인합니다.",
  },
  "/reservations": {
    title: "고객관리",
    description: "환자별 예약 목록을 관리합니다.",
  },
  "/dashboard": {
    title: "KPI 대시보드",
    description: "병원별·유형별 주요 지표를 확인합니다.",
  },
  "/invoice": {
    title: "인보이스",
    description: "인보이스 목록을 조회하고 관리합니다.",
  },
  "/commission": {
    title: "커미션",
    description: "담당자별 커미션을 조회하고 정산합니다.",
  },
  "/settings": {
    title: "설정",
    description: "직원, 권한, 운영 설정을 관리합니다.",
  },
};

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white">
      <div className="text-center">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-[#cfeee4] border-t-[#1d9e75]" />
        <p className="text-sm text-gray-500">로딩 중...</p>
      </div>
    </main>
  );
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <CurrentUserProvider>
      <AppShellContent>{children}</AppShellContent>
    </CurrentUserProvider>
  );
}

function AppShellContent({ children }: AppShellProps) {
  const pathname = usePathname();
  const { currentUser: staffUser, authReady, firebaseUser } = useCurrentUserContext();
  const loading = !authReady;

  const isLoginPage = pathname === "/login";
  const isTimelinePage = pathname.startsWith("/timeline") || pathname.startsWith("/schedule") || pathname.startsWith("/reservations") || pathname.startsWith("/dashboard") || pathname.startsWith("/invoice") || pathname.startsWith("/commission");

  const [mounted, setMounted] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  const currentPage = useMemo(() => {
    if (pathname === "/") return pageInfo["/"];

    const matched = Object.keys(pageInfo)
      .filter((path) => path !== "/")
      .find((path) => pathname.startsWith(path));

    return matched
      ? pageInfo[matched]
      : {
          title: "모바일 CRM",
          description: "상담회 운영 시스템",
        };
  }, [pathname]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ssr:false 컴포넌트의 최초 마운트 감지는 effect 없이 알 수 없음
    setMounted(true);
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function handleLogout() {
    // signOut → CurrentUserProvider의 auth-state 리스너(단일 권위 지점)가
    // 캐시 purge + 하드 리로드(/login)를 수행.
    await logout();
  }

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (!mounted || loading) {
    return <LoadingScreen />;
  }

  const displayName = staffUser?.displayName || firebaseUser?.email || "사용자";
  const roleName = staffUser?.role || "";
  const avatarText = displayName.slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-white lg:flex">
      {!isOnline && (
        <div className="fixed left-0 right-0 top-0 z-50 bg-red-600 px-4 py-2 text-center text-sm text-white">
          오프라인 상태입니다. 인터넷 연결을 확인해주세요.
        </div>
      )}
      <aside className="hidden w-[260px] shrink-0 flex-col justify-between bg-[#0f1923] px-6 py-8 lg:flex">
        <div>
          <div className="mb-4 flex h-[38px] w-[38px] items-center justify-center rounded-lg bg-[#1d9e75] text-xl text-white">
            🏥
          </div>

          <div className="text-base font-semibold text-white">모바일 CRM</div>

          <div className="mt-1 text-xs leading-relaxed text-[#9aa7b5]">
            예약관리 시스템
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#182430] px-3 py-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1d9e75] text-xs font-bold text-white">
              {avatarText}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-white">{displayName}</div>
              {roleName && <div className="truncate text-[10px] text-[#9aa7b5]">{roleName}</div>}
            </div>
            <button
              onClick={handleLogout}
              className="shrink-0 rounded-md px-2 py-1 text-[11px] text-[#9aa7b5] transition hover:bg-[#0f1923] hover:text-white active:scale-95"
            >
              로그아웃
            </button>
          </div>

          <nav className="mt-5 flex flex-col gap-[7px]">
            {allMenuItems.filter((item) => !item.roles || (staffUser && item.roles.includes(staffUser.role))).map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs transition-all duration-150 hover:-translate-y-[1px] active:scale-[0.97]"
                  style={{
                    backgroundColor: active ? "#123f39" : "#182430",
                    color: active ? "#ffffff" : "#c3ccd6",
                    border: active
                      ? "1px solid rgba(255,255,255,0.75)"
                      : "1px solid transparent",
                    boxShadow: active
                      ? "0 2px 10px rgba(0,0,0,0.12)"
                      : "none",
                  }}
                >
                  <span
                    className="w-[18px] text-center text-[15px]"
                    style={{
                      color: active ? "#ffffff" : "#c3ccd6",
                      opacity: 1,
                    }}
                  >
                    {item.icon}
                  </span>

                  <span
                    className="font-medium"
                    style={{
                      color: active ? "#ffffff" : "#c3ccd6",
                      opacity: 1,
                    }}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="text-[11px] text-[#52606d]">
          v1.0 · Firebase / Vercel
        </div>
      </aside>

      <header className="bg-[#0f1923] px-5 py-5 lg:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#1d9e75] text-xl text-white">
              🏥
            </div>

            <div>
              <div className="text-xl font-semibold text-white">모바일 CRM</div>
              <div className="text-xs text-[#9aa7b5]">예약관리 시스템</div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1d9e75] text-xs font-bold text-white">
              {avatarText}
            </div>
            <div className="hidden sm:block">
              <div className="text-xs font-medium text-white">{displayName}</div>
              {roleName && <div className="text-[10px] text-[#9aa7b5]">{roleName}</div>}
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-[#ffffff30] px-2.5 py-1.5 text-xs text-[#c3ccd6] transition hover:bg-[#1d9e75] hover:text-white active:scale-95"
            >
              로그아웃
            </button>
          </div>
        </div>

        <nav className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {allMenuItems.filter((item) => !item.roles || (staffUser && item.roles.includes(staffUser.role))).map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex shrink-0 items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-all duration-150 hover:-translate-y-[1px] active:scale-[0.96]"
                style={{
                  backgroundColor: active ? "#123f39" : "#182430",
                  color: active ? "#ffffff" : "#c3ccd6",
                  border: active
                    ? "1px solid rgba(255,255,255,0.75)"
                    : "1px solid transparent",
                  boxShadow: active ? "0 2px 10px rgba(0,0,0,0.12)" : "none",
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>

      <main
        className={`min-w-0 flex-1 bg-white ${
          isTimelinePage ? "p-6 lg:p-8" : "p-6 lg:p-8"
        }`}
      >
        <div className={isTimelinePage ? "mb-5" : "mb-6"}>
          <h1 className="text-[26px] font-bold leading-tight text-[#1a1a1a]">
            {currentPage.title}
          </h1>
          <p className="mt-2 text-sm leading-5 text-[#6b7280]">
            {currentPage.description}
          </p>
        </div>

        {/* 전역 단일 예약/메모 구독: AppShell이 라우트 전환에도 유지되므로 구독도 1회만 살아 있다. */}
        <ReservationsProvider>
          <TodayMemosProvider>{children}</TodayMemosProvider>
        </ReservationsProvider>
      </main>
    </div>
  );
}
