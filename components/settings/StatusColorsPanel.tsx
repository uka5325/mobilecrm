"use client";

import {
  DEFAULT_APPOINTMENT_TYPE_COLORS,
  type AppointmentTypeColorMap,
} from "@/features/settings/data/client/settings";
import { getReadableTextColor } from "@/lib/colorUtils";
import { isValidHex } from "@/features/settings/data/client/settingsUtils";
import { SectionHeader, EmptyBox } from "@/components/settings/ui";

const TYPE_KEYS = ["상담", "수술", "시술", "치료", "경과", "진료", "검진"] as const;
type ApptType = typeof TYPE_KEYS[number];

const TYPE_HELP: Record<ApptType, string> = {
  상담: "상담 예약 카드 색상",
  수술: "수술 예약 카드 색상",
  시술: "시술 예약 카드 색상",
  치료: "치료 예약 카드 색상",
  경과: "경과 관찰 예약 카드 색상",
  진료: "진료 예약 카드 색상",
  검진: "검진 예약 카드 색상",
};

type Props = {
  colors: AppointmentTypeColorMap;
  loading: boolean;
  authLoading: boolean;
  canManage: boolean;
  saving: boolean;
  hasChanges: boolean;
  onUpdateColor: (type: string, value: string) => void;
  onSave: () => void;
  onReset: () => void;
};

export function StatusColorsPanel({
  colors,
  loading,
  authLoading,
  canManage,
  saving,
  hasChanges,
  onUpdateColor,
  onSave,
  onReset,
}: Props) {
  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_16px_50px_rgba(15,23,42,0.055)] lg:p-6">
      <SectionHeader
        title="유형별 색상 설정"
        description="스케줄 및 예약관리 카드에 표시되는 예약 유형별 색상을 설정합니다."
        badge={authLoading ? "권한 확인 중" : canManage ? "수정 가능" : "보기 전용"}
        badgeActive={canManage}
      />

      {loading ? (
        <EmptyBox text="설정을 불러오는 중..." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {TYPE_KEYS.map((type) => {
              const color = colors[type];
              const valid = isValidHex(color);
              const previewColor = valid ? color : DEFAULT_APPOINTMENT_TYPE_COLORS[type];

              return (
                <div key={type} className="rounded-[22px] bg-[#f8fbfa] p-4 shadow-[0_10px_24px_rgba(15,23,42,0.035)]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-gray-900">{type}</div>
                      <div className="mt-0.5 text-xs text-gray-400">{TYPE_HELP[type]}</div>
                    </div>

                    <div
                      className="flex h-10 min-w-[76px] items-center justify-center rounded-xl px-3 text-xs font-bold shadow-sm"
                      style={{ backgroundColor: previewColor, color: getReadableTextColor(previewColor) }}
                    >
                      {type}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={previewColor}
                      disabled={!canManage || saving}
                      onChange={(e) => onUpdateColor(type, e.target.value)}
                      className="h-10 w-12 shrink-0 cursor-pointer rounded-[14px] border border-[#dbe7e3] bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50"
                    />

                    <input
                      value={color}
                      disabled={!canManage || saving}
                      onChange={(e) => onUpdateColor(type, e.target.value)}
                      className={`h-10 min-w-0 flex-1 rounded-xl border bg-white px-3 text-sm outline-none transition focus:border-[#5bd5c8] focus:ring-2 focus:ring-[#dff7f3] disabled:bg-gray-50 disabled:text-gray-400 ${valid ? "border-[#dfe3e8]" : "border-red-300"}`}
                      placeholder="#1d9e75"
                    />
                  </div>

                  {!valid && (
                    <div className="mt-2 text-xs text-red-500">HEX 색상값을 입력해주세요. 예: #1d9e75</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-[22px] bg-[#f8fbfa] p-4">
            <div className="mb-3 text-sm font-bold text-gray-900">미리보기</div>
            <div className="flex flex-wrap gap-2">
              {TYPE_KEYS.map((type) => {
                const color = isValidHex(colors[type]) ? colors[type] : DEFAULT_APPOINTMENT_TYPE_COLORS[type];
                return (
                  <span
                    key={type}
                    className="rounded-full px-3 py-1.5 text-xs font-bold"
                    style={{ backgroundColor: color, color: getReadableTextColor(color) }}
                  >
                    {type}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              onClick={onReset}
              disabled={!canManage || saving}
              className="rounded-[16px] border border-[#dbe7e3] bg-white px-5 py-3 text-sm font-medium text-gray-700 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              기본값 복원
            </button>

            <button
              onClick={onSave}
              disabled={!canManage || saving || !hasChanges}
              className="rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-5 py-3 text-sm font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition hover:-translate-y-0.5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "저장 중..." : "색상 저장"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
