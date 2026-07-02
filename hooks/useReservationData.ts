"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_VISIT_STATUS_COLORS,
  getCachedVisitStatusColors,
  getVisitStatusColors,
  type VisitStatusColorMap,
} from "@/lib/settings";
import { useReservationsContext } from "@/components/ReservationsProvider";

// 예약 데이터는 전역 단일 구독(ReservationsProvider)에서 공유받는다(#3).
// 이 훅은 그 위에 방문상태 색상(statusColors)만 얹어 고객관리 페이지에 제공한다.
// authReady가 true가 되면 색상 설정을 1회 동기화한다.
export function useReservationData(authReady: boolean) {
  const { reservations, doctors, loading, refresh } = useReservationsContext();
  const [statusColors, setStatusColors] = useState<VisitStatusColorMap>(
    () => getCachedVisitStatusColors() ?? DEFAULT_VISIT_STATUS_COLORS
  );

  useEffect(() => {
    if (!authReady) return;
    getVisitStatusColors()
      .then(setStatusColors)
      .catch(() => setStatusColors(DEFAULT_VISIT_STATUS_COLORS));
  }, [authReady]);

  return { reservations, doctors, statusColors, loading, refresh };
}
