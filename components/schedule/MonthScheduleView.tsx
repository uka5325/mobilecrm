"use client";

import type { ReservationRecord } from "@/lib/reservations";
import { todayString } from "@/lib/dateUtils";
import { formatDate, parseDate } from "@/lib/scheduleDates";
import { getAppointmentColor } from "@/lib/scheduleLayout";

export function MonthScheduleView({
  monthStart,
  reservations,
  onDayClick,
  onCardClick,
}: {
  monthStart: string;
  reservations: ReservationRecord[];
  onDayClick: (dateStr: string) => void;
  onCardClick: (item: ReservationRecord) => void;
}) {
  const [y, m] = monthStart.split("-").map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const lastDay = new Date(y, m, 0);
  const startWeekday = firstDay.getDay();
  const adjustedStart = startWeekday === 0 ? 6 : startWeekday - 1;
  const calStart = new Date(firstDay);
  calStart.setDate(calStart.getDate() - adjustedStart);

  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(calStart);
    d.setDate(d.getDate() + i);
    cells.push(formatDate(d));
  }

  const today = todayString();
  const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-b-2xl bg-white">
      <div className="grid grid-cols-7 border-b border-[#edf0f3]">
        {DAY_LABELS.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-gray-500">{d}</div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7" style={{ gridAutoRows: "minmax(80px, 1fr)" }}>
        {cells.map((dateStr) => {
          const [, cellMonth] = dateStr.split("-").map(Number);
          const isCurrentMonth = cellMonth === m;
          const dayItems = reservations.filter((r) => r.reservationDate === dateStr);
          const shown = dayItems.slice(0, 3);
          const more = dayItems.length - shown.length;
          const isLastDay = dateStr === formatDate(lastDay);
          return (
            <div
              key={dateStr}
              className={`relative border-b border-r border-[#edf0f3] p-1.5 cursor-pointer ${!isCurrentMonth ? "bg-gray-50" : "bg-white"} ${dateStr === today ? "ring-2 ring-inset ring-emerald-400" : ""}`}
              onClick={() => onDayClick(dateStr)}
            >
              <div className={`mb-1 text-right text-xs font-semibold ${dateStr === today ? "text-emerald-600" : isCurrentMonth ? "text-gray-700" : "text-gray-300"}`}>
                {parseDate(dateStr).getDate()}
              </div>
              <div className="space-y-0.5">
                {shown.map((item) => {
                  const isCancelled = item.cancelled === true;
                  const bg = isCancelled ? "#fef08a" : item.completed ? "#9ca3af" : getAppointmentColor(item.appointmentType);
                  const tc = isCancelled ? "#78350f" : "white";
                  return (
                    <button
                      key={item.id}
                      onClick={(e) => { e.stopPropagation(); onCardClick(item); }}
                      className={`w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-semibold ${isCancelled ? "line-through" : ""}`}
                      style={{ backgroundColor: bg, color: tc, opacity: item.completed ? 0.75 : 1 }}
                    >
                      {item.reservationTime && <span className="mr-0.5 opacity-90">{item.reservationTime.slice(0, 5)}</span>}
                      {item.name}
                    </button>
                  );
                })}
                {more > 0 && (
                  <div className="text-right text-[10px] text-gray-400">+{more}건</div>
                )}
              </div>
              {isLastDay && <div className="hidden" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
