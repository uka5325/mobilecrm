"use client";

import { type AppointmentType, APPOINTMENT_TYPE_COLORS } from "@/features/reservations/domain/reservationModels";
import type { ConferenceMemo } from "@/features/settings/data/client/settings";
import { SCHEDULE_APPOINTMENT_TYPES } from "@/features/reservations/ui/scheduleLayout";
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
  dayDisplayMode: "time" | "hospital";
  onDayDisplayModeChange: (mode: "time" | "hospital") => void;
  weekDisplayMode: "table" | "list";
  onWeekDisplayModeChange: (mode: "table" | "list") => void;
  monthDisplayMode: "table" | "list";
  onMonthDisplayModeChange: (mode: "table" | "list") => void;
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
  onNewReservation,
  dayDisplayMode,
  onDayDisplayModeChange,
  weekDisplayMode,
  onWeekDisplayModeChange,
  monthDisplayMode,
  onMonthDisplayModeChange,
  todayMemos,
  memoSectionOpen,
  onToggleMemoSection,
}: Props) {
  const firstModeActive =
    viewMode === "day"
      ? dayDisplayMode === "time"
      : viewMode === "week"
        ? weekDisplayMode === "table"
        : monthDisplayMode === "table";
  const secondModeActive =
    viewMode === "day"
      ? dayDisplayMode === "hospital"
      : viewMode === "week"
        ? weekDisplayMode === "list"
        : monthDisplayMode === "list";
  const firstModeLabel =
    viewMode === "day" ? "시간별 보기" : viewMode === "week" ? "주간표" : "월간표";
  const secondModeLabel =
    viewMode === "day" ? "병원별 보기" : "리스트";

  function selectFirstMode() {
    if (viewMode === "day") onDayDisplayModeChange("time");
    else if (viewMode === "week") onWeekDisplayModeChange("table");
    else onMonthDisplayModeChange("table");
  }

  function selectSecondMode() {
    if (viewMode === "day") onDayDisplayModeChange("hospital");
    else if (viewMode === "week") onWeekDisplayModeChange("list");
    else onMonthDisplayModeChange("list");
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-[26px] bg-[#eaf8f3] px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)] lg:px-4 lg:py-4">
        <div className="rounded-[20px] bg-white p-1">
          <div className="grid grid-cols-3 gap-1">
            {(["day", "week", "month"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onViewModeChange(mode)}
                className={
                  viewMode === mode
                    ? "h-8 rounded-[16px] bg-[#e3f2ee] text-[11px] font-semibold text-[#0f9b8e]"
                    : "h-8 rounded-[16px] text-[11px] font-semibold text-[#667085] transition hover:bg-[#f6f7f5]"
                }
              >
                {VIEW_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-[30px_minmax(0,1fr)_30px] items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate(-1)}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[12px] bg-white text-lg font-bold text-[#101828] transition active:scale-95"
          >
            ‹
          </button>
          <label className="relative flex min-w-0 cursor-pointer items-center justify-center overflow-hidden rounded-[16px] px-2 py-1 text-center text-base font-bold tracking-[-0.04em] text-[#101828] active:scale-[0.99] lg:text-lg">
            <span className="truncate">{titleText}</span>
            <input
              type="date"
              value={baseDate}
              onChange={(e) => onBaseDateChange(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="날짜 선택"
            />
          </label>
          <button
            type="button"
            onClick={() => onNavigate(1)}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[12px] bg-white text-lg font-bold text-[#101828] transition active:scale-95"
          >
            ›
          </button>
        </div>

        <div className="mt-2 rounded-[20px] bg-white p-1">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
            <button
              type="button"
              onClick={selectFirstMode}
              className={
                firstModeActive
                  ? "h-8 rounded-[16px] bg-[#e3f2ee] px-3 text-[11px] font-semibold text-[#0f9b8e]"
                  : "h-8 rounded-[16px] px-3 text-[11px] font-semibold text-[#667085] transition hover:bg-[#f6f7f5]"
              }
            >
              {firstModeLabel}
            </button>
            <button
              type="button"
              onClick={selectSecondMode}
              className={
                secondModeActive
                  ? "h-8 rounded-[16px] bg-[#e3f2ee] px-3 text-[11px] font-semibold text-[#0f9b8e]"
                  : "h-8 rounded-[16px] px-3 text-[11px] font-semibold text-[#667085] transition hover:bg-[#f6f7f5]"
              }
            >
              {secondModeLabel}
            </button>
            <button
              type="button"
              onClick={onNewReservation}
              className="h-8 whitespace-nowrap rounded-[16px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-3 text-[11px] font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.18)] transition active:scale-95"
            >
              + 새 예약
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2.5 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SCHEDULE_APPOINTMENT_TYPES.map((type: AppointmentType) => (
            <div key={type} className="flex shrink-0 items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: APPOINTMENT_TYPE_COLORS[type] }} />
              <span className="text-[11px] font-normal text-[#344054]">{type}</span>
              <span className="text-[11px] font-normal text-[#667085]">{kpi[type] || 0}</span>
            </div>
          ))}
          <span className="shrink-0 text-[11px] font-normal text-[#8b93a1]">전체 {totalCount}건</span>
          {loading ? <span className="shrink-0 animate-pulse text-[11px] font-normal text-[#8b93a1]">로딩 중...</span> : null}
        </div>
      </section>

      <section className="rounded-[24px] bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.045)]">
        <button
          type="button"
          onClick={onToggleMemoSection}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="text-sm font-semibold text-[#101828]">오늘의 메모</span>
          <span className="text-[11px] font-semibold text-[#667085]">{memoSectionOpen ? "⌃" : "⌄"}</span>
        </button>

        {memoSectionOpen ? (
          <div className="mt-1.5">
            {todayMemos.length === 0 ? (
              <p className="text-xs font-normal text-[#667085]">오늘 등록된 메모가 없습니다.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {todayMemos.map((memo) => (
                  <div key={memo.id} className="min-w-[180px] max-w-[260px] shrink-0 rounded-[18px] bg-[#f7faf8] px-3 py-2 text-xs">
                    <div className="line-clamp-2 font-normal text-[#344054]">{memo.memoText}</div>
                    <div className="mt-1 text-[10px] font-normal text-[#8b93a1]">{memo.createdByName || memo.createdBy}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
