"use client";

import { DetailDrawer } from "@/components/timeline/DetailDrawer";
import { NewReservationDrawer } from "@/components/timeline/NewReservationDrawer";
import { ScheduleHeader } from "@/components/schedule/ScheduleHeader";
import { DayScheduleView } from "@/components/schedule/DayScheduleView";
import { WeekScheduleView } from "@/components/schedule/WeekScheduleView";
import { MonthScheduleView } from "@/components/schedule/MonthScheduleView";
import { useSchedulePage } from "@/hooks/useSchedulePage";

export default function SchedulePage() {
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
    <div className="-mx-6 -mb-6 mt-5 flex h-[calc(100vh-170px)] min-h-[640px] flex-col overflow-hidden rounded-2xl border border-[#edf0f3] bg-white">
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
        todayMemos={schedule.todayMemos}
        memoSectionOpen={schedule.memoSectionOpen}
        onToggleMemoSection={schedule.toggleMemoSection}
      />

      {/* 뷰 */}
      {viewMode === "day" && (
        <DayScheduleView dateStr={baseDate} reservations={reservations} onCardClick={schedule.openDetail} />
      )}
      {viewMode === "week" && (
        <WeekScheduleView weekStart={schedule.weekStart} reservations={reservations} onCardClick={schedule.openDetail} />
      )}
      {viewMode === "month" && (
        <MonthScheduleView
          monthStart={schedule.monthStart}
          reservations={reservations}
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
