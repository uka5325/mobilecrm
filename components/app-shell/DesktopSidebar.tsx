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
    <aside className="hidden min-h-screen w-[220px] shrink-0 flex-col justify-between bg-[rgb(6,44,49)] px-5 py-5 lg:flex">
      <div>
        <div className="mb-7">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#15a99b] text-sm font-black text-white">
            CRM
          </div>
          <div className="mt-4 text-base font-black tracking-[-0.03em] text-white">
            모바일 CRM
          </div>
          <p className="mt-1 text-xs leading-5 text-white/50">
            예약, 고객관리, 정산을
            <br />
            한곳에서 관리합니다.
          </p>
        </div>

        <nav className="space-y-1.5">
          {menuItems.map((item) => {
            const active = isActive(item);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "flex items-center rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-[#073238]"
                    : "flex items-center rounded-xl px-3 py-2.5 text-sm font-semibold text-white/72 transition hover:bg-white/8 hover:text-white"
                }
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <UserMenu
        displayName={displayName}
        roleName={roleName}
        avatarText={avatarText}
        onLogout={onLogout}
      />
    </aside>
  );
}
