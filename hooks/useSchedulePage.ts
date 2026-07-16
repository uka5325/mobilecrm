"use client";

import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  subscribeReservationsByRange,
  type ReservationRecord,
} from "@/lib/reservations";
import { todayString } from "@/lib/dateUtils";
import { getConferenceMemos, type ConferenceMemo } from "@/lib/settings";
import {
  addDays,
  formatDate,
  formatDayLabel,
  getMonthEnd,
  getMonthStart,
  getWeekStart,
} from "@/lib/scheduleDates";
import { SCHEDULE_APPOINTMENT_TYPES } from "@/lib/scheduleLayout";

export type ViewMode = "day" | "week" | "month";

// ─── useScheduleData ─────────────────────────────────────────────────────────
// 화면별 필요한 범위만 조회: 보고 있는 날짜 범위[startDate,endDate]만 실시간 구독한다.
// (기존: 전역 45일 구독을 메모리 필터 → 범위 구독으로 전환. 범위 변경 시 재구독.)
function useScheduleData(startDate: string, endDate: string) {
  const [state, setState] = useState<{ reservations: ReservationRecord[]; loading: boolean }>(
    { reservations: [], loading: true }
  );

  useEffect(() => {
    // 범위 변경 시엔 이전 데이터를 유지하다 새 스냅샷이 오면 교체(플리커 방지).
    // 초기 로딩만 loading=true(초기 state)로 표시된다.
    const unsub = subscribeReservationsByRange(
      startDate,
      endDate,
      (data) => setState({ reservations: data.reservations, loading: false }),
      () => setState((s) => ({ ...s, loading: false }))
    );
    return () => unsub();
  }, [startDate, endDate]);

  return { reservations: state.reservations, loading: state.loading };
}

export function useSchedulePage() {
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

  const { reservations, loading } = useScheduleData(startDate, endDate);

  const kpi = useMemo(() => {
    const counts: Record<string, number> = SCHEDULE_APPOINTMENT_TYPES.reduce(
      (acc, type) => { acc[type] = 0; return acc; },
      {} as Record<string, number>
    );
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

  function openDetail(item: ReservationRecord) {
    setSelectedReservation(item);
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
    setSelectedReservation(null);
  }

  function handleDayClick(dateStr: string) {
    setBaseDate(dateStr);
    setViewMode("day");
  }

  return {
    currentUser,
    // view state
    viewMode,
    setViewMode,
    baseDate,
    setBaseDate,
    titleText,
    navigate,
    goToday: () => setBaseDate(todayString()),
    weekStart: getWeekStart(baseDate),
    monthStart: getMonthStart(baseDate),
    // data
    reservations,
    loading,
    kpi,
    // detail drawer
    detailOpen,
    selectedReservation,
    openDetail,
    closeDetail,
    // new reservation drawer
    newOpen,
    openNew: () => setNewOpen(true),
    closeNew: () => setNewOpen(false),
    // memos
    todayMemos,
    memoSectionOpen,
    toggleMemoSection: () => setMemoSectionOpen((v) => !v),
    // month → day
    handleDayClick,
  };
}
