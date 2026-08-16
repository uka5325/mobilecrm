"use client";

import type { StaffUser } from "@/lib/auth";

const ROLE_LIST = ["admin", "coordinator", "staff", "interpreter"];

type LoginAuthorityProps = {
  currentUser: StaffUser | null;
  displayName: string;
  onLogout: () => void;
};

export default function LoginAuthority({ currentUser, displayName, onLogout }: LoginAuthorityProps) {
  const activeRole = currentUser?.role || "";

  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)] lg:p-6">
      <div className="flex flex-nowrap items-center justify-between gap-4">
        <div>
          <h2 className="whitespace-nowrap text-xl font-black tracking-[-0.04em] text-[#12151f]">현재 로그인 권한</h2>
          <p className="mt-2 text-sm leading-6 text-[#7b8290]">{displayName}</p>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="shrink-0 whitespace-nowrap rounded-2xl border border-[#dfe3e8] px-4 py-2.5 text-sm font-bold text-[#0f8f83] transition hover:border-[#0f8f83] active:scale-95"
        >
          로그아웃
        </button>
      </div>

      <div className="mt-5 flex flex-nowrap gap-2 overflow-x-auto pb-1">
        {ROLE_LIST.map((role) => {
          const active = activeRole === role;

          return (
            <span
              key={role}
              className={
                active
                  ? "shrink-0 rounded-2xl bg-[#0f8f83] px-4 py-2 text-sm font-bold text-white"
                  : "shrink-0 rounded-2xl border border-[#dfe3e8] bg-[#f6f7f5] px-4 py-2 text-sm font-semibold text-[#7b8290]"
              }
            >
              {role}
            </span>
          );
        })}
      </div>
    </section>
  );
}
