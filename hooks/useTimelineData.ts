"use client";

import { useEffect, useMemo, useState } from "react";
import {
  subscribeTimelineReservations,
  type DoctorOption,
  type ReservationRecord,
} from "@/lib/reservations";
import {
  DEFAULT_VISIT_STATUS_COLORS,
  getCachedVisitStatusColors,
  getConferenceMemos,
  getVisitStatusColors,
  type VisitStatusColorMap,
} from "@/lib/settings";
import { getLatestLogsByReservationIds, type LogRecord } from "@/lib/logs";
import { buildSlotLayouts, getTimelineHeight } from "@/lib/timelineUtils";
import type { StaffUser } from "@/lib/auth";

export function useTimelineData(
  currentUser: StaffUser | null,
  authReady: boolean,
  selectedDate: string
) {
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [statusColors, setStatusColors] = useState<VisitStatusColorMap>(DEFAULT_VISIT_STATUS_COLORS);

  useEffect(() => {
    const cached = getCachedVisitStatusColors();
    if (cached) setStatusColors(cached);
  }, []);
  const [todayMemos, setTodayMemos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [latestLogMap, setLatestLogMap] = useState<Record<string, LogRecord>>(
    {}
  );

  useEffect(() => {
    if (!authReady || !currentUser) return;

    setLoading(true);

    const unsubscribe = subscribeTimelineReservations(
      selectedDate,
      (data) => {
        setReservations(data.reservations || []);
        setDoctors(data.doctors || []);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        setLoading(false);
        alert("타임라인 실시간 데이터를 불러오지 못했습니다.");
      }
    );

    return () => unsubscribe();
  }, [authReady, currentUser, selectedDate]);

  useEffect(() => {
    if (!authReady || !currentUser) return;

    getVisitStatusColors()
      .then(setStatusColors)
      .catch(() => setStatusColors(DEFAULT_VISIT_STATUS_COLORS));

    getConferenceMemos(selectedDate, 10)
      .then((memos) =>
        setTodayMemos(memos.map((m) => m.memoText).filter(Boolean))
      )
      .catch(() => setTodayMemos([]));
  }, [authReady, currentUser, selectedDate]);

  const dayReservations = useMemo(
    () => reservations.filter((item) => item.reservationDate === selectedDate),
    [reservations, selectedDate]
  );

  const slotLayouts = useMemo(
    () => buildSlotLayouts(doctors, dayReservations),
    [doctors, dayReservations]
  );

  const timelineHeight = useMemo(
    () => getTimelineHeight(slotLayouts),
    [slotLayouts]
  );

  useEffect(() => {
    if (!authReady || !currentUser) return;

    const ids = dayReservations
      .flatMap((item) => [item.reservationId, item.id])
      .filter(Boolean);

    if (!ids.length) {
      setLatestLogMap({});
      return;
    }

    getLatestLogsByReservationIds(ids)
      .then(setLatestLogMap)
      .catch(() => setLatestLogMap({}));
  }, [authReady, currentUser, dayReservations]);

  return {
    reservations,
    doctors,
    statusColors,
    todayMemos,
    loading,
    dayReservations,
    slotLayouts,
    timelineHeight,
    latestLogMap,
    setLatestLogMap,
  };
}
