"use client";

import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  type ReservationRecord,
  type AppointmentType,
  APPOINTMENT_TYPE_COLORS,
} from "@/lib/reservations";
import { todayString } from "@/lib/dateUtils";
import { DetailDrawer } from "@/components/timeline/DetailDrawer";
import { NewReservationDrawer } from "@/components/timeline/NewReservationDrawer";
import { getConferenceMemos, type ConferenceMemo } from "@/lib/settings";
import { useReservationsContext } from "@/components/ReservationsProvider";

type ViewMode = "day" | "week" | "month";

const VIEW_LABELS: Record<ViewMode, string> = {
  day: "일간",
  week: "주간",
  month: "월간",
};

function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(s: string, days: number) {
  const d = parseDate(s);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function getWeekStart(dateStr: string) {
  const d = parseDate(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

function getMonthStart(dateStr: string) {
  const [y, m] = dateStr.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function getMonthEnd(dateStr: string) {
  const [y, m] = dateStr.split("-").map(Number);
  const last = new Date(y, m, 0);
  return formatDate(last);
}

function formatDayLabel(dateStr: string) {
  const d = parseDate(dateStr);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

function isToday(dateStr: string) {
  return dateStr === todayString();
}

function formatLog(updatedBy: unknown, updatedAt: unknown): string {
  const name = typeof updatedBy === "string" ? updatedBy.trim() : "";
  let dateStr = "";
  if (updatedAt) {
    try {
      // toSerializable converts Firestore Timestamp to milliseconds (number)
      const ms =
        typeof updatedAt === "number"
          ? updatedAt
          : typeof (updatedAt as { toMillis?: () => number }).toMillis === "function"
          ? (updatedAt as { toMillis: () => number }).toMillis()
          : Number(updatedAt);
      if (ms && ms > 0) {
        const d = new Date(ms);
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        const hh = String(d.getHours()).padStart(2, "0");
        const min = String(d.getMinutes()).padStart(2, "0");
        dateStr = `${mm}/${dd} ${hh}:${min}`;
      }
    } catch {
      // ignore
    }
  }
  return [name, dateStr].filter(Boolean).join(" · ");
}

const HOUR_HEIGHT = 72; // px per hour
const START_HOUR = 8;
const END_HOUR = 22;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const TIME_COL_W = 52; // px width of time label column
const CARD_HEIGHT = HOUR_HEIGHT - 6;
const WEEK_CARD_H = 20; // compact height for week view

function timeToMinutes(time: string) {
  if (!time) return START_HOUR * 60;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

function minutesToPx(minutes: number) {
  return ((minutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
}

function getAppointmentColor(type: AppointmentType | string) {
  return APPOINTMENT_TYPE_COLORS[type as AppointmentType] || "#6b7280";
}

// ─── useScheduleData ─────────────────────────────────────────────────────────
// 예약 데이터는 전역 단일 구독(ReservationsProvider)에서 공유받고(#3),
// 여기서는 보고 있는 날짜 범위로만 필터한다. 실시간 갱신은 그대로 유지된다.
function useScheduleData(startDate: string, endDate: string) {
  const { reservations: allReservations, loading, refresh } = useReservationsContext();

  const reservations = useMemo(
    () => allReservations.filter((r) => r.reservationDate >= startDate && r.reservationDate <= endDate),
    [allReservations, startDate, endDate]
  );

  return { reservations, loading, refresh };
}

// ─── DayCard ─────────────────────────────────────────────────────────────────
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

// ─── buildColumnPositions ─────────────────────────────────────────────────────
// Places overlapping cards side-by-side in columns instead of stacking vertically.
function buildColumnPositions(items: ReservationRecord[], cardH = CARD_HEIGHT) {
  const sorted = [...items].sort((a, b) =>
    timeToMinutes(a.reservationTime || "00:00") - timeToMinutes(b.reservationTime || "00:00")
  );
  const placed: { item: ReservationRecord; top: number; bottom: number; col: number }[] = [];
  const columns: number[] = [];

  for (const item of sorted) {
    const top = minutesToPx(timeToMinutes(item.reservationTime || `${START_HOUR}:00`));
    const bottom = top + cardH;
    let col = columns.findIndex((colBottom) => colBottom <= top + 1);
    if (col === -1) { col = columns.length; columns.push(bottom + 2); }
    else columns[col] = bottom + 2;
    placed.push({ item, top, bottom, col });
  }

  return placed.map(({ item, top, bottom, col }) => {
    const overlapping = placed.filter((p) => p.top < bottom && p.bottom > top);
    const totalCols = Math.max(...overlapping.map((p) => p.col + 1));
    return { item, top, col, totalCols };
  });
}

// ─── Hour grid lines (absolute, reusable) ─────────────────────────────────────
function HourGrid({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-b border-[#f1f3f5]"
          style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
        />
      ))}
    </>
  );
}

// ─── DayView ──────────────────────────────────────────────────────────────────
function DayView({
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
              <HourGrid rows={gridRows} />
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

// ─── WeekDayCard (compact for week view) ─────────────────────────────────────
function WeekDayCard({ item, top, col, totalCols, onClick }: { item: ReservationRecord; top: number; col: number; totalCols: number; onClick: () => void }) {
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
        left: `calc(${(col / totalCols) * 100}% + 1px)`,
        width: `calc(${(1 / totalCols) * 100}% - 2px)`,
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

// ─── WeekView ─────────────────────────────────────────────────────────────────
function WeekView({
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
      const positioned = buildColumnPositions(dayItems, WEEK_CARD_H);
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
                <HourGrid rows={gridRows} />
                {positioned.map(({ item, top, col, totalCols }) => (
                  <WeekDayCard key={item.id} item={item} top={top} col={col} totalCols={totalCols} onClick={() => onCardClick(item)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MonthView ────────────────────────────────────────────────────────────────
function MonthView({
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

// ─── SchedulePage ─────────────────────────────────────────────────────────────
export default function SchedulePage() {
  const { currentUser, authReady } = useCurrentUser();
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [baseDate, setBaseDate] = useState(todayString());
  const [detailOpen, setDetailOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<ReservationRecord | null>(null);
  const [todayMemos, setTodayMemos] = useState<ConferenceMemo[]>([]);
  const [memoSectionOpen, setMemoSectionOpen] = useState(true);

  useEffect(() => {
    if (!authReady) return;
    getConferenceMemos(baseDate).then(setTodayMemos).catch(() => setTodayMemos([]));
  }, [baseDate, authReady]);

  const { startDate, endDate } = useMemo(() => {
    if (viewMode === "day") return { startDate: baseDate, endDate: baseDate };
    if (viewMode === "week") {
      const ws = getWeekStart(baseDate);
      return { startDate: ws, endDate: addDays(ws, 6) };
    }
    return { startDate: getMonthStart(baseDate), endDate: getMonthEnd(baseDate) };
  }, [viewMode, baseDate]);

  const { reservations, loading, refresh } = useScheduleData(startDate, endDate);

  const kpi = useMemo(() => {
    const counts: Record<string, number> = { 상담: 0, 수술: 0, 시술: 0, 치료: 0, 경과: 0, 진료: 0, 검진: 0 };
    reservations.forEach((r) => { counts[r.appointmentType || "상담"] = (counts[r.appointmentType || "상담"] || 0) + 1; });
    return counts;
  }, [reservations]);

  function navigate(dir: -1 | 1) {
    if (viewMode === "day") setBaseDate((d) => addDays(d, dir));
    else if (viewMode === "week") setBaseDate((d) => addDays(getWeekStart(d), dir * 7));
    else {
      const [y, m] = baseDate.split("-").map(Number);
      setBaseDate(formatDate(new Date(y, m - 1 + dir, 1)));
    }
  }

  const titleText = useMemo(() => {
    if (viewMode === "day") return formatDayLabel(baseDate);
    if (viewMode === "week") {
      const ws = getWeekStart(baseDate);
      return `${formatDayLabel(ws)} ~ ${formatDayLabel(addDays(ws, 6))}`;
    }
    const [y, m] = baseDate.split("-").map(Number);
    return `${y}년 ${m}월`;
  }, [viewMode, baseDate]);

  return (
    <div className="-mx-6 -mb-6 mt-5 flex h-[calc(100vh-170px)] min-h-[640px] flex-col overflow-hidden rounded-2xl border border-[#edf0f3] bg-white">
      {/* 상단 컨트롤 — 연한 녹색 배너 */}
      <div className="shrink-0 border-b border-[#edf0f3] bg-[#ecfdf5]">
        {/* 1행: 네비게이션 */}
        <div className="flex items-center gap-2 px-4 pt-3">
          <button onClick={() => navigate(-1)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#dfe3e8] bg-white text-gray-500 hover:bg-gray-50">‹</button>
          <button onClick={() => setBaseDate(todayString())} className="h-10 shrink-0 rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm text-gray-600 hover:bg-gray-50">오늘</button>
          <button onClick={() => navigate(1)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#dfe3e8] bg-white text-gray-500 hover:bg-gray-50">›</button>
          <span className="truncate text-sm font-semibold text-gray-800">{titleText}</span>
        </div>
        {/* 2행: 뷰 전환 + 날짜 + 고객등록 */}
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="flex h-10 flex-1 overflow-hidden rounded-xl border border-[#dfe3e8]">
            {(["day", "week", "month"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`h-10 flex-1 text-sm font-medium transition ${viewMode === mode ? "bg-[#1d9e75] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                {VIEW_LABELS[mode]}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={baseDate}
            onChange={(e) => setBaseDate(e.target.value)}
            className="h-10 shrink-0 appearance-none rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm text-gray-700 focus:border-[#1d9e75] focus:outline-none"
          />
          <button
            onClick={() => setNewOpen(true)}
            className="h-10 shrink-0 rounded-xl bg-black px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
          >
            + 예약 추가
          </button>
        </div>

        {/* KPI 바 (가로 스크롤) */}
        <div className="flex items-center gap-3 overflow-x-auto px-4 pb-3 [&::-webkit-scrollbar]:hidden">
          <span className="shrink-0 text-xs text-gray-500">전체 {reservations.length}건</span>
          {(["상담", "수술", "시술", "치료", "경과", "진료", "검진"] as AppointmentType[]).map((type) => (
            <div key={type} className="flex shrink-0 items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: APPOINTMENT_TYPE_COLORS[type] }} />
              <span className="text-xs text-gray-600">{type} {kpi[type] || 0}</span>
            </div>
          ))}
          {loading && <span className="ml-auto shrink-0 animate-pulse text-xs text-gray-400">로딩 중...</span>}
        </div>
      </div>

      {/* 오늘의 메모 */}
      <div className="shrink-0 border-b border-[#edf0f3]">
        <button
          onClick={() => setMemoSectionOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-5 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
        >
          <span className="font-semibold">📝 {baseDate === todayString() ? "오늘의 메모" : `${baseDate} 메모`}</span>
          {todayMemos.length > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{todayMemos.length}</span>
          )}
          <span className="ml-auto text-gray-300">{memoSectionOpen ? "▲" : "▼"}</span>
        </button>
        {memoSectionOpen && (
          <div className="flex gap-2 overflow-x-auto px-5 pb-2">
            {todayMemos.length === 0 ? (
              <span className="text-xs text-gray-400">오늘 등록된 메모가 없습니다.</span>
            ) : (
              todayMemos.map((memo) => (
                <div key={memo.id} className="min-w-[180px] max-w-[280px] shrink-0 rounded-lg bg-amber-50 px-3 py-1.5 text-xs">
                  <div className="font-medium text-gray-800 line-clamp-2">{memo.memoText}</div>
                  <div className="mt-0.5 text-[10px] text-gray-400">{memo.createdByName || memo.createdBy}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 뷰 */}
      {viewMode === "day" && (
        <DayView dateStr={baseDate} reservations={reservations} onCardClick={(item) => { setSelectedReservation(item); setDetailOpen(true); }} />
      )}
      {viewMode === "week" && (
        <WeekView weekStart={getWeekStart(baseDate)} reservations={reservations} onCardClick={(item) => { setSelectedReservation(item); setDetailOpen(true); }} />
      )}
      {viewMode === "month" && (
        <MonthView
          monthStart={getMonthStart(baseDate)}
          reservations={reservations}
          onDayClick={(d) => { setBaseDate(d); setViewMode("day"); }}
          onCardClick={(item) => { setSelectedReservation(item); setDetailOpen(true); }}
        />
      )}

      {currentUser && (
        <DetailDrawer
          open={detailOpen}
          reservation={selectedReservation}
          currentUser={currentUser}
          onClose={() => { setDetailOpen(false); setSelectedReservation(null); }}
          onRefreshLatestLog={async () => {}}
          onRefresh={refresh}
        />
      )}
      {currentUser && (
        <NewReservationDrawer
          open={newOpen}
          onClose={() => setNewOpen(false)}
          currentUser={currentUser}
          initialDate={baseDate}
          onCreated={refresh}
        />
      )}
    </div>
  );
}
