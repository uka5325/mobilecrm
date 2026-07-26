"use client";

import { useMemo } from "react";
import type {
  AppointmentType,
  ReservationRecord,
} from "@/features/reservations/domain/reservationModels";
import { todayString } from "@/lib/dateUtils";
import {
  formatDate,
  parseDate,
} from "@/features/reservations/ui/scheduleDates";
import {
  getAppointmentColor,
  SCHEDULE_APPOINTMENT_TYPES,
} from "@/features/reservations/ui/scheduleLayout";

type MonthDisplayMode = "table" | "list";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const CANCELLED_COLOR = "#facc15";
const COMPLETED_COLOR = "#9ca3af";
const DETAIL_LABELS: Record<AppointmentType, string> = {
  상담: "상담 항목",
  수술: "수술 항목",
  시술: "시술 항목",
  치료: "수술 항목",
  경과: "경과 항목",
  진료: "진료 항목",
  검진: "검진 항목",
};

function cardColor(item: ReservationRecord) {
  if (item.cancelled) return CANCELLED_COLOR;
  if (item.completed) return COMPLETED_COLOR;
  return getAppointmentColor(item.appointmentType);
}

function detailLabel(item: ReservationRecord) {
  return DETAIL_LABELS[item.appointmentType] || "상담 항목";
}

function sortByTime(a: ReservationRecord, b: ReservationRecord) {
  return String(a.reservationTime || "").localeCompare(
    String(b.reservationTime || ""),
  );
}

function dateLabel(dateStr: string) {
  const d = parseDate(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${WEEKDAY_LABELS[d.getDay()]}`;
}

function daySummary(items: ReservationRecord[]) {
  const summary = SCHEDULE_APPOINTMENT_TYPES.map((type) => ({
    type,
    count: items.filter((item) => item.appointmentType === type).length,
  }))
    .filter((item) => item.count > 0)
    .slice(0, 3)
    .map((item) => `${item.type} ${item.count}`)
    .join(" · ");

  return summary ? `${items.length}건 · ${summary}` : `${items.length}건`;
}

function MonthListCard({
  item,
  onClick,
}: {
  item: ReservationRecord;
  onClick: () => void;
}) {
  const color = cardColor(item);
  const cancelled = item.cancelled === true;
  const time = item.reservationTime
    ? item.reservationTime.slice(0, 5)
    : "--:--";

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[54px] w-full min-w-0 items-center overflow-hidden rounded-[26px] py-1.5 pl-4 pr-3 text-left transition active:scale-[0.99]"
      style={{
        background: `linear-gradient(90deg, ${color}16 0%, rgba(255,255,255,0.92) 42%, rgba(255,255,255,0.98) 100%)`,
        boxShadow: `inset 5px 0 0 ${color}, 0 8px 16px rgba(15,23,42,.04)`,
        opacity: item.completed ? 0.84 : 1,
      }}
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className={
            "truncate text-sm font-semibold tracking-[-0.035em] text-[#101828]" +
            (cancelled ? " line-through decoration-2" : "")
          }
        >
          {item.name || "이름 없음"}
        </div>
        <div className="mt-0.5 truncate text-[11px] font-normal leading-4 text-[#667085]">
          {time} · {item.hospital || "병원 미지정"}
          {item.consultArea
            ? ` · ${detailLabel(item)}: ${item.consultArea}`
            : ""}
        </div>
      </div>
    </button>
  );
}

export function MonthScheduleView({
  monthStart,
  reservations,
  displayMode,
  onDayClick,
  onCardClick,
}: {
  monthStart: string;
  reservations: ReservationRecord[];
  displayMode: MonthDisplayMode;
  onDayClick: (dateStr: string) => void;
  onCardClick: (item: ReservationRecord) => void;
}) {
  const [year, month] = monthStart.split("-").map(Number);
  const today = todayString();

  const cells = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const startWeekday = firstDay.getDay();
    const adjustedStart = startWeekday === 0 ? 6 : startWeekday - 1;
    const calendarStart = new Date(firstDay);
    calendarStart.setDate(calendarStart.getDate() - adjustedStart);

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(calendarStart);
      date.setDate(date.getDate() + index);
      return formatDate(date);
    });
  }, [year, month]);

  const dayItems = useMemo(() => {
    const map = new Map<string, ReservationRecord[]>();
    cells.forEach((dateStr) => map.set(dateStr, []));
    reservations.forEach((item) => {
      const items = map.get(item.reservationDate) || [];
      items.push(item);
      map.set(item.reservationDate, items);
    });
    map.forEach((items) => items.sort(sortByTime));
    return map;
  }, [cells, reservations]);

  const weeks = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) =>
        cells.slice(index * 7, index * 7 + 7),
      ),
    [cells],
  );

  if (displayMode === "list") {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <section className="rounded-[34px] bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,.05)]">
          <div className="space-y-4">
            {weeks.map((week, weekIndex) => {
              const currentMonthDays = week.filter(
                (dateStr) => parseDate(dateStr).getMonth() + 1 === month,
              );
              if (currentMonthDays.length === 0) return null;

              const weekCount = currentMonthDays.reduce(
                (sum, dateStr) => sum + (dayItems.get(dateStr)?.length || 0),
                0,
              );
              const rangeStart = dateLabel(currentMonthDays[0]).split(" ")[0];
              const rangeEnd = dateLabel(
                currentMonthDays[currentMonthDays.length - 1],
              ).split(" ")[0];

              return (
                <div
                  key={week[0]}
                  className="rounded-[30px] bg-[#f1f8f5] p-2.5"
                >
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <h2 className="text-sm font-semibold tracking-[-0.035em] text-[#101828]">
                      {weekIndex + 1}주차
                    </h2>
                    <span className="text-[10px] font-normal text-[#667085]">
                      {rangeStart} ~ {rangeEnd} · {weekCount}건
                    </span>
                  </div>

                  <div className="space-y-3">
                    {currentMonthDays.map((dateStr) => {
                      const items = dayItems.get(dateStr) || [];
                      const isCurrentDay = dateStr === today;
                      return (
                        <div
                          key={dateStr}
                          className="rounded-[26px] bg-[#f7faf8] p-2.5"
                        >
                          <div className="mb-2 flex min-w-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onDayClick(dateStr)}
                              className={
                                isCurrentDay
                                  ? "shrink-0 rounded-[14px] bg-[#e3f2ee] px-2.5 py-1 text-base font-semibold tracking-[-0.035em] text-[#0f9b8e]"
                                  : "shrink-0 px-1 py-1 text-base font-semibold tracking-[-0.035em] text-[#101828]"
                              }
                            >
                              {dateLabel(dateStr)}
                            </button>
                            <span className="min-w-0 truncate text-[10px] font-normal text-[#667085]">
                              {daySummary(items)}
                            </span>
                          </div>

                          {items.length === 0 ? (
                            <div className="rounded-[20px] bg-white/75 px-4 py-3 text-[11px] font-normal text-[#98a2b3]">
                              예약 없음
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {items.map((item) => (
                                <MonthListCard
                                  key={item.id}
                                  item={item}
                                  onClick={() => onCardClick(item)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <section className="rounded-[34px] bg-white p-2 shadow-[0_10px_24px_rgba(15,23,42,.05)]">
        <div className="grid grid-cols-7 gap-1 px-1 pb-1">
          {DAY_LABELS.map((label) => (
            <div
              key={label}
              className="py-1.5 text-center text-[10px] font-medium text-[#667085]"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((dateStr) => {
            const currentMonth = parseDate(dateStr).getMonth() + 1 === month;
            const items = dayItems.get(dateStr) || [];
            const shown = items.slice(0, 3);
            const more = items.length - shown.length;
            const isCurrentDay = dateStr === today;

            return (
              <div
                key={dateStr}
                onClick={() => onDayClick(dateStr)}
                className={
                  currentMonth
                    ? "min-h-[80px] min-w-0 cursor-pointer rounded-[18px] bg-[#f7faf8] px-1 py-1.5"
                    : "min-h-[80px] min-w-0 rounded-[18px] bg-[#fbfcfb] px-1 py-1.5"
                }
              >
                <div className="mb-1 flex justify-center">
                  <span
                    className={
                      isCurrentDay
                        ? "rounded-[11px] bg-[#e3f2ee] px-2 py-0.5 text-[10px] font-semibold text-[#0f9b8e]"
                        : currentMonth
                          ? "px-2 py-0.5 text-[10px] font-medium text-[#344054]"
                          : "px-2 py-0.5 text-[10px] font-medium text-[#c5cad3]"
                    }
                  >
                    {parseDate(dateStr).getDate()}
                  </span>
                </div>

                <div className="space-y-1">
                  {shown.map((item) => {
                    const color = cardColor(item);
                    const cancelled = item.cancelled === true;
                    const time = item.reservationTime
                      ? item.reservationTime.slice(0, 5)
                      : "--:--";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onCardClick(item);
                        }}
                        className={
                          "w-full min-w-0 truncate rounded-[10px] px-0.5 py-0.5 text-center text-[9px] font-semibold leading-3" +
                          (cancelled ? " line-through decoration-1" : "")
                        }
                        style={{
                          color,
                          background: `linear-gradient(90deg, ${color}1f 0%, rgba(255,255,255,.92) 100%)`,
                          boxShadow: `inset 3px 0 0 ${color}`,
                          opacity: item.completed ? 0.78 : 1,
                        }}
                      >
                        {time}
                      </button>
                    );
                  })}
                  {more > 0 ? (
                    <div className="text-center text-[9px] font-normal text-[#98a2b3]">
                      +{more}건
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
