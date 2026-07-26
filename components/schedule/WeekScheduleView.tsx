"use client";

import { useMemo } from "react";
import type { AppointmentType, ReservationRecord } from "@/features/reservations/domain/reservationModels";
import { addDays, isToday } from "@/features/reservations/ui/scheduleDates";
import { getAppointmentColor, SCHEDULE_APPOINTMENT_TYPES } from "@/features/reservations/ui/scheduleLayout";

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

function statusLabel(item: ReservationRecord) {
  if (item.cancelled) return "취소";
  if (item.completed) return "완료";
  return "대기";
}

function cardColor(item: ReservationRecord) {
  if (item.cancelled) return CANCELLED_COLOR;
  if (item.completed) return COMPLETED_COLOR;
  return getAppointmentColor(item.appointmentType);
}

function statusColor(item: ReservationRecord) {
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

function WeekReservationCard({
  item,
  compact = false,
  onClick,
}: {
  item: ReservationRecord;
  compact?: boolean;
  onClick: () => void;
}) {
  const color = cardColor(item);
  const statusColorValue = statusColor(item);
  const cancelled = item.cancelled === true;
  const time = item.reservationTime ? item.reservationTime.slice(0, 5) : "--:--";

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full min-w-0 overflow-hidden rounded-[18px] px-2 py-2 text-left transition active:scale-[0.99]"
        style={{
          background: `linear-gradient(90deg, ${color}16 0%, rgba(255,255,255,0.94) 48%, rgba(255,255,255,0.98) 100%)`,
          boxShadow: `inset 5px 0 0 ${color}, 0 8px 14px rgba(15,23,42,.04)`,
          opacity: item.completed ? 0.84 : 1,
        }}
      >
        <div className="truncate pl-1 text-[10px] font-bold leading-4" style={{ color }}>
          {time}
        </div>
        <div
          className={
            "mt-0.5 truncate pl-1 text-[12px] font-bold leading-4 tracking-[-0.04em] text-[#101828]" +
            (cancelled ? " line-through decoration-2" : "")
          }
        >
          {item.name || "이름 없음"}
        </div>
        <div className="mt-1 truncate pl-1 text-[10px] font-normal leading-3 text-[#667085]">{item.appointmentType}</div>
        <div className="mt-1 truncate pl-1 text-[10px] font-bold leading-3" style={{ color: statusColorValue }}>
          {statusLabel(item)}
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[86px] w-full min-w-0 items-center gap-2 overflow-hidden rounded-[32px] py-2.5 pl-5 pr-3 text-left transition active:scale-[0.99]"
      style={{
        background: `linear-gradient(90deg, ${color}16 0%, rgba(255,255,255,0.92) 42%, rgba(255,255,255,0.98) 100%)`,
        boxShadow: `inset 6px 0 0 ${color}, 0 10px 18px rgba(15,23,42,.045)`,
        opacity: item.completed ? 0.84 : 1,
      }}
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className={
            "truncate text-lg font-bold tracking-[-0.04em]" +
            (cancelled ? " text-[#101828] line-through decoration-2" : " text-[#101828]")
          }
        >
          {item.name || "이름 없음"}
        </div>
        <div className="mt-0.5 truncate text-xs font-semibold text-[#667085]">
          {time} · {item.hospital || "병원 미지정"}
        </div>
        {item.consultArea ? (
          <div className="mt-1 truncate text-xs font-normal text-[#667085]">
            {detailLabel(item)}: {item.consultArea}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="rounded-full bg-white/78 px-2 py-0.5 text-[10px] font-bold" style={{ color }}>
          {item.appointmentType}
        </span>
        <span className="rounded-full bg-white/78 px-2 py-0.5 text-[10px] font-bold" style={{ color: statusColorValue }}>
          {statusLabel(item)}
        </span>
      </div>
    </button>
  );
}

export function WeekScheduleView({
  weekStart,
  reservations,
  displayMode,
  onCardClick,
}: {
  weekStart: string;
  reservations: ReservationRecord[];
  displayMode: WeekDisplayMode;
  onCardClick: (item: ReservationRecord) => void;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const dayData = useMemo(() => {
    return days.map((day) => {
      const items = reservations.filter((item) => item.reservationDate === day).sort(sortByTime);
      return { day, items };
    });
  }, [days, reservations]);

  const hasReservations = reservations.length > 0;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="space-y-4">
        {displayMode === "table" ? (
          <section className="rounded-[34px] bg-white px-1.5 py-4 shadow-[0_10px_24px_rgba(15,23,42,.05)] sm:px-2">
            <div className="grid grid-cols-7 gap-0.5">
              {dayData.map(({ day, items }) => {
                const today = isToday(day);
                const label = tableDateLabel(day);
                return (
                  <div
                    key={day}
                    className={
                      today
                        ? "min-w-0 rounded-[22px] bg-[#e3f2ee] px-1 py-3"
                        : "min-w-0 rounded-[22px] bg-[#f7faf8] px-1 py-3"
                    }
                  >
                    <div className="mb-3 text-center">
                      <div className="text-sm font-bold leading-4 tracking-[-0.04em] text-[#101828]">{label.day}</div>
                      <div className={today ? "text-[10px] font-semibold leading-4 text-[#0f9b8e]" : "text-[10px] font-semibold leading-4 text-[#667085]"}>
                        {label.weekday}
                      </div>
                      <div className={items.length > 0 ? "text-[10px] font-normal leading-4 text-[#0f9b8e]" : "text-[10px] font-normal leading-4 text-[#98a2b3]"}>
                        {items.length}건
                      </div>
                      {today ? (
                        <div className="mx-auto mt-1 w-fit rounded-full bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-2 py-0.5 text-[9px] font-bold text-white">
                          Today
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      {items.length === 0 ? (
                        <div className="px-0.5 py-20 text-center text-[10px] font-normal leading-4 text-[#b4bcc8]">
                          예약<br />없음
                        </div>
                      ) : (
                        items.map((item) => (
                          <WeekReservationCard key={item.id} item={item} compact onClick={() => onCardClick(item)} />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="rounded-[34px] bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,.05)]">
            {!hasReservations ? (
              <div className="rounded-[24px] bg-[#f1f8f5] p-4 text-sm font-normal text-[#667085]">이번 주 예약이 없습니다.</div>
            ) : (
              <div className="space-y-4">
                {dayData
                  .filter(({ items }) => items.length > 0)
                  .map(({ day, items }) => {
                    const today = isToday(day);
                    return (
                      <div key={day} className={today ? "rounded-[30px] bg-[#e3f2ee] p-3" : "rounded-[30px] bg-[#f7faf8] p-3"}>
                        <div className="mb-3 flex min-w-0 items-center gap-2">
                          <h2 className="shrink-0 text-2xl font-bold tracking-[-0.05em] text-[#101828]">{dateLabel(day)}</h2>
                          {today ? <span className="shrink-0 rounded-full bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-3 py-1 text-[11px] font-bold text-white">Today</span> : null}
                          <span className="min-w-0 truncate text-[11px] font-normal text-[#667085]">{daySummary(items)}</span>
                        </div>

                        <div className="space-y-2.5">
                          {items.map((item) => (
                            <WeekReservationCard key={item.id} item={item} onClick={() => onCardClick(item)} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
