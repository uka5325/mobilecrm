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

export function useReservationData(
  currentUser: StaffUser | null,
  authReady: boolean
) {
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [statusColors, setStatusColors] = useState<VisitStatusColorMap>(
    () => getCachedVisitStatusColors() ?? DEFAULT_VISIT_STATUS_COLORS
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authReady || !currentUser) return;

    setLoading(true);

    getVisitStatusColors()
      .then(setStatusColors)
      .catch(() => setStatusColors(DEFAULT_VISIT_STATUS_COLORS));

    const unsubscribe = subscribeAllReservations(
      (data) => {
        setReservations(data.reservations);
        setDoctors(data.doctors);
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
