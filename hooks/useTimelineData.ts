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

const TIMELINE_CACHE_PREFIX = "crm_timeline_";

function getCachedTimelineData(date: string): { reservations: ReservationRecord[]; doctors: DoctorOption[] } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(TIMELINE_CACHE_PREFIX + date);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCachedTimelineData(date: string, reservations: ReservationRecord[], doctors: DoctorOption[]) {
  if (typeof window === "undefined") return;
  // defer off the critical render path to avoid blocking the main thread
  setTimeout(() => {
    try {
      const keysToRemove = Object.keys(sessionStorage).filter(
        (k) => k.startsWith(TIMELINE_CACHE_PREFIX) && k !== TIMELINE_CACHE_PREFIX + date
      );
      keysToRemove.forEach((k) => sessionStorage.removeItem(k));
      sessionStorage.setItem(TIMELINE_CACHE_PREFIX + date, JSON.stringify({ reservations, doctors }));
    } catch {}
  }, 0);
}

export function useTimelineData(
  currentUser: StaffUser | null,
  authReady: boolean,
  selectedDate: string
) {
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [statusColors, setStatusColors] = useState<VisitStatusColorMap>(DEFAULT_VISIT_STATUS_COLORS);
  const [todayMemos, setTodayMemos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [latestLogMap, setLatestLogMap] = useState<Record<string, LogRecord>>({});

  useEffect(() => {
    const cached = getCachedVisitStatusColors();
    if (cached) setStatusColors(cached);
  }, []);

  // Load from cache when date changes — runs before auth check for instant display
  useEffect(() => {
    const cached = getCachedTimelineData(selectedDate);
    if (cached && cached.reservations.length > 0) {
      setReservations(cached.reservations);
      setDoctors(cached.doctors);
      setLoading(false);
    } else {
      setReservations([]);
      setDoctors([]);
      setLoading(true);
    }
  }, [selectedDate]);

  useEffect(() => {
    if (!authReady || !currentUser) return;

    const unsubscribe = subscribeTimelineReservations(
      selectedDate,
      (data) => {
        setReservations(data.reservations || []);
        setDoctors(data.doctors || []);
        setCachedTimelineData(selectedDate, data.reservations || [], data.doctors || []);
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
