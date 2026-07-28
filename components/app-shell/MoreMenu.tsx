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
        className="absolute inset-0 bg-[#101828]/25"
        onClick={onClose}
      />

      <div className="absolute inset-x-3 bottom-[86px] rounded-[32px] bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-base font-black text-[#12151f]">더보기</div>
            <div className="mt-1 text-xs text-[#8b93a1]">추가 메뉴</div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-full bg-[#f8fbfa] px-4 text-xs font-bold text-[#667085] transition hover:bg-[#e3f2ee] active:scale-95"
          >
            닫기
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => {
            const active = isActive(item);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={
                  active
                    ? "rounded-[24px] bg-[#0f9b8e] px-5 py-4 text-sm font-black text-white shadow-[0_10px_24px_rgba(15,155,142,0.18)] transition active:scale-95"
                    : "rounded-[24px] bg-[#f8fbfa] px-5 py-4 text-sm font-black text-[#12151f] transition hover:bg-[#e3f2ee] active:scale-95"
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
          className="mt-4 h-12 w-full rounded-[24px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_52%,#0f9b8e_100%)] text-sm font-black text-white shadow-[0_12px_28px_rgba(15,155,142,0.22)] transition hover:brightness-[1.02] active:scale-95"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
