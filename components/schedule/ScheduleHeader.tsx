"use client";

import { type AppointmentType, APPOINTMENT_TYPE_COLORS } from "@/lib/reservations";
import { todayString } from "@/lib/dateUtils";
import type { ConferenceMemo } from "@/lib/settings";
import { SCHEDULE_APPOINTMENT_TYPES } from "@/lib/scheduleLayout";
import type { ViewMode } from "@/hooks/useSchedulePage";

const VIEW_LABELS: Record<ViewMode, string> = {
  day: "일간",
  week: "주간",
  month: "월간",
};

type Props = {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  baseDate: string;
  onBaseDateChange: (date: string) => void;
  titleText: string;
  totalCount: number;
  kpi: Record<string, number>;
  loading: boolean;
  onNavigate: (dir: -1 | 1) => void;
  onToday: () => void;
  onNewReservation: () => void;
  todayMemos: ConferenceMemo[];
  memoSectionOpen: boolean;
  onToggleMemoSection: () => void;
};

export function ScheduleHeader({
  viewMode,
  onViewModeChange,
  baseDate,
  onBaseDateChange,
  titleText,
  totalCount,
  kpi,
  loading,
  onNavigate,
  onToday,
  onNewReservation,
  todayMemos,
  memoSectionOpen,
  onToggleMemoSection,
}: Props) {
  return (
    <>
      {/* 상단 컨트롤 — 연한 녹색 배너 */}
      <div className="shrink-0 border-b border-[#edf0f3] bg-[#ecfdf5]">
        {/* 1행: 네비게이션 */}
        <div className="flex items-center gap-2 px-4 pt-3">
          <button onClick={() => onNavigate(-1)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#dfe3e8] bg-white text-gray-500 hover:bg-gray-50">‹</button>
          <button onClick={onToday} className="h-10 shrink-0 rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm text-gray-600 hover:bg-gray-50">오늘</button>
          <button onClick={() => onNavigate(1)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#dfe3e8] bg-white text-gray-500 hover:bg-gray-50">›</button>
          <span className="truncate text-sm font-semibold text-gray-800">{titleText}</span>
        </div>
        {/* 2행: 뷰 전환 + 날짜 + 고객등록 */}
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="flex h-10 flex-1 overflow-hidden rounded-xl border border-[#dfe3e8]">
            {(["day", "week", "month"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => onViewModeChange(mode)}
                className={`h-10 flex-1 text-sm font-medium transition ${viewMode === mode ? "bg-[#1d9e75] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                {VIEW_LABELS[mode]}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={baseDate}
            onChange={(e) => onBaseDateChange(e.target.value)}
            className="h-10 shrink-0 appearance-none rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm text-gray-700 focus:border-[#1d9e75] focus:outline-none"
          />
          <button
            onClick={onNewReservation}
            className="h-10 shrink-0 rounded-xl bg-black px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
          >
            + 예약 추가
          </button>
        </div>

        {/* KPI 바 (가로 스크롤) */}
        <div className="flex items-center gap-3 overflow-x-auto px-4 pb-3 [&::-webkit-scrollbar]:hidden">
          <span className="shrink-0 text-xs text-gray-500">전체 {totalCount}건</span>
          {SCHEDULE_APPOINTMENT_TYPES.map((type: AppointmentType) => (
            <div key={type} className="flex shrink-0 items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: APPOINTMENT_TYPE_COLORS[type] }} />
              <span className="text-xs text-gray-600">{type} {kpi[type] || 0}</span>
            </div>
          ))}
          {loading && <span className="ml-auto shrink-0 animate-pulse text-xs text-gray-400">로딩 중...</span>}
        </div>
      </div>

      {/* 오늘의 메모 */}
      <div className="shrink-0 border-b border-[#edf0f3]">
        <button
          onClick={onToggleMemoSection}
          className="flex w-full items-center gap-2 px-5 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
        >
          <span className="font-semibold">📝 {baseDate === todayString() ? "오늘의 메모" : `${baseDate} 메모`}</span>
          {todayMemos.length > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{todayMemos.length}</span>
          )}
          <span className="ml-auto text-gray-300">{memoSectionOpen ? "▲" : "▼"}</span>
        </button>
        {memoSectionOpen && (
          <div className="flex gap-2 overflow-x-auto px-5 pb-2">
            {todayMemos.length === 0 ? (
              <span className="text-xs text-gray-400">오늘 등록된 메모가 없습니다.</span>
            ) : (
              todayMemos.map((memo) => (
                <div key={memo.id} className="min-w-[180px] max-w-[280px] shrink-0 rounded-lg bg-amber-50 px-3 py-1.5 text-xs">
                  <div className="font-medium text-gray-800 line-clamp-2">{memo.memoText}</div>
                  <div className="mt-0.5 text-[10px] text-gray-400">{memo.createdByName || memo.createdBy}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}
