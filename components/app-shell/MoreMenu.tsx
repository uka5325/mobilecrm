"use client";

import Link from "next/link";
import type { AppMenuItem } from "./DesktopSidebar";

type MoreMenuProps = {
  open: boolean;
  items: AppMenuItem[];
  onClose: () => void;
  onLogout: () => Promise<void> | void;
  isActive: (item: AppMenuItem) => boolean;
};

export default function MoreMenu({ open, items, onClose, onLogout, isActive }: MoreMenuProps) {
  if (!open) return null;

  async function handleLogout() {
    onClose();
    await onLogout();
  }

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button
        type="button"
        aria-label="더보기 메뉴 닫기"
        className="absolute inset-0 bg-black/25"
        onClick={onClose}
      />

      <div className="absolute inset-x-3 bottom-[86px] rounded-[28px] bg-white p-4 shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
        <div className="mb-3 flex items-center justify-between px-1">
          <div>
            <div className="text-base font-black text-[#12151f]">더보기</div>
            <div className="mt-1 text-xs text-[#8b93a1]">추가 메뉴</div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-[#f1f3f5] px-3 py-1.5 text-xs font-bold text-[#6b7280]"
          >
            닫기
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {items.map((item) => {
            const active = isActive(item);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={
                  active
                    ? "rounded-2xl bg-[#0f8f83] px-4 py-4 text-sm font-bold text-white"
                    : "rounded-2xl bg-[#f6f7f5] px-4 py-4 text-sm font-bold text-[#242833]"
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="mt-3 h-11 w-full rounded-[18px] bg-[#e3f2ee] text-sm font-bold text-[#0f9b8e] transition hover:bg-[#d7ede7] active:scale-95"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
