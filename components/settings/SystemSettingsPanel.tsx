"use client";

import {
  COUNTRY_TIMEZONES,
  type CountryKey,
  type GeneralSettings,
} from "@/lib/settings";
import { SectionHeader } from "@/components/settings/ui";

type Props = {
  generalSettings: GeneralSettings;
  selectedCountry: CountryKey;
  canManage: boolean;
  saving: boolean;
  onChangeCountry: (country: CountryKey) => void;
  onSave: () => void;
};

export function SystemSettingsPanel({ generalSettings, selectedCountry, canManage, saving, onChangeCountry, onSave }: Props) {
  return (
    <section className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
      <SectionHeader
        title="기본 설정"
        description="상담회 국가와 로그 시간대를 설정합니다. 예약 시간은 변환하지 않고, 로그/표시 기준 시간대만 관리합니다."
        badge={canManage ? "수정 가능" : "보기 전용"}
        badgeActive={canManage}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-gray-500">상담회 국가</label>
          <select
            value={selectedCountry}
            disabled={!canManage || saving}
            onChange={(e) => onChangeCountry(e.target.value as CountryKey)}
            className="h-11 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100 disabled:bg-gray-50 disabled:text-gray-400"
          >
            {Object.entries(COUNTRY_TIMEZONES).map(([key, country]) => (
              <option key={key} value={key}>{country.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500">현재 로그 시간대</label>
          <input
            value={COUNTRY_TIMEZONES[selectedCountry].timezone}
            readOnly
            className="h-11 w-full rounded-xl border border-[#dfe3e8] bg-gray-50 px-3 text-sm text-gray-500 outline-none"
          />
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-[#edf0f3] bg-gray-50 p-4 text-sm text-gray-500">
        현재 저장값: {generalSettings.appCountryLabel} / {generalSettings.appTimezone}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          onClick={onSave}
          disabled={!canManage || saving}
          className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "저장 중..." : "기본 설정 저장"}
        </button>
      </div>
    </section>
  );
}
