"use client";

import { useState } from "react";
import type { SettingsStaffRole } from "@/lib/settings";

const ROLES: { value: SettingsStaffRole; label: string }[] = [
  { value: "admin", label: "관리자 (Admin)" },
  { value: "coordinator", label: "코디네이터" },
  { value: "staff", label: "스탭" },
  { value: "interpreter", label: "통역사" },
];

type Props = {
  onClose: () => void;
  onSubmit: (params: {
    email: string;
    password: string;
    displayName: string;
    role: SettingsStaffRole;
    staffCode?: string;
  }) => Promise<void>;
};

export function AddStaffModal({ onClose, onSubmit }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<SettingsStaffRole>("staff");
  const [staffCode, setStaffCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!displayName.trim()) return setError("이름을 입력하세요.");
    if (!email.trim()) return setError("이메일을 입력하세요.");
    if (password.length < 6) return setError("비밀번호는 6자 이상이어야 합니다.");

    setSaving(true);
    try {
      await onSubmit({ email: email.trim(), password, displayName: displayName.trim(), role, staffCode: staffCode.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "직원 생성에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#edf0f3] px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800">직원 추가</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">이름 *</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="홍길동"
              className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-emerald-500 focus:outline-none disabled:bg-gray-50"
              disabled={saving}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">이메일 *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@example.com"
              className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-emerald-500 focus:outline-none disabled:bg-gray-50"
              disabled={saving}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">초기 비밀번호 * (최소 6자)</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 pr-10 text-sm transition focus:border-emerald-500 focus:outline-none disabled:bg-gray-50"
                disabled={saving}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
              >
                {showPassword ? "숨김" : "표시"}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">역할 *</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as SettingsStaffRole)}
              className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-emerald-500 focus:outline-none disabled:bg-gray-50"
              disabled={saving}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">직원코드 (선택)</label>
            <input
              type="text"
              value={staffCode}
              onChange={(e) => setStaffCode(e.target.value)}
              placeholder="내부 관리 코드"
              className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-emerald-500 focus:outline-none disabled:bg-gray-50"
              disabled={saving}
            />
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-xl border border-[#dfe3e8] py-2 text-sm font-medium text-gray-600 transition hover:-translate-y-0.5 hover:shadow-sm active:scale-95 disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
            >
              {saving ? "추가 중..." : "직원 추가"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
