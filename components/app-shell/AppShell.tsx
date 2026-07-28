"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/auth";
import { TodayMemosProvider } from "@/components/TodayMemosProvider";
import { PatientSummaryProvider } from "@/components/PatientSummaryProvider";
import { CurrentUserProvider, useCurrentUserContext } from "@/components/CurrentUserProvider";
import DesktopSidebar, { type AppMenuItem } from "./DesktopSidebar";
import MobileBottomNav from "./MobileBottomNav";
import MoreMenu from "./MoreMenu";

type AppShellProps = {
  children: ReactNode;
};

const desktopMenuItems: AppMenuItem[] = [
  { href: "/", label: "홈", match: ["/"] },
  { href: "/schedule", label: "스케줄", match: ["/schedule", "/timeline"] },
  { href: "/reservations", label: "고객관리", match: ["/reservations"] },
  { href: "/invoice", label: "인보이스", match: ["/invoice"], roles: ["admin", "coordinator"] },
  { href: "/commission", label: "커미션", match: ["/commission"], roles: ["admin", "coordinator"] },
  { href: "/dashboard", label: "대시보드", match: ["/dashboard"] },
  { href: "/settings", label: "설정", match: ["/settings"] },
];

const mobilePrimaryItems: AppMenuItem[] = [
  { href: "/", label: "홈", match: ["/"] },
  { href: "/schedule", label: "스케줄", match: ["/schedule", "/timeline"] },
  { href: "/reservations", label: "고객관리", match: ["/reservations"] },
];

const mobileMoreItems: AppMenuItem[] = [
  { href: "/invoice", label: "인보이스", match: ["/invoice"], roles: ["admin", "coordinator"] },
  { href: "/commission", label: "커미션", match: ["/commission"], roles: ["admin", "coordinator"] },
  { href: "/dashboard", label: "대시보드", match: ["/dashboard"] },
  { href: "/settings", label: "설정", match: ["/settings"] },
];

const pageInfo: Record<string, { title: string; description: string }> = {
  "/": {
    title: "홈",
    description: "오늘 필요한 운영 정보를 빠르게 확인합니다.",
  },
  "/schedule": {
    title: "스케줄",
    description: "일·주·월 단위로 확인합니다.",
  },
  "/timeline": {
    title: "스케줄",
    description: "예약 흐름과 고객 상세 정보를 확인합니다.",
  },
  "/reservations": {
    title: "고객관리",
    description: "환자별 예약, 기록, 결제 정보를 관리합니다.",
  },
  "/commission": {
    title: "커미션",
    description: "담당자별 커미션 기준 데이터를 확인합니다.",
  },
  "/invoice": {
    title: "인보이스",
    description: "인보이스 목록을 확인합니다.",
  },
  "/dashboard": {
    title: "대시보드",
    description: "운영 지표와 성과 흐름을 확인합니다.",
  },
  "/settings": {
    title: "설정",
    description: "직원, 권한, 유형별 색상과 운영 설정을 관리합니다.",
  },
};

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7f5]">
      <div className="text-center">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-[#d7ede7] border-t-[#0f8f83]" />
        <p className="text-sm text-[#7b8290]">로딩 중...</p>
      </div>
    </main>
  );
}

function filterByRole(items: AppMenuItem[], role?: string) {
  return items.filter((item) => !item.roles || (role ? item.roles.includes(role) : false));
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
  const [mounted, setMounted] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showHeaderFade, setShowHeaderFade] = useState(false);

  const isLoginPage = pathname === "/login";
  const loading = !authReady;
  const roleName = staffUser?.role || "";
  const displayName = staffUser?.displayName || firebaseUser?.email || "사용자";
  const avatarText = displayName.slice(0, 1).toUpperCase();

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

  const visibleDesktopItems = useMemo(() => filterByRole(desktopMenuItems, roleName), [roleName]);
  const visibleMobileMoreItems = useMemo(() => filterByRole(mobileMoreItems, roleName), [roleName]);

  useEffect(() => {
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

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    const updateHeaderFade = () => {
      setShowHeaderFade(window.scrollY > 12);
    };

    updateHeaderFade();
    window.addEventListener("scroll", updateHeaderFade, { passive: true });
    return () => window.removeEventListener("scroll", updateHeaderFade);
  }, [pathname]);

  async function handleLogout() {
    await logout();
  }

  function isActive(item: AppMenuItem) {
    if (item.href === "/") return pathname === "/";
    return item.match.some((path) => pathname.startsWith(path));
  }

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (!mounted || loading) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen bg-[#f6f7f5] text-[#12151f] lg:flex">
      {!isOnline && (
        <div className="fixed left-0 right-0 top-0 z-[60] bg-red-600 px-4 py-2 text-center text-sm text-white">
          오프라인 상태입니다. 인터넷 연결을 확인해주세요.
        </div>
      )}

      <DesktopSidebar
        menuItems={visibleDesktopItems}
        pathname={pathname}
        roleName={roleName}
        displayName={displayName}
        avatarText={avatarText}
        onLogout={handleLogout}
        isActive={isActive}
      />

      <main className="min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-[1320px]">
          <div className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[calc(env(safe-area-inset-top)+12px)] bg-[#f6f7f5] lg:left-[272px] lg:h-8" />

          <header
            className={
              "sticky top-[calc(env(safe-area-inset-top)+12px)] z-40 mb-5 rounded-[28px] bg-white px-5 py-4 shadow-[0_16px_50px_rgba(15,23,42,0.06)] lg:top-8 lg:mb-6 lg:px-7" +
              (showHeaderFade
                ? " after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-8 after:h-8 after:rounded-b-[28px] after:bg-gradient-to-b after:from-[#f6f7f5]/75 after:via-[#f6f7f5]/35 after:to-[#f6f7f5]/0 after:backdrop-blur-md after:content-['']"
                : "")
            }
          >
            <div className="text-xs font-black tracking-[0.18em] text-[#0f8f83]">MOBILE CRM</div>

            <div className="mt-2 flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="min-w-0 truncate text-[28px] font-black tracking-[-0.04em] text-[#12151f] lg:text-[34px]">
                  {currentPage.title}
                </h1>

                <p className="mt-2 text-sm leading-6 text-[#7b8290]">
                  {currentPage.description}
                </p>
              </div>

              <div className="flex min-w-0 shrink-0 flex-col items-end text-right">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] text-sm font-black text-white">
                  {avatarText}
                </div>

                <span className="mt-1 max-w-[128px] truncate text-sm font-black tracking-[-0.03em] text-[#12151f] sm:max-w-[220px]">
                  {displayName}
                </span>
                {roleName ? <span className="mt-0.5 shrink-0 text-xs font-semibold text-[#7b8290]">{roleName}</span> : null}
              </div>
            </div>
          </header>

          <PatientSummaryProvider>
            <TodayMemosProvider>{children}</TodayMemosProvider>
          </PatientSummaryProvider>
        </div>
      </main>

      <MoreMenu
        open={moreOpen}
        items={visibleMobileMoreItems}
        onClose={() => setMoreOpen(false)}
        onLogout={handleLogout}
        isActive={isActive}
      />

      <MobileBottomNav
        items={mobilePrimaryItems}
        moreOpen={moreOpen}
        onMoreClick={() => setMoreOpen((current) => !current)}
        isActive={isActive}
      />
    </div>
  );
}
