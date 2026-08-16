"use client";

import { useState } from "react";
import { DetailDrawer } from "@/components/timeline/DetailDrawer";
import { NewReservationDrawer } from "@/components/timeline/NewReservationDrawer";
import { ScheduleHeader } from "@/components/schedule/ScheduleHeader";
import { DayScheduleView } from "@/components/schedule/DayScheduleView";
import { WeekScheduleView } from "@/components/schedule/WeekScheduleView";
import { MonthScheduleView } from "@/components/schedule/MonthScheduleView";
import { useSchedulePage } from "@/hooks/useSchedulePage";

export default function SchedulePage() {
  const [dayDisplayMode, setDayDisplayMode] = useState<"time" | "hospital">("time");
  const [weekDisplayMode, setWeekDisplayMode] = useState<"table" | "list">("table");
  const [monthDisplayMode, setMonthDisplayMode] = useState<"table" | "list">("table");
  const schedule = useSchedulePage();
  const {
    currentUser,
    viewMode,
    baseDate,
    reservations,
    detailOpen,
    selectedReservation,
    newOpen,
  } = schedule;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-170px)] max-w-[980px] flex-col gap-6 pb-6">
      <ScheduleHeader
        viewMode={viewMode}
        onViewModeChange={schedule.setViewMode}
        baseDate={baseDate}
        onBaseDateChange={schedule.setBaseDate}
        titleText={schedule.titleText}
        totalCount={reservations.length}
        kpi={schedule.kpi}
        loading={schedule.loading}
        onNavigate={schedule.navigate}
        onToday={schedule.goToday}
        onNewReservation={schedule.openNew}
        dayDisplayMode={dayDisplayMode}
        onDayDisplayModeChange={setDayDisplayMode}
        weekDisplayMode={weekDisplayMode}
        onWeekDisplayModeChange={setWeekDisplayMode}
        monthDisplayMode={monthDisplayMode}
        onMonthDisplayModeChange={setMonthDisplayMode}
        todayMemos={schedule.todayMemos}
        memoSectionOpen={schedule.memoSectionOpen}
        onToggleMemoSection={schedule.toggleMemoSection}
      />

      {/* 뷰 */}
      {viewMode === "day" && (
        <DayScheduleView
          dateStr={baseDate}
          reservations={reservations}
          displayMode={dayDisplayMode}
          onCardClick={schedule.openDetail}
        />
      )}
      {viewMode === "week" && (
        <WeekScheduleView
          weekStart={schedule.weekStart}
          reservations={reservations}
          displayMode={weekDisplayMode}
          onCardClick={schedule.openDetail}
        />
      )}
      {viewMode === "month" && (
        <MonthScheduleView
          monthStart={schedule.monthStart}
          reservations={reservations}
          displayMode={monthDisplayMode}
          onDayClick={schedule.handleDayClick}
          onCardClick={schedule.openDetail}
        />
      )}

      {currentUser && (
        <DetailDrawer
          open={detailOpen}
          reservation={selectedReservation}
          currentUser={currentUser}
          onClose={schedule.closeDetail}
          onRefreshLatestLog={async () => {}}
          onRefresh={undefined}
        />
      )}
      {currentUser && (
        <NewReservationDrawer
          open={newOpen}
          onClose={schedule.closeNew}
          currentUser={currentUser}
          initialDate={baseDate}
          onCreated={undefined}
        />
      )}
    </div>
  );
}
