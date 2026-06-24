"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchAllReservationsOnce,
  subscribeAllReservations,
  type DoctorOption,
  type ReservationRecord,
} from "@/lib/reservations";
import {
  DEFAULT_VISIT_STATUS_COLORS,
  getCachedVisitStatusColors,
  getVisitStatusColors,
  type VisitStatusColorMap,
} from "@/lib/settings";
import type { StaffUser } from "@/lib/auth";

const CACHE_KEY = "crm_reservations_v2";
const CACHE_TTL = 5 * 60 * 1000; // 5분

type CacheEntry = { reservations: ReservationRecord[]; doctors: DoctorOption[]; cachedAt: number };

function getCachedData(): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: CacheEntry = JSON.parse(raw);
    if (Date.now() - parsed.cachedAt > CACHE_TTL) return null;
    return parsed;
  } catch { return null; }
}

function setCachedData(reservations: ReservationRecord[], doctors: DoctorOption[]) {
  if (typeof window === "undefined") return;
  setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ reservations, doctors, cachedAt: Date.now() }));
    } catch {}
  }, 0);
}

export function useReservationData(
  currentUser: StaffUser | null,
  authReady: boolean,
  firebaseReady: boolean = false
) {
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [statusColors, setStatusColors] = useState<VisitStatusColorMap>(DEFAULT_VISIT_STATUS_COLORS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = getCachedVisitStatusColors();
    if (cached) setStatusColors(cached);

    const cachedData = getCachedData();
    if (cachedData && cachedData.reservations.length > 0) {
      setReservations(cachedData.reservations);
      setDoctors(cachedData.doctors);
      setLoading(false);
    }
  }, []);

  // Firebase auth 확인 즉시 데이터 fetch 시작 (verify-staff 완료를 기다리지 않음)
  useEffect(() => {
    if (!firebaseReady) return;

    const unsubscribe = subscribeAllReservations(
      (data) => {
        setReservations(data.reservations);
        setDoctors(data.doctors);
        setCachedData(data.reservations, data.doctors);
        setLoading(false);
      },
      (error) => {
        console.error("[subscribeAllReservations]", (error as Error)?.message ?? "");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firebaseReady]);

  useEffect(() => {
    if (!authReady) return;
    getVisitStatusColors()
      .then(setStatusColors)
      .catch(() => setStatusColors(DEFAULT_VISIT_STATUS_COLORS));
  }, [authReady]);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchAllReservationsOnce();
      setReservations(data.reservations);
      setDoctors(data.doctors);
      setCachedData(data.reservations, data.doctors);
    } catch (e) {
      console.error("[useReservationData] refresh error:", e);
    }
  }, []);

  return { reservations, doctors, statusColors, loading, refresh };
}
