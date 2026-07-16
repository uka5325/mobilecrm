"use client";

import { useMemo } from "react";
import type { ReservationRecord } from "@/lib/reservations";
import { formatLog } from "@/lib/scheduleDates";
import {
  buildColumnPositions,
  CARD_HEIGHT,
  getAppointmentColor,
  HOUR_HEIGHT,
  START_HOUR,
  TIME_COL_W,
  TOTAL_HOURS,
} from "@/lib/scheduleLayout";
import { ScheduleHourGrid } from "@/components/schedule/ScheduleHourGrid";

function DayCard({ item, top, col, totalCols, onClick }: { item: ReservationRecord; top: number; col: number; totalCols: number; onClick: () => void }) {
  const cancelled = item.cancelled === true;
  const color = cancelled ? "#fef08a" : item.completed ? "#9ca3af" : getAppointmentColor(item.appointmentType);
  const textColor = cancelled ? "#78350f" : "white";
  const time = item.reservationTime || "";
  const areaLabel = item.appointmentType === "상담" ? "상담부위" : "수술항목";
  const logText = formatLog(item.updatedBy, item.updatedAt);

  return (
    <button
      onClick={onClick}
      className="absolute flex flex-col overflow-hidden rounded-md px-2 py-1 text-left shadow-sm transition hover:brightness-110 active:scale-[0.99]"
      style={{
        top,
        height: CARD_HEIGHT,
        backgroundColor: color,
        opacity: item.completed ? 0.75 : 1,
        color: textColor,
        left: `calc(${(col / totalCols) * 100}% + 2px)`,
        width: `calc(${(1 / totalCols) * 100}% - 4px)`,
      }}
    >
      <div className={`truncate text-[11px] font-bold leading-tight ${cancelled ? "line-through" : ""}`}>{item.name}</div>
      <div className={`truncate text-[10px] opacity-85 leading-tight ${cancelled ? "line-through" : ""}`}>
        {[time, item.hospital].filter(Boolean).join(" · ")}
      </div>
      {item.consultArea && (
        <div className={`truncate text-[9px] opacity-80 leading-tight ${cancelled ? "line-through" : ""}`}>
          {areaLabel}: {item.consultArea}
        </div>
      )}
      {logText && (
        <div className="mt-auto truncate text-[8px] opacity-55 leading-tight">{logText}</div>
      )}
    </button>
  );
}

export function DayScheduleView({
  dateStr,
  reservations,
  onCardClick,
}: {
  dateStr: string;
  reservations: ReservationRecord[];
  onCardClick: (item: ReservationRecord) => void;
}) {
  const hospitals = useMemo(() => {
    const s = new Set(reservations.map((r) => r.hospital || "미지정"));
    return Array.from(s).sort();
  }, [reservations]);

  const columnData = useMemo(() => {
    return hospitals.map((hospital) => {
      const items = reservations.filter((r) => (r.hospital || "미지정") === hospital);
      const positioned = buildColumnPositions(items);
      const contentH = positioned.length > 0
        ? Math.max(...positioned.map((p) => p.top + CARD_HEIGHT + 4))
        : 0;
      return { hospital, items, positioned, contentH };
    });
  }, [hospitals, reservations]);

  const baseH = TOTAL_HOURS * HOUR_HEIGHT;
  const maxH = Math.max(baseH, ...columnData.map((c) => c.contentH));
  const gridRows = Math.ceil(maxH / HOUR_HEIGHT);
  const hours = Array.from({ length: gridRows }, (_, i) => START_HOUR + i);

  const HEADER_H = 48;

  if (hospitals.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 overflow-auto">
        {/* Time column */}
        <div className="sticky left-0 z-10 flex shrink-0 flex-col border-r border-[#edf0f3] bg-white" style={{ width: TIME_COL_W }}>
          <div className="shrink-0 border-b border-[#edf0f3]" style={{ height: HEADER_H }} />
          {Array.from({ length: TOTAL_HOURS }, (_, i) => (
            <div key={i} className="flex items-start justify-center border-b border-[#f1f3f5] pt-1 text-[10px] text-gray-400" style={{ height: HOUR_HEIGHT }}>
              {String(START_HOUR + i).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-gray-400 p-8">
          {dateStr} 예약이 없습니다.
        </div>
      </div>
    );
  }

  return (
    /* Single overflow-auto container — everything scrolls together */
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex" style={{ minWidth: TIME_COL_W + hospitals.length * 200 }}>

        {/* ── Sticky time column ── */}
        <div
          className="sticky left-0 z-10 flex shrink-0 flex-col border-r border-[#edf0f3] bg-white"
          style={{ width: TIME_COL_W }}
        >
          {/* corner spacer matches hospital header height */}
          <div className="shrink-0 border-b border-[#edf0f3]" style={{ height: HEADER_H }} />
          {hours.map((h) => (
            <div
              key={h}
              className="flex items-start justify-center border-b border-[#f1f3f5] pt-1 text-[10px] text-gray-400"
              style={{ height: HOUR_HEIGHT }}
            >
              {h < 24 ? `${String(h).padStart(2, "0")}:00` : ""}
            </div>
          ))}
        </div>

        {/* ── Hospital columns ── */}
        {columnData.map(({ hospital, items, positioned }) => (
          <div
            key={hospital}
            className="flex flex-col border-r border-[#edf0f3]"
            style={{ minWidth: 200, maxWidth: 320, flex: 1 }}
          >
            {/* column header */}
            <div
              className="sticky top-0 z-10 flex shrink-0 items-center justify-center gap-2 border-b border-[#edf0f3] bg-white px-3"
              style={{ height: HEADER_H }}
            >
              <span className="truncate text-sm font-semibold">{hospital}</span>
              <span className="shrink-0 text-xs text-gray-400">{items.length}건</span>
            </div>
            {/* card + grid area */}
            <div className="relative" style={{ height: maxH }}>
              <ScheduleHourGrid rows={gridRows} />
              {positioned.map(({ item, top, col, totalCols }) => (
                <DayCard key={item.id} item={item} top={top} col={col} totalCols={totalCols} onClick={() => onCardClick(item)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
