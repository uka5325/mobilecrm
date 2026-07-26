"use client";

import { useEffect, useMemo, useState } from "react";
import { type ReservationRecord } from "@/features/reservations/domain/reservationModels";
import { subscribeReservationsByRange } from "@/features/reservations/data/client";
import { useTodayMemosContext } from "@/components/TodayMemosProvider";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { logout } from "@/lib/auth";
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
  const { currentUser } = useCurrentUser();
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
  const displayName = currentUser?.displayName || currentUser?.email || "사용자";
  const roleName = currentUser?.role || "";
  const avatarText = displayName.slice(0, 1).toUpperCase();

  return (
    <div className="mx-auto max-w-[980px] space-y-6">
      <section className="rounded-[28px] bg-white px-5 py-5 shadow-[0_16px_50px_rgba(15,23,42,0.06)] lg:px-7">
        <div className="text-xs font-black tracking-[0.18em] text-[#0f8f83]">MOBILE CRM</div>
        <h1 className="mt-2 text-[28px] font-black tracking-[-0.04em] text-[#12151f] lg:text-[34px]">홈</h1>
        <p className="mt-2 text-sm leading-6 text-[#7b8290]">오늘의 운영 현황을 확인하세요.</p>

        <div className="mt-4 flex min-w-0 flex-nowrap items-center gap-3 overflow-hidden">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0f8f83] text-base font-black text-white">
            {avatarText}
          </div>

          <div className="min-w-0 shrink">
            <div className="truncate text-sm font-black tracking-[-0.03em] text-[#12151f]">{displayName}</div>
            {roleName ? <div className="mt-0.5 truncate text-xs font-semibold text-[#7b8290]">{roleName}</div> : null}
          </div>

          <button
            type="button"
            onClick={() => void logout()}
            className="ml-auto shrink-0 rounded-full border border-[#dfe3e8] px-3.5 py-2 text-xs font-black text-[#4b5563] transition hover:border-[#0f8f83] hover:text-[#0f8f83] active:scale-95"
          >
            로그아웃
          </button>
        </div>
      </section>

      <HomeStats
        dateLabel={todayDisplayString()}
        reservationCount={todayReservations.length}
        nextTime={nextReservation?.reservationTime}
        nextName={nextReservation?.name}
        nextType={nextReservation?.consultArea}
        loading={loading}
      />

      <div className="space-y-6 px-1 lg:px-0">
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
