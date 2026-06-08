"use client";

import { useEffect, useState } from "react";
import {
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

const CACHE_KEY = "crm_reservations_v1";

function getCachedData(): { reservations: ReservationRecord[]; doctors: DoctorOption[] } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCachedData(reservations: ReservationRecord[], doctors: DoctorOption[]) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ reservations, doctors }));
  } catch {}
}

export function useReservationData(
  currentUser: StaffUser | null,
  authReady: boolean
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

  useEffect(() => {
    if (!authReady || !currentUser) return;

    getVisitStatusColors()
      .then(setStatusColors)
      .catch(() => setStatusColors(DEFAULT_VISIT_STATUS_COLORS));

    const unsubscribe = subscribeAllReservations(
      (data) => {
        setReservations(data.reservations);
        setDoctors(data.doctors);
        setCachedData(data.reservations, data.doctors);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        setLoading(false);
        alert("예약 실시간 데이터를 불러오지 못했습니다.");
      }
    );

    return () => unsubscribe();
  }, [authReady, currentUser]);

  return { reservations, doctors, statusColors, loading };
}
