"use client";

import { useMemo } from "react";
import type { AppointmentType, ReservationRecord } from "@/features/reservations/domain/reservationModels";
import { addDays, isToday } from "@/features/reservations/ui/scheduleDates";
import { END_HOUR, getAppointmentColor, SCHEDULE_APPOINTMENT_TYPES, START_HOUR } from "@/features/reservations/ui/scheduleLayout";

type WeekDisplayMode = "table" | "list";

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

function dateObj(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateLabel(dateStr: string) {
  const d = dateObj(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${WEEKDAY_LABELS[d.getDay()]}`;
}

function tableDateLabel(dateStr: string) {
  const d = dateObj(dateStr);
  return { day: String(d.getDate()), weekday: WEEKDAY_LABELS[d.getDay()] };
}

function sortByTime(a: ReservationRecord, b: ReservationRecord) {
  return String(a.reservationTime || "").localeCompare(String(b.reservationTime || ""));
}

function hourOf(item: ReservationRecord) {
  const value = Number(String(item.reservationTime || "").slice(0, 2));
  return Number.isFinite(value) ? value : START_HOUR;
}

function cardColor(item: ReservationRecord) {
  if (item.cancelled) return CANCELLED_COLOR;
  if (item.completed) return COMPLETED_COLOR;
  return getAppointmentColor(item.appointmentType);
}

function detailLabel(item: ReservationRecord) {
  return DETAIL_LABELS[item.appointmentType] || "상담 항목";
}

function daySummary(items: ReservationRecord[]) {
  const summary = SCHEDULE_APPOINTMENT_TYPES
    .map((type) => ({ type, count: items.filter((item) => item.appointmentType === type).length }))
    .filter((item) => item.count > 0)
    .slice(0, 3)
    .map((item) => `${item.type} ${item.count}`)
    .join(" · ");
  return summary ? `${items.length}건 · ${summary}` : `${items.length}건`;
}

function WeekReservationCard({ item, compact = false, showType = false, onClick }: { item: ReservationRecord; compact?: boolean; showType?: boolean; onClick: () => void }) {
  const color = cardColor(item);
  const cancelled = item.cancelled === true;
  const time = item.reservationTime ? item.reservationTime.slice(0, 5) : "--:--";
  if (compact) {
    return (
      <button type="button" onClick={onClick} className="h-[36px] w-full min-w-0 overflow-hidden rounded-[15px] px-1 py-1 text-left transition active:scale-[0.99]" style={{ background: `linear-gradient(90deg, ${color}16 0%, rgba(255,255,255,0.94) 48%, rgba(255,255,255,0.98) 100%)`, boxShadow: `inset 4px 0 0 ${color}, 0 6px 12px rgba(15,23,42,.035)`, opacity: item.completed ? 0.84 : 1 }}>
        <div className="overflow-hidden whitespace-nowrap pl-1 text-[8px] font-semibold leading-3" style={{ color }}>{time} · {item.hospital || "병원 미지정"}{showType ? ` · ${item.appointmentType}` : ""}</div>
        <div className={"overflow-hidden whitespace-nowrap pl-1 text-[9px] font-semibold leading-3 tracking-[-0.03em] text-[#101828]" + (cancelled ? " line-through decoration-2" : "")}>{item.name || "이름 없음"}</div>
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} className="flex min-h-[54px] w-full min-w-0 items-center overflow-hidden rounded-[26px] py-1.5 pl-4 pr-3 text-left transition active:scale-[0.99]" style={{ background: `linear-gradient(90deg, ${color}16 0%, rgba(255,255,255,0.92) 42%, rgba(255,255,255,0.98) 100%)`, boxShadow: `inset 5px 0 0 ${color}, 0 8px 16px rgba(15,23,42,.04)`, opacity: item.completed ? 0.84 : 1 }}>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className={"truncate text-sm font-semibold tracking-[-0.035em] text-[#101828]" + (cancelled ? " line-through decoration-2" : "")}>{item.name || "이름 없음"}</div>
        <div className="mt-0.5 truncate text-[11px] font-normal leading-4 text-[#667085]">{time} · {item.hospital || "병원 미지정"}{item.consultArea ? ` · ${detailLabel(item)}: ${item.consultArea}` : ""}</div>
      </div>
    </button>
  );
}

function MobileWeekTable({ dayData, onCardClick }: { dayData: Array<{ day: string; items: ReservationRecord[] }>; onCardClick: (item: ReservationRecord) => void }) {
  return (
    <section className="rounded-[34px] bg-white px-0.5 pb-6 pt-3 shadow-[0_10px_24px_rgba(15,23,42,.05)] lg:hidden">
      <div className="grid grid-cols-7 gap-px">
        {dayData.map(({ day, items }) => {
          const today = isToday(day);
          const label = tableDateLabel(day);
          return (
            <div key={day} className="min-w-0 py-1">
              <div className="mb-2 flex min-h-[50px] flex-col items-center">
                <div className={today ? "rounded-[14px] bg-[#e3f2ee] px-2 py-1 text-center" : "px-2 py-1 text-center"}>
                  <div className="text-xs font-semibold leading-4 tracking-[-0.03em] text-[#101828]">{label.day}</div>
                  <div className={today ? "text-[9px] font-medium leading-3 text-[#0f9b8e]" : "text-[9px] font-medium leading-3 text-[#667085]"}>{label.weekday}</div>
                </div>
                <div className={items.length > 0 ? "mt-1 text-[9px] font-normal leading-3 text-[#667085]" : "mt-1 text-[9px] font-normal leading-3 text-[#b4bcc8]"}>{items.length}건</div>
              </div>
              <div className="space-y-1.5">{items.length === 0 ? <div className="py-12 text-center text-[9px] font-normal leading-3 text-[#b4bcc8]">예약<br />없음</div> : items.map((item) => <WeekReservationCard key={item.id} item={item} compact onClick={() => onCardClick(item)} />)}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DesktopWeekTable({ dayData, onCardClick }: { dayData: Array<{ day: string; items: ReservationRecord[] }>; onCardClick: (item: ReservationRecord) => void }) {
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index);
  return (
    <section className="hidden overflow-hidden rounded-[18px] border border-[#dfe7e4] bg-white lg:block">
      <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))]">
        <div className="h-[66px] border-b border-r border-[#dfe7e4]" />
        {dayData.map(({ day, items }, index) => {
          const today = isToday(day);
          const label = tableDateLabel(day);
          return (
            <div key={day} className={`flex h-[66px] min-w-0 flex-col items-center justify-center border-b border-[#dfe7e4] ${index === 0 ? "" : "border-l"} ${today ? "bg-[#f3fbf8]" : "bg-white"}`}>
              <div className={today ? "rounded-[14px] bg-[#e3f2ee] px-3 py-1 text-center" : "px-3 py-1 text-center"}>
                <div className={today ? "text-xs font-semibold leading-4 tracking-[-0.03em] text-[#0f9b8e]" : "text-xs font-semibold leading-4 tracking-[-0.03em] text-[#101828]"}>{label.day}</div>
                <div className={today ? "text-[9px] font-medium leading-3 text-[#0f9b8e]" : "text-[9px] font-medium leading-3 text-[#667085]"}>{label.weekday}</div>
              </div>
              <div className={items.length > 0 ? "mt-1 text-[9px] font-normal leading-3 text-[#667085]" : "mt-1 text-[9px] font-normal leading-3 text-[#b4bcc8]"}>{items.length}건</div>
            </div>
          );
        })}
        {hours.flatMap((hour) => {
          const cells = dayData.map(({ day, items }, index) => {
            const today = isToday(day);
            const hourItems = items.filter((item) => hourOf(item) === hour);
            return (
              <div key={`${day}-${hour}`} className={`min-h-[88px] border-b border-[#e7ecea] p-1.5 ${index === 0 ? "" : "border-l"} ${today ? "bg-[#f3fbf8]" : "bg-white"}`}>
                <div className="space-y-1.5">{hourItems.map((item) => <WeekReservationCard key={item.id} item={item} compact showType onClick={() => onCardClick(item)} />)}</div>
              </div>
            );
          });
          return [<div key={`${hour}-label`} className="flex min-h-[88px] items-start justify-center border-b border-r border-[#e7ecea] bg-white pt-3 text-[10px] font-bold text-[#52606d]">{String(hour).padStart(2, "0")}:00</div>, ...cells];
        })}
      </div>
    </section>
  );
}

function MobileWeekList({ dayData, onCardClick }: { dayData: Array<{ day: string; items: ReservationRecord[] }>; onCardClick: (item: ReservationRecord) => void }) {
  return (
    <section className="rounded-[34px] bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,.05)] lg:hidden">
      <div className="space-y-2">
        {dayData.map(({ day, items }) => {
          const today = isToday(day);
          return (
            <div key={day} className="rounded-[26px] bg-[#f7faf8] p-2.5">
              <div className="mb-2 flex min-w-0 items-center gap-2">
                <h2 className={today ? "shrink-0 rounded-[14px] bg-[#e3f2ee] px-2.5 py-1 text-base font-semibold tracking-[-0.035em] text-[#0f9b8e]" : "shrink-0 px-1 py-1 text-base font-semibold tracking-[-0.035em] text-[#101828]"}>{dateLabel(day)}</h2>
                <span className="min-w-0 truncate text-[10px] font-normal text-[#667085]">{daySummary(items)}</span>
              </div>
              {items.length === 0 ? <div className="rounded-[20px] bg-white/75 px-4 py-3 text-[11px] font-normal text-[#98a2b3]">예약 없음</div> : <div className="space-y-2">{items.map((item) => <WeekReservationCard key={item.id} item={item} onClick={() => onCardClick(item)} />)}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DesktopWeekList({ dayData, onCardClick }: { dayData: Array<{ day: string; items: ReservationRecord[] }>; onCardClick: (item: ReservationRecord) => void }) {
  return (
    <section className="hidden overflow-hidden rounded-[18px] border border-[#dfe7e4] bg-white lg:block">
      {dayData.map(({ day, items }, index) => {
        const today = isToday(day);
        return (
          <div key={day} className={`${index === dayData.length - 1 ? "px-4 py-4" : "border-b border-[#e7ecea] px-4 py-4"} ${today ? "bg-[#f3fbf8]" : "bg-white"}`}>
            <div className="mb-3 flex min-w-0 items-center gap-2.5">
              <h2 className={today ? "shrink-0 rounded-[14px] bg-[#e3f2ee] px-3 py-1.5 text-sm font-semibold tracking-[-0.035em] text-[#0f9b8e]" : "shrink-0 px-1 py-1.5 text-sm font-semibold tracking-[-0.035em] text-[#101828]"}>{dateLabel(day)}</h2>
              <span className="min-w-0 truncate text-[11px] font-normal text-[#667085]">{daySummary(items)}</span>
            </div>
            {items.length === 0 ? <div className="rounded-[18px] border border-dashed border-[#dfe7e4] px-4 py-3 text-[11px] font-normal text-[#98a2b3]">예약 없음</div> : <div className="grid grid-cols-2 gap-2">{items.map((item) => <WeekReservationCard key={item.id} item={item} onClick={() => onCardClick(item)} />)}</div>}
          </div>
        );
      })}
    </section>
  );
}

export function WeekScheduleView({ weekStart, reservations, displayMode, onCardClick }: { weekStart: string; reservations: ReservationRecord[]; displayMode: WeekDisplayMode; onCardClick: (item: ReservationRecord) => void }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const dayData = useMemo(() => days.map((day) => ({ day, items: reservations.filter((item) => item.reservationDate === day).sort(sortByTime) })), [days, reservations]);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="space-y-4">
        {displayMode === "table" ? <><MobileWeekTable dayData={dayData} onCardClick={onCardClick} /><DesktopWeekTable dayData={dayData} onCardClick={onCardClick} /></> : <><MobileWeekList dayData={dayData} onCardClick={onCardClick} /><DesktopWeekList dayData={dayData} onCardClick={onCardClick} /></>}
      </div>
    </div>
  );
}
