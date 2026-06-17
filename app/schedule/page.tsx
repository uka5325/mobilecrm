"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, query, where, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  type ReservationRecord,
  type AppointmentType,
  APPOINTMENT_TYPE_COLORS,
  mapReservationDoc,
} from "@/lib/reservations";
import { todayString } from "@/lib/dateUtils";
import { DetailDrawer } from "@/components/timeline/DetailDrawer";
import { NewReservationDrawer } from "@/components/timeline/NewReservationDrawer";
import { getBirthGenderText } from "@/lib/timelineUtils";
import type { DoctorOption } from "@/lib/reservations";
import type { VisitStatusColorMap } from "@/lib/settings";
import { getVisitStatusColors } from "@/lib/settings";

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

const HOUR_HEIGHT = 64;
const START_HOUR = 8;
const END_HOUR = 22;
const TOTAL_HOURS = END_HOUR - START_HOUR;

function timeToMinutes(time: string) {
  if (!time) return 0;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

function minutesToPx(minutes: number) {
  const offsetMinutes = minutes - START_HOUR * 60;
  return (offsetMinutes / 60) * HOUR_HEIGHT;
}

function getAppointmentColor(type: AppointmentType | string) {
  return APPOINTMENT_TYPE_COLORS[type as AppointmentType] || "#6b7280";
}

function useScheduleData(startDate: string, endDate: string) {
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = query(
      collection(db, "reservations"),
      where("reservationDate", ">=", startDate),
      where("reservationDate", "<=", endDate),
      orderBy("reservationDate"),
    );

    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((d) => mapReservationDoc(d.id, d.data() as Record<string, unknown>))
        .filter((r) => !r.isDeleted);
      setReservations(rows);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [startDate, endDate]);

  return { reservations, loading };
}

function DayCard({ item, onClick }: { item: ReservationRecord; onClick: () => void }) {
  const color = getAppointmentColor(item.appointmentType);
  const time = item.reservationTime || "";
  const minutes = timeToMinutes(time);
  const top = minutesToPx(minutes);
  const height = Math.max(HOUR_HEIGHT * 0.8, 52);
  const info = getBirthGenderText(item);

  return (
    <button
      onClick={onClick}
      className="absolute left-1 right-1 overflow-hidden rounded-lg px-2 py-1.5 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]"
      style={{ top, height, backgroundColor: color, opacity: item.completed ? 0.6 : 1 }}
    >
      <div className="flex items-center gap-1 text-[11px] font-bold leading-tight">
        <span className="truncate">{item.name}</span>
        {time && <span className="shrink-0 opacity-90">{time}</span>}
      </div>
      {info && <div className="mt-0.5 truncate text-[10px] opacity-90">{info}</div>}
      {item.hospital && <div className="mt-0.5 truncate text-[10px] opacity-85">{item.hospital}</div>}
      {item.completed && <div className="mt-0.5 text-[9px] opacity-80">✓ 완료</div>}
    </button>
  );
}

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
    const set = new Set(reservations.map((r) => r.hospital || "미지정"));
    return Array.from(set).sort();
  }, [reservations]);

  if (hospitals.length === 0) {
    const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i);
    return (
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-b-2xl">
        <div className="flex w-16 shrink-0 flex-col border-r border-[#edf0f3]">
          <div className="h-[48px] shrink-0 border-b border-[#edf0f3]" />
          {hours.map((h) => (
            <div key={h} className="flex items-start justify-center border-b border-[#f1f3f5] pt-1 text-xs text-gray-400" style={{ height: HOUR_HEIGHT }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-gray-400 p-8">
          {dateStr} 예약이 없습니다.
        </div>
      </div>
    );
  }

  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i);

  return (
    <div className="flex min-h-0 flex-1 overflow-auto rounded-b-2xl">
      <div className="flex w-16 shrink-0 flex-col border-r border-[#edf0f3] bg-white">
        <div className="h-[48px] shrink-0 border-b border-[#edf0f3]" />
        {hours.map((h) => (
          <div key={h} className="flex items-start justify-center border-b border-[#f1f3f5] pt-1 text-xs text-gray-400" style={{ height: HOUR_HEIGHT }}>
            {String(h).padStart(2, "0")}:00
          </div>
        ))}
      </div>

      <div className="flex flex-1 overflow-x-auto">
        {hospitals.map((hospital) => {
          const items = reservations.filter((r) => (r.hospital || "미지정") === hospital);
          return (
            <div key={hospital} className="flex flex-col border-r border-[#edf0f3]" style={{ minWidth: 200, width: `${Math.max(200, Math.floor(100 / hospitals.length))}%`, maxWidth: 320 }}>
              <div className="flex h-[48px] shrink-0 items-center justify-center gap-2 border-b border-[#edf0f3] bg-white px-3">
                <span className="truncate text-sm font-semibold">{hospital}</span>
                <span className="shrink-0 text-xs text-gray-400">{items.length}건</span>
              </div>
              <div className="relative" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
                {hours.map((h) => (
                  <div key={h} className="border-b border-[#f1f3f5]" style={{ height: HOUR_HEIGHT }} />
                ))}
                {items.map((item) => (
                  <DayCard key={item.id} item={item} onClick={() => onCardClick(item)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i);

  return (
    <div className="flex min-h-0 flex-1 overflow-auto rounded-b-2xl">
      <div className="flex w-14 shrink-0 flex-col border-r border-[#edf0f3] bg-white">
        <div className="h-[52px] shrink-0 border-b border-[#edf0f3]" />
        {hours.map((h) => (
          <div key={h} className="flex items-start justify-center border-b border-[#f1f3f5] pt-1 text-xs text-gray-400" style={{ height: HOUR_HEIGHT }}>
            {String(h).padStart(2, "0")}
          </div>
        ))}
      </div>

      <div className="flex flex-1 overflow-x-auto">
        {days.map((day) => {
          const dayItems = reservations.filter((r) => r.reservationDate === day);
          const today = isToday(day);
          return (
            <div key={day} className="flex flex-col border-r border-[#edf0f3]" style={{ minWidth: 120, flex: 1 }}>
              <div className={`flex h-[52px] shrink-0 flex-col items-center justify-center border-b border-[#edf0f3] ${today ? "bg-emerald-50" : "bg-white"}`}>
                <span className={`text-xs font-bold ${today ? "text-emerald-700" : "text-gray-700"}`}>
                  {formatDayLabel(day)}
                </span>
                <span className={`text-[10px] ${today ? "text-emerald-500" : "text-gray-400"}`}>{dayItems.length}건</span>
              </div>
              <div className="relative" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
                {hours.map((h) => (
                  <div key={h} className="border-b border-[#f1f3f5]" style={{ height: HOUR_HEIGHT }} />
                ))}
                {dayItems.map((item) => (
                  <DayCard key={item.id} item={item} onClick={() => onCardClick(item)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

  const totalCells = 42;
  const cells: string[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(calStart);
    d.setDate(d.getDate() + i);
    cells.push(formatDate(d));
  }

  const today = todayString();
  const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
  const [, cm] = monthStart.split("-").map(Number);

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
          const isCurrentMonth = cellMonth === cm;
          const isLastDay = dateStr === formatDate(lastDay);
          const dayItems = reservations.filter((r) => r.reservationDate === dateStr);
          const shown = dayItems.slice(0, 3);
          const more = dayItems.length - shown.length;

          return (
            <div
              key={dateStr}
              className={`relative border-b border-r border-[#edf0f3] p-1.5 ${!isCurrentMonth ? "bg-gray-50" : "bg-white"} ${dateStr === today ? "ring-2 ring-inset ring-emerald-400" : ""}`}
              onClick={() => onDayClick(dateStr)}
            >
              <div className={`mb-1 text-right text-xs font-semibold ${dateStr === today ? "text-emerald-600" : isCurrentMonth ? "text-gray-700" : "text-gray-300"}`}>
                {parseDate(dateStr).getDate()}
              </div>
              <div className="space-y-0.5">
                {shown.map((item) => (
                  <button
                    key={item.id}
                    onClick={(e) => { e.stopPropagation(); onCardClick(item); }}
                    className="w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-semibold text-white"
                    style={{ backgroundColor: getAppointmentColor(item.appointmentType), opacity: item.completed ? 0.7 : 1 }}
                  >
                    {item.reservationTime && <span className="mr-0.5 opacity-90">{item.reservationTime.slice(0, 5)}</span>}
                    {item.name}
                  </button>
                ))}
                {more > 0 && (
                  <div className="cursor-pointer text-right text-[10px] text-gray-400 hover:text-gray-600">+{more}건</div>
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

export default function SchedulePage() {
  const { currentUser, authReady } = useCurrentUser();
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [baseDate, setBaseDate] = useState(todayString());
  const [detailOpen, setDetailOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<ReservationRecord | null>(null);
  const [statusColors, setStatusColors] = useState<VisitStatusColorMap>({
    내원전: "#6b7280", 대기: "#f59e0b", 원상중: "#2563eb", 후상중: "#14b8a6", 귀가: "#16a34a", 부도: "#dc2626",
  });

  useEffect(() => {
    getVisitStatusColors().then(setStatusColors).catch(() => {});
  }, []);

  const { startDate, endDate } = useMemo(() => {
    if (viewMode === "day") return { startDate: baseDate, endDate: baseDate };
    if (viewMode === "week") {
      const ws = getWeekStart(baseDate);
      return { startDate: ws, endDate: addDays(ws, 6) };
    }
    return { startDate: getMonthStart(baseDate), endDate: getMonthEnd(baseDate) };
  }, [viewMode, baseDate]);

  const { reservations, loading } = useScheduleData(startDate, endDate);

  const kpi = useMemo(() => {
    const counts: Record<string, number> = { 상담: 0, 수술: 0, 치료: 0, 경과: 0 };
    reservations.forEach((r) => {
      const t = r.appointmentType || "상담";
      counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
  }, [reservations]);

  function navigate(dir: -1 | 1) {
    if (viewMode === "day") setBaseDate((d) => addDays(d, dir));
    else if (viewMode === "week") setBaseDate((d) => addDays(getWeekStart(d), dir * 7));
    else {
      const [y, m] = baseDate.split("-").map(Number);
      const next = new Date(y, m - 1 + dir, 1);
      setBaseDate(formatDate(next));
    }
  }

  function openDetail(item: ReservationRecord) {
    setSelectedReservation(item);
    setDetailOpen(true);
  }

  function handleMonthDayClick(dateStr: string) {
    setBaseDate(dateStr);
    setViewMode("day");
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

  const emptyDoctors: DoctorOption[] = [];

  return (
    <div className="-mx-6 -mb-6 mt-5 flex h-[calc(100vh-170px)] min-h-[640px] flex-col overflow-hidden rounded-2xl border border-[#edf0f3] bg-white">
      {/* 상단 컨트롤 */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#edf0f3] bg-white px-5 py-3 gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#edf0f3] text-gray-500 hover:bg-gray-50 active:scale-95">‹</button>
          <button onClick={() => setBaseDate(todayString())} className="h-8 rounded-lg border border-[#edf0f3] px-3 text-xs text-gray-600 hover:bg-gray-50 active:scale-95">오늘</button>
          <button onClick={() => navigate(1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#edf0f3] text-gray-500 hover:bg-gray-50 active:scale-95">›</button>
          <span className="ml-2 text-sm font-semibold text-gray-800">{titleText}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* 뷰 모드 탭 */}
          <div className="flex rounded-lg border border-[#edf0f3] overflow-hidden">
            {(["day", "week", "month"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-xs font-medium transition ${viewMode === mode ? "bg-[#1d9e75] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                {VIEW_LABELS[mode]}
              </button>
            ))}
          </div>

          <input
            type="date"
            value={baseDate}
            onChange={(e) => setBaseDate(e.target.value)}
            className="h-8 rounded-lg border border-[#edf0f3] px-2 text-xs text-gray-700 focus:border-[#1d9e75] focus:outline-none"
          />

          <button
            onClick={() => setNewOpen(true)}
            className="h-8 rounded-lg bg-black px-3 text-xs font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
          >
            + 신규 예약
          </button>
        </div>
      </div>

      {/* KPI 바 */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[#edf0f3] bg-white px-5 py-2">
        <span className="text-xs text-gray-400">전체 {reservations.length}건</span>
        {(["상담", "수술", "치료", "경과"] as AppointmentType[]).map((type) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: APPOINTMENT_TYPE_COLORS[type] }} />
            <span className="text-xs text-gray-600">{type} {kpi[type] || 0}</span>
          </div>
        ))}
        {loading && <span className="ml-auto text-xs text-gray-400 animate-pulse">로딩 중...</span>}
      </div>

      {/* 뷰 영역 */}
      {viewMode === "day" && (
        <DayView
          dateStr={baseDate}
          reservations={reservations}
          onCardClick={openDetail}
        />
      )}

      {viewMode === "week" && (
        <WeekView
          weekStart={getWeekStart(baseDate)}
          reservations={reservations}
          onCardClick={openDetail}
        />
      )}

      {viewMode === "month" && (
        <MonthView
          monthStart={getMonthStart(baseDate)}
          reservations={reservations}
          onDayClick={handleMonthDayClick}
          onCardClick={openDetail}
        />
      )}

      {currentUser && (
        <DetailDrawer
          open={detailOpen}
          reservation={selectedReservation}
          doctors={emptyDoctors}
          currentUser={currentUser}
          statusColors={statusColors}
          clickedDoctorName={undefined}
          onClose={() => { setDetailOpen(false); setSelectedReservation(null); }}
          onRefreshLatestLog={async () => {}}
        />
      )}

      {currentUser && (
        <NewReservationDrawer
          open={newOpen}
          onClose={() => setNewOpen(false)}
          doctors={emptyDoctors}
          currentUser={currentUser}
          initialDate={baseDate}
        />
      )}
    </div>
  );
}
