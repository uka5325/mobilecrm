"use client";

import { useEffect, useMemo, useState } from "react";
import { type ReservationRecord } from "@/features/reservations/domain/reservationModels";
import { subscribeReservationsByRange } from "@/features/reservations/data/client";
import { useTodayMemosContext } from "@/components/TodayMemosProvider";
import { todayString, toDate } from "@/lib/dateUtils";
import HomeStats from "./HomeStats";
import TodayMemo from "./TodayMemo";
import OperatingGuide from "./OperatingGuide";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function todayDisplayString() {
  const d = new Date();

  return (
    d.getFullYear() +
    "." +
    String(d.getMonth() + 1).padStart(2, "0") +
    "." +
    String(d.getDate()).padStart(2, "0") +
    " (" +
    WEEKDAYS[d.getDay()] +
    ")"
  );
}

function normalizeDate(value: string) {
  const raw = String(value || "").trim();

  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const match = raw.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/);

  if (match) {
    return (
      match[1] +
      "-" +
      String(match[2]).padStart(2, "0") +
      "-" +
      String(match[3]).padStart(2, "0")
    );
  }

  return raw;
}

function isTodayReservation(item: ReservationRecord) {
  return normalizeDate(item.reservationDate) === todayString();
}

function formatMemoTime(value: unknown) {
  const date = toDate(value);

  if (!date) return "";

  return (
    String(date.getMonth() + 1).padStart(2, "0") +
    "." +
    String(date.getDate()).padStart(2, "0") +
    " " +
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0")
  );
}

function sortByReservationTime(a: ReservationRecord, b: ReservationRecord) {
  return String(a.reservationTime || "").localeCompare(String(b.reservationTime || ""));
}

export default function HomePage() {
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const { memos: todayMemos, loading: memoLoading, refresh: refreshTodayMemos } = useTodayMemosContext();

  useEffect(() => {
    const today = todayString();
    const unsub = subscribeReservationsByRange(
      today,
      today,
      (data) => {
        setReservations(data.reservations);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, []);

  const todayReservations = useMemo(() => {
    return reservations.filter(isTodayReservation).sort(sortByReservationTime);
  }, [reservations]);

  const nextReservation = todayReservations[0];

  return (
    <div className="w-full space-y-6">
      <HomeStats
        dateLabel={todayDisplayString()}
        reservationCount={todayReservations.length}
        nextTime={nextReservation?.reservationTime}
        nextName={nextReservation?.name}
        nextType={nextReservation?.consultArea}
        loading={loading}
      />

      <div className="space-y-6">
        <TodayMemo
          memos={todayMemos}
          loading={memoLoading}
          onRefresh={refreshTodayMemos}
          formatTime={formatMemoTime}
        />

        <OperatingGuide />
      </div>
    </div>
  );
}
