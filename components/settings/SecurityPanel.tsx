"use client";

import { SectionHeader } from "@/components/settings/ui";

type Props = {
  currentPassword: string;
  newPassword: string;
  saving: boolean;
  onCurrentPasswordChange: (v: string) => void;
  onNewPasswordChange: (v: string) => void;
  onSave: () => void;
};

export function SecurityPanel({ currentPassword, newPassword, saving, onCurrentPasswordChange, onNewPasswordChange, onSave }: Props) {
  return (
    <section className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
      <SectionHeader
        title="보안"
        description="현재 로그인 계정의 비밀번호를 변경합니다."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-gray-500">현재 비밀번호</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => onCurrentPasswordChange(e.target.value)}
            className="h-11 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500">새 비밀번호</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => onNewPasswordChange(e.target.value)}
            className="h-11 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          />
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-[#edf0f3] bg-gray-50 p-4 text-sm text-gray-500">
        Firebase Auth 기준으로 재인증 후 비밀번호를 변경합니다. 새 비밀번호는 최소 6자 이상이어야 합니다.
      </div>

      <div className="mt-5 flex justify-end">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "변경 중..." : "비밀번호 변경"}
        </button>
      </div>
    </section>
  );
}
