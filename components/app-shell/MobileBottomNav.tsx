"use client";

import Link from "next/link";
import type { AppMenuItem } from "./DesktopSidebar";

type MobileBottomNavProps = {
  items: AppMenuItem[];
  moreOpen: boolean;
  onMoreClick: () => void;
  isActive: (item: AppMenuItem) => boolean;
};

export default function MobileBottomNav({
  items,
  moreOpen,
  onMoreClick,
  isActive,
}: MobileBottomNavProps) {
  return (
    <nav className="fixed inset-x-4 bottom-4 z-50 rounded-[22px] bg-white p-1 shadow-[0_10px_24px_rgba(15,23,42,0.12)] lg:hidden">
      <div className="grid grid-cols-4 gap-1">
        {items.map((item) => {
          const active = isActive(item);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                active
                  ? "flex h-9 items-center justify-center rounded-[18px] bg-[#e3f2ee] px-2 text-center text-xs font-semibold text-[#0f9b8e]"
                  : "flex h-9 items-center justify-center rounded-[18px] px-2 text-center text-xs font-semibold text-[#667085] transition active:scale-95"
              }
            >
              {item.label}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onMoreClick}
          className={
            moreOpen
              ? "flex h-9 items-center justify-center rounded-[18px] bg-[#e3f2ee] px-2 text-center text-xs font-semibold text-[#0f9b8e]"
              : "flex h-9 items-center justify-center rounded-[18px] px-2 text-center text-xs font-semibold text-[#667085] transition active:scale-95"
          }
        >
          더보기
        </button>
      </div>
    </nav>
  );
}
