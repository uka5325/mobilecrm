"use client";

type UserMenuProps = {
  displayName: string;
  roleName?: string;
  avatarText: string;
  onLogout: () => void;
  compact?: boolean;
};

export default function UserMenu({
  displayName,
  roleName,
  avatarText,
  onLogout,
  compact = false,
}: UserMenuProps) {
  return (
    <div className={compact ? "flex items-center gap-2" : "rounded-2xl bg-white/8 p-3"}>
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0f8f83] text-sm font-bold text-white">
          {avatarText}
        </div>

        <div className="min-w-0 flex-1">
          <div className={compact ? "truncate text-sm font-bold text-[#12151f]" : "truncate text-sm font-bold text-white"}>
            {displayName}
          </div>
          {roleName ? (
            <div className={compact ? "truncate text-xs text-[#7b8290]" : "truncate text-xs text-white/55"}>
              {roleName}
            </div>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onLogout}
        className={
          compact
            ? "shrink-0 rounded-full border border-[#dfe3e8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4b5563] transition hover:border-[#0f8f83] hover:text-[#0f8f83] active:scale-95"
            : "mt-3 w-full rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white active:scale-95"
        }
      >
        로그아웃
      </button>
    </div>
  );
}
