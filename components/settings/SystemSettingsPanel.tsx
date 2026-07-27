"use client";

import {
  COUNTRY_TIMEZONES,
  type CountryKey,
  type GeneralSettings,
} from "@/features/settings/data/client/settings";
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
    <section className="rounded-[28px] bg-white p-5 shadow-[0_16px_50px_rgba(15,23,42,0.055)] lg:p-6">
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
            className="h-11 w-full rounded-[16px] border border-[#dbe7e3] bg-white px-3 text-sm outline-none transition focus:border-[#5bd5c8] focus:ring-2 focus:ring-[#dff7f3] disabled:bg-gray-50 disabled:text-gray-400"
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
            className="h-11 w-full rounded-[16px] border border-[#dbe7e3] bg-gray-50 px-3 text-sm text-gray-500 outline-none"
          />
        </div>
      </div>

      <div className="mt-4 rounded-[22px] bg-[#f8fbfa] p-4 text-sm text-[#667085]">
        현재 저장값: {generalSettings.appCountryLabel} / {generalSettings.appTimezone}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          onClick={onSave}
          disabled={!canManage || saving}
          className="rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-5 py-3 text-sm font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition hover:-translate-y-0.5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "저장 중..." : "기본 설정 저장"}
        </button>
      </div>
    </section>
  );
}
