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
    <section className="rounded-[28px] bg-white p-5 shadow-[0_16px_50px_rgba(15,23,42,0.055)] lg:p-6">
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
            className="h-11 w-full rounded-[16px] border border-[#dbe7e3] bg-white px-3 text-sm outline-none transition focus:border-[#5bd5c8] focus:ring-2 focus:ring-[#dff7f3]"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500">새 비밀번호</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => onNewPasswordChange(e.target.value)}
            className="h-11 w-full rounded-[16px] border border-[#dbe7e3] bg-white px-3 text-sm outline-none transition focus:border-[#5bd5c8] focus:ring-2 focus:ring-[#dff7f3]"
          />
        </div>
      </div>

      <div className="mt-4 rounded-[22px] bg-[#f8fbfa] p-4 text-sm text-[#667085]">
        Firebase Auth 기준으로 재인증 후 비밀번호를 변경합니다. 새 비밀번호는 최소 6자 이상이어야 합니다.
      </div>

      <div className="mt-5 flex justify-end">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-5 py-3 text-sm font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition hover:-translate-y-0.5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "변경 중..." : "비밀번호 변경"}
        </button>
      </div>
    </section>
  );
}
