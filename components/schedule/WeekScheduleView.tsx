"use client";

import { useMemo } from "react";
import type { ReservationRecord } from "@/lib/reservations";
import { addDays, formatDayLabel, isToday } from "@/lib/scheduleDates";
import {
  getAppointmentColor,
  minutesToPx,
  timeToMinutes,
  HOUR_HEIGHT,
  START_HOUR,
  TIME_COL_W,
  TOTAL_HOURS,
  WEEK_CARD_H,
} from "@/lib/scheduleLayout";
import { ScheduleHourGrid } from "@/components/schedule/ScheduleHourGrid";

const WEEK_CARD_GAP = 2;

function buildWeekStackPositions(items: ReservationRecord[]) {
  const sorted = [...items].sort((a, b) => {
    const timeDiff =
      timeToMinutes(a.reservationTime || "00:00") -
      timeToMinutes(b.reservationTime || "00:00");
    return timeDiff || String(a.id).localeCompare(String(b.id));
  });
  let nextTop = 0;

  return sorted.map((item) => {
    const naturalTop = minutesToPx(
      timeToMinutes(item.reservationTime || `${START_HOUR}:00`)
    );
    const top = Math.max(naturalTop, nextTop);
    nextTop = top + WEEK_CARD_H + WEEK_CARD_GAP;
    return { item, top };
  });
}

function WeekDayCard({ item, top, onClick }: { item: ReservationRecord; top: number; onClick: () => void }) {
  const cancelled = item.cancelled === true;
  const color = cancelled ? "#fef08a" : item.completed ? "#9ca3af" : getAppointmentColor(item.appointmentType);
  const textColor = cancelled ? "#78350f" : "white";
  const time = item.reservationTime ? item.reservationTime.slice(0, 5) : "";
  return (
    <button
      onClick={onClick}
      className="absolute overflow-hidden rounded px-1 text-left shadow-sm transition hover:brightness-110 active:scale-[0.99]"
      style={{
        top,
        height: WEEK_CARD_H,
        backgroundColor: color,
        opacity: item.completed ? 0.75 : 1,
        color: textColor,
        left: 1,
        width: "calc(100% - 2px)",
      }}
      title={[item.name, time, item.hospital, item.consultArea].filter(Boolean).join(" · ")}
    >
      <div className={`truncate text-[10px] font-semibold leading-tight ${cancelled ? "line-through" : ""}`}>
        {time && <span className="mr-0.5 opacity-80">{time}</span>}
        {item.name}
      </div>
    </button>
  );
}

export function WeekScheduleView({
  weekStart,
  reservations,
  onCardClick,
}: {
  weekStart: string;
  reservations: ReservationRecord[];
  onCardClick: (item: ReservationRecord) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const dayData = useMemo(() => {
    return days.map((day) => {
      const dayItems = reservations.filter((r) => r.reservationDate === day);
      const positioned = buildWeekStackPositions(dayItems);
      const contentH = positioned.length > 0
        ? Math.max(...positioned.map((p) => p.top + WEEK_CARD_H + 4))
        : 0;
      return { day, dayItems, positioned, contentH };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, reservations]);

  const baseH = TOTAL_HOURS * HOUR_HEIGHT;
  const maxH = Math.max(baseH, ...dayData.map((d) => d.contentH));
  const gridRows = Math.ceil(maxH / HOUR_HEIGHT);
  const hours = Array.from({ length: gridRows }, (_, i) => START_HOUR + i);

  const HEADER_H = 52;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex" style={{ minWidth: TIME_COL_W + 7 * 100 }}>

        {/* Sticky time column */}
        <div
          className="sticky left-0 z-10 flex shrink-0 flex-col border-r border-[#edf0f3] bg-white"
          style={{ width: TIME_COL_W }}
        >
          <div className="shrink-0 border-b border-[#edf0f3]" style={{ height: HEADER_H }} />
          {hours.map((h) => (
            <div
              key={h}
              className="flex items-start justify-center border-b border-[#f1f3f5] pt-1 text-[10px] text-gray-400"
              style={{ height: HOUR_HEIGHT }}
            >
              {h < 24 ? `${String(h).padStart(2, "0")}` : ""}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {dayData.map(({ day, dayItems, positioned }) => {
          const today = isToday(day);
          return (
            <div
              key={day}
              className="flex flex-col border-r border-[#edf0f3]"
              style={{ minWidth: 100, flex: 1 }}
            >
              <div
                className={`sticky top-0 z-10 flex shrink-0 flex-col items-center justify-center border-b border-[#edf0f3] ${today ? "bg-emerald-50" : "bg-white"}`}
                style={{ height: HEADER_H }}
              >
                <span className={`text-xs font-bold ${today ? "text-emerald-700" : "text-gray-700"}`}>
                  {formatDayLabel(day)}
                </span>
                <span className={`text-[10px] ${today ? "text-emerald-500" : "text-gray-400"}`}>{dayItems.length}건</span>
              </div>
              <div className="relative" style={{ height: maxH }}>
                <ScheduleHourGrid rows={gridRows} />
                {positioned.map(({ item, top }) => (
                  <WeekDayCard key={item.id} item={item} top={top} onClick={() => onCardClick(item)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
