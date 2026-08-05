"use client";

import { useMemo } from "react";
import type { AppointmentType, ReservationRecord } from "@/features/reservations/domain/reservationModels";
import { todayString } from "@/lib/dateUtils";
import { formatDate, parseDate } from "@/features/reservations/ui/scheduleDates";
import { getAppointmentColor } from "@/features/reservations/ui/scheduleLayout";

type MonthDisplayMode = "table" | "list";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const CANCELLED_COLOR = "#facc15";
const COMPLETED_COLOR = "#9ca3af";
const DETAIL_LABELS: Record<AppointmentType, string> = {
  상담: "상담 항목", 수술: "수술 항목", 시술: "시술 항목", 치료: "수술 항목", 경과: "경과 항목", 진료: "진료 항목", 검진: "검진 항목",
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
  return String(a.reservationTime || "").localeCompare(String(b.reservationTime || ""));
}

function dateLabel(dateStr: string) {
  const d = parseDate(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${WEEKDAY_LABELS[d.getDay()]}`;
}

function MonthListCard({ item, dateStr, onClick }: { item: ReservationRecord; dateStr: string; onClick: () => void }) {
  const color = cardColor(item);
  const cancelled = item.cancelled === true;
  const time = item.reservationTime ? item.reservationTime.slice(0, 5) : "--:--";
  return (
    <button type="button" onClick={onClick} className="flex min-h-[46px] w-full min-w-0 items-center overflow-hidden rounded-[22px] py-1 pl-4 pr-3 text-left transition active:scale-[0.99]" style={{ background: `linear-gradient(90deg, ${color}16 0%, rgba(255,255,255,0.92) 42%, rgba(255,255,255,0.98) 100%)`, boxShadow: `inset 5px 0 0 ${color}, 0 8px 16px rgba(15,23,42,.04)`, opacity: item.completed ? 0.84 : 1 }}>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className={"truncate text-[13px] font-semibold leading-4 tracking-[-0.035em] text-[#101828]" + (cancelled ? " line-through decoration-2" : "")}>{item.name || "이름 없음"}</div>
        <div className="mt-0.5 truncate text-[10px] font-normal leading-3 text-[#667085]">{dateLabel(dateStr)} · {time} · {item.hospital || "병원 미지정"}{item.consultArea ? ` · ${detailLabel(item)}: ${item.consultArea}` : ""}</div>
      </div>
    </button>
  );
}

export function MonthScheduleView({ monthStart, reservations, displayMode, onDayClick, onCardClick }: { monthStart: string; reservations: ReservationRecord[]; displayMode: MonthDisplayMode; onDayClick: (dateStr: string) => void; onCardClick: (item: ReservationRecord) => void }) {
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

  const weeks = useMemo(() => Array.from({ length: 6 }, (_, index) => cells.slice(index * 7, index * 7 + 7)), [cells]);

  if (displayMode === "list") {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <section className="rounded-[34px] bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,.05)]">
          <div className="space-y-2">
            {weeks.map((week, weekIndex) => {
              const currentMonthDays = week.filter((dateStr) => parseDate(dateStr).getMonth() + 1 === month);
              if (currentMonthDays.length === 0) return null;
              const includesToday = currentMonthDays.includes(today);
              const weekItems = currentMonthDays.flatMap((dateStr) => (dayItems.get(dateStr) || []).map((item) => ({ dateStr, item }))).sort((a, b) => `${a.dateStr} ${a.item.reservationTime || ""}`.localeCompare(`${b.dateStr} ${b.item.reservationTime || ""}`));
              const rangeStart = dateLabel(currentMonthDays[0]).split(" ")[0];
              const rangeEnd = dateLabel(currentMonthDays[currentMonthDays.length - 1]).split(" ")[0];
              return (
                <div key={week[0]} className="rounded-[30px] bg-[#f7faf8] p-2.5">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <h2 className={includesToday ? "rounded-[14px] bg-[#e3f2ee] px-2.5 py-1 text-sm font-semibold tracking-[-0.035em] text-[#0f9b8e]" : "px-1 py-1 text-sm font-semibold tracking-[-0.035em] text-[#101828]"}>{weekIndex + 1}주차</h2>
                    <span className="text-[10px] font-normal text-[#667085]">{rangeStart} ~ {rangeEnd} · {weekItems.length}건</span>
                  </div>
                  {weekItems.length === 0 ? <div className="rounded-[20px] bg-white/75 px-4 py-3 text-[11px] font-normal text-[#98a2b3]">예약 없음</div> : <div className="space-y-1.5">{weekItems.map(({ dateStr, item }) => <MonthListCard key={item.id} item={item} dateStr={dateStr} onClick={() => onCardClick(item)} />)}</div>}
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
      <section className="overflow-hidden rounded-[18px] border border-[#dfe7e4] bg-white">
        <div className="grid grid-cols-7 border-b border-[#dfe7e4]">
          {DAY_LABELS.map((label, index) => <div key={label} className={`py-2 text-center text-[10px] font-medium text-[#667085] ${index === 0 ? "" : "border-l border-[#dfe7e4]"}`}>{label}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((dateStr, index) => {
            const currentMonth = parseDate(dateStr).getMonth() + 1 === month;
            const items = dayItems.get(dateStr) || [];
            const shown = items.slice(0, 3);
            const more = items.length - shown.length;
            const isCurrentDay = dateStr === today;
            const columnIndex = index % 7;
            const rowIndex = Math.floor(index / 7);
            return (
              <div
                key={dateStr}
                onClick={() => onDayClick(dateStr)}
                className={`${currentMonth ? "cursor-pointer" : ""} min-h-[104px] min-w-0 px-1 py-1.5 ${columnIndex === 0 ? "" : "border-l border-[#e7ecea]"} ${rowIndex === 0 ? "" : "border-t border-[#e7ecea]"}`}
                style={{ backgroundColor: isCurrentDay ? "#eef9f5" : "#ffffff" }}
              >
                <div className="mb-1 flex justify-center">
                  <span className={isCurrentDay ? "rounded-[11px] bg-[#e3f2ee] px-2 py-0.5 text-[10px] font-semibold text-[#0f9b8e]" : currentMonth ? "px-2 py-0.5 text-[10px] font-medium text-[#344054]" : "px-2 py-0.5 text-[10px] font-medium text-[#c5cad3]"}>{parseDate(dateStr).getDate()}</span>
                </div>
                <div className="space-y-0.5">
                  {shown.map((item) => {
                    const color = cardColor(item);
                    const cancelled = item.cancelled === true;
                    const time = item.reservationTime ? item.reservationTime.slice(0, 5) : "--:--";
                    return (
                      <button key={item.id} type="button" onClick={(event) => { event.stopPropagation(); onCardClick(item); }} className="w-full min-w-0 overflow-hidden rounded-[11px] px-1 py-1 text-left" style={{ background: `linear-gradient(90deg, ${color}1f 0%, rgba(255,255,255,.92) 100%)`, boxShadow: `inset 3px 0 0 ${color}`, opacity: item.completed ? 0.78 : 1 }}>
                        <div className="truncate text-[8px] font-semibold leading-[10px]" style={{ color }}>{time} · {item.hospital || "병원 미지정"}</div>
                        <div className={"truncate text-[9px] font-semibold leading-[11px] tracking-[-0.03em] text-[#101828]" + (cancelled ? " line-through decoration-1" : "")}>{item.name || "이름 없음"}</div>
                      </button>
                    );
                  })}
                  {more > 0 ? <div className="pt-0.5 text-center text-[9px] font-normal text-[#98a2b3]">+{more}건</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
