"use client";

import { useMemo } from "react";
import type { AppointmentType, ReservationRecord } from "@/features/reservations/domain/reservationModels";
import { getAppointmentColor } from "@/features/reservations/ui/scheduleLayout";

type DayDisplayMode = "time" | "hospital";

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

function AppointmentCard({
  item,
  onClick,
  compact = false,
  showHospital = true,
  showTimeInside = false,
  showTimeWithDetail = false,
}: {
  item: ReservationRecord;
  onClick: () => void;
  compact?: boolean;
  showHospital?: boolean;
  showTimeInside?: boolean;
  showTimeWithDetail?: boolean;
}) {
  const color = cardColor(item);
  const status = statusLabel(item);
  const cancelled = item.cancelled === true;

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        compact
          ? "flex min-h-[58px] w-full min-w-0 items-center gap-2 overflow-hidden rounded-[26px] py-2 pl-5 pr-3 text-left transition active:scale-[0.99]"
          : "flex min-h-[82px] w-full min-w-0 items-center gap-2 overflow-hidden rounded-[26px] py-2.5 pl-5 pr-3 text-left transition active:scale-[0.99]"
      }
      style={{
        background: "linear-gradient(90deg, " + color + "16 0%, rgba(255,255,255,0.92) 42%, rgba(255,255,255,0.98) 100%)",
        boxShadow: "inset 6px 0 0 " + color + ", 0 10px 18px rgba(15,23,42,.045)",
        opacity: item.completed ? 0.84 : 1,
      }}
    >
      {showTimeInside ? (
        <div className="w-[38px] shrink-0 text-xs font-bold tracking-[-0.03em] text-[#101828]">
          {item.reservationTime ? item.reservationTime.slice(0, 5) : "--:--"}
        </div>
      ) : null}

      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className={
            "truncate text-sm font-semibold tracking-[-0.035em]" +
            (cancelled ? " text-[#101828] line-through decoration-2" : " text-[#101828]")
          }
        >
          {item.name || "이름 없음"}
        </div>

        {showHospital ? (
          <div className="mt-0.5 truncate text-[11px] font-normal text-[#667085]">
            {item.hospital || "병원 미지정"}
          </div>
        ) : null}

        {item.consultArea ? (
          <div className="mt-0.5 truncate text-[11px] font-normal text-[#667085]">
            {showTimeWithDetail && item.reservationTime ? item.reservationTime.slice(0, 5) + " · " : ""}{detailLabel(item)}: {item.consultArea}
          </div>
        ) : showTimeWithDetail && item.reservationTime ? (
          <div className="mt-0.5 truncate text-[11px] font-normal text-[#667085]">{item.reservationTime.slice(0, 5)}</div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="rounded-full bg-white/78 px-2 py-0.5 text-[10px] font-bold" style={{ color }}>
          {item.appointmentType}
        </span>
        <span
          className="rounded-full bg-white/78 px-2 py-0.5 text-[10px] font-bold"
          style={{ color: statusColor(item) }}
        >
          {status}
        </span>
      </div>
    </button>
  );
}

function TimeDayView({
  dateStr,
  reservations,
  onCardClick,
}: {
  dateStr: string;
  reservations: ReservationRecord[];
  onCardClick: (item: ReservationRecord) => void;
}) {
  const timeGroups = useMemo(() => {
    const sorted = [...reservations].sort((a, b) =>
      String(a.reservationTime || "").localeCompare(String(b.reservationTime || ""))
    );
    const groups: Array<{ time: string; items: ReservationRecord[] }> = [];

    sorted.forEach((item) => {
      const time = item.reservationTime ? item.reservationTime.slice(0, 5) : "--:--";
      const lastGroup = groups[groups.length - 1];
      if (lastGroup?.time === time) {
        lastGroup.items.push(item);
      } else {
        groups.push({ time, items: [item] });
      }
    });

    return groups;
  }, [reservations]);

  return (
    <section className="rounded-[34px] bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,.05)] sm:p-4">
      {timeGroups.length === 0 ? (
        <div className="rounded-[24px] bg-[#f1f8f5] p-4 text-sm font-normal text-[#667085]">
          {dateStr} 예약이 없습니다.
        </div>
      ) : (
        <div className="relative space-y-3">
          <div className="absolute bottom-2 left-[44px] top-2 w-px bg-[#e4ece8]" />
          {timeGroups.map((group) => (
            <div key={group.time} className="relative grid min-w-0 grid-cols-[44px_minmax(0,1fr)] gap-2">
              <div className="relative z-10 pt-3">
                <div className="whitespace-nowrap text-left text-sm font-bold tracking-[-0.03em] text-[#475467]">
                  {group.time}
                </div>
                <div className="absolute right-[-4px] top-9 h-2 w-2 rounded-full bg-[#d7e2de]" />
              </div>

              <div className="space-y-2">
                {group.items.map((item) => (
                  <AppointmentCard key={item.id} item={item} onClick={() => onCardClick(item)} showHospital />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HospitalDayView({
  reservations,
  onCardClick,
}: {
  reservations: ReservationRecord[];
  onCardClick: (item: ReservationRecord) => void;
}) {
  const hospitalGroups = useMemo(() => {
    const map = new Map<string, ReservationRecord[]>();
    reservations.forEach((item) => {
      const hospital = item.hospital || "병원 미지정";
      const group = map.get(hospital) || [];
      group.push(item);
      map.set(hospital, group);
    });

    return Array.from(map.entries())
      .map(([hospital, items]) => ({
        hospital,
        items: [...items].sort((a, b) => String(a.reservationTime || "").localeCompare(String(b.reservationTime || ""))),
      }))
      .sort((a, b) => a.hospital.localeCompare(b.hospital));
  }, [reservations]);

  if (hospitalGroups.length === 0) {
    return (
      <section className="rounded-[34px] bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,.05)] sm:p-4">
        <div className="rounded-[24px] bg-[#f1f8f5] p-4 text-sm font-normal text-[#667085]">예약이 없습니다.</div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {hospitalGroups.map(({ hospital, items }) => (
        <section key={hospital} className="rounded-[34px] bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,.05)]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="truncate text-base font-semibold tracking-[-0.035em] text-[#101828]">{hospital}</h2>
            <span className="shrink-0 text-[11px] font-normal text-[#667085]">{items.length}건</span>
          </div>

          <div className="space-y-2.5">
            {items.map((item) => (
              <AppointmentCard
                key={item.id}
                item={item}
                compact
                showHospital={false}
                showTimeWithDetail
                onClick={() => onCardClick(item)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function DayScheduleView({
  dateStr,
  reservations,
  displayMode = "time",
  onCardClick,
}: {
  dateStr: string;
  reservations: ReservationRecord[];
  displayMode?: DayDisplayMode;
  onCardClick: (item: ReservationRecord) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {displayMode === "hospital" ? (
        <HospitalDayView reservations={reservations} onCardClick={onCardClick} />
      ) : (
        <TimeDayView dateStr={dateStr} reservations={reservations} onCardClick={onCardClick} />
      )}
    </div>
  );
}
