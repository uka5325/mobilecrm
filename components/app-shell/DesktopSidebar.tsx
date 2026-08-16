"use client";

import Link from "next/link";
import UserMenu from "./UserMenu";

export type AppMenuItem = {
  href: string;
  label: string;
  match: string[];
  roles?: string[] | null;
};

type DesktopSidebarProps = {
  menuItems: AppMenuItem[];
  pathname: string;
  roleName?: string;
  displayName: string;
  avatarText: string;
  onLogout: () => void;
  isActive: (item: AppMenuItem) => boolean;
};

export default function DesktopSidebar({
  menuItems,
  roleName,
  displayName,
  avatarText,
  onLogout,
  isActive,
}: DesktopSidebarProps) {
  return (
    <aside className="hidden min-h-screen w-[272px] shrink-0 flex-col justify-between bg-[#061f24] px-5 py-6 lg:flex">
      <div>
        <div className="mb-7">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0f8f83] text-sm font-black text-white">
            CRM
          </div>
          <div className="mt-4 text-xl font-black tracking-[-0.03em] text-white">
            모바일 CRM
          </div>
          <p className="mt-1 text-xs leading-5 text-white/50">
            예약, 고객관리, 정산을 한곳에서 관리합니다.
          </p>
        </div>

        <UserMenu
          displayName={displayName}
          roleName={roleName}
          avatarText={avatarText}
          onLogout={onLogout}
        />

        <nav className="mt-7 space-y-1.5">
          {menuItems.map((item) => {
            const active = isActive(item);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm font-bold text-[#061f24] shadow-[0_18px_40px_rgba(0,0,0,0.18)]"
                    : "flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold text-white/62 transition hover:bg-white/8 hover:text-white"
                }
              >
                <span>{item.label}</span>
                <span className={active ? "h-2 w-2 rounded-full bg-[#0f8f83]" : "h-2 w-2 rounded-full bg-white/15"} />
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="rounded-2xl border border-white/10 px-4 py-3 text-[11px] leading-5 text-white/45">
        Firebase / Vercel
        <br />
        운영용 CRM v1.0
      </div>
    </aside>
  );
}
