"use client";

import {
  DEFAULT_VISIT_STATUS_COLORS,
  VISIT_STATUS_LIST,
  type VisitStatus,
  type VisitStatusColorMap,
} from "@/lib/settings";
import { getReadableTextColor } from "@/lib/colorUtils";
import { isValidHex } from "@/lib/settingsUtils";
import { SectionHeader, EmptyBox } from "@/components/settings/ui";

const STATUS_HELP: Record<VisitStatus, string> = {
  내원전: "아직 방문 전인 예약",
  대기: "내원 후 대기 중인 고객",
  원상중: "원장 상담 진행 중",
  후상중: "실장/후상담 진행 중",
  귀가: "상담 또는 진료 종료",
  부도: "예약 후 미방문",
};

type Props = {
  colors: VisitStatusColorMap;
  loading: boolean;
  authLoading: boolean;
  canManage: boolean;
  saving: boolean;
  hasChanges: boolean;
  onUpdateColor: (status: VisitStatus, value: string) => void;
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
    <section className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
      <SectionHeader
        title="내원상태 색상 설정"
        description="타임라인 고객 카드, 예약관리 상태 배지, 대시보드 상태 표시 색상에 공통으로 사용할 기준 색상입니다."
        badge={authLoading ? "권한 확인 중" : canManage ? "수정 가능" : "보기 전용"}
        badgeActive={canManage}
      />

      {loading ? (
        <EmptyBox text="설정을 불러오는 중..." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {VISIT_STATUS_LIST.map((status) => {
              const color = colors[status];
              const valid = isValidHex(color);
              const previewColor = valid ? color : DEFAULT_VISIT_STATUS_COLORS[status];

              return (
                <div key={status} className="rounded-2xl border border-[#edf0f3] bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-gray-900">{status}</div>
                      <div className="mt-0.5 text-xs text-gray-400">{STATUS_HELP[status]}</div>
                    </div>

                    <div
                      className="flex h-10 min-w-[76px] items-center justify-center rounded-xl px-3 text-xs font-bold shadow-sm"
                      style={{ backgroundColor: previewColor, color: getReadableTextColor(previewColor) }}
                    >
                      {status}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={previewColor}
                      disabled={!canManage || saving}
                      onChange={(e) => onUpdateColor(status, e.target.value)}
                      className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-[#dfe3e8] bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50"
                    />

                    <input
                      value={color}
                      disabled={!canManage || saving}
                      onChange={(e) => onUpdateColor(status, e.target.value)}
                      className={`h-10 min-w-0 flex-1 rounded-xl border bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100 disabled:bg-gray-50 disabled:text-gray-400 ${valid ? "border-[#dfe3e8]" : "border-red-300"}`}
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

          <div className="mt-5 rounded-2xl border border-[#edf0f3] bg-gray-50 p-4">
            <div className="mb-3 text-sm font-bold text-gray-900">미리보기</div>
            <div className="flex flex-wrap gap-2">
              {VISIT_STATUS_LIST.map((status) => {
                const color = isValidHex(colors[status]) ? colors[status] : DEFAULT_VISIT_STATUS_COLORS[status];
                return (
                  <span
                    key={status}
                    className="rounded-full px-3 py-1.5 text-xs font-bold"
                    style={{ backgroundColor: color, color: getReadableTextColor(color) }}
                  >
                    {status}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              onClick={onReset}
              disabled={!canManage || saving}
              className="rounded-xl border border-[#dfe3e8] bg-white px-5 py-3 text-sm font-medium text-gray-700 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              기본값 복원
            </button>

            <button
              onClick={onSave}
              disabled={!canManage || saving || !hasChanges}
              className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "저장 중..." : "색상 저장"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
