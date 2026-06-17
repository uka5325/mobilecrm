"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import {
  getTimelineReservations,
  type ReservationRecord,
} from "@/lib/reservations";
import { getStaffByUid, listenCurrentUser } from "@/lib/auth";
import type { StaffUser } from "@/lib/auth";
import { getConferenceMemos, type ConferenceMemo } from "@/lib/settings";
import { todayString } from "@/lib/dateUtils";
import { toDate } from "@/lib/settingsUtils";

function todayDisplayString() {
  const d = new Date();

  return (
    d.getFullYear() +
    "." +
    String(d.getMonth() + 1).padStart(2, "0") +
    "." +
    String(d.getDate()).padStart(2, "0")
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
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0")
  );
}

const ROLE_LIST = ["admin", "doctor", "coordinator", "staff", "interpreter"];

export default function HomePage() {
  const router = useRouter();

  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [todayMemos, setTodayMemos] = useState<ConferenceMemo[]>([]);

  const [loading, setLoading] = useState(true);
  const [memoLoading, setMemoLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const unsubscribe = listenCurrentUser(async (user: User | null) => {
      if (!user) return;

      const staff = await getStaffByUid(user.uid);
      if (staff) setCurrentUser(staff);
    });

    return () => unsubscribe();
  }, []);

  async function loadData() {
    setLoading(true);

    try {
      const data = await getTimelineReservations(todayString());
      setReservations(data.reservations || []);
    } catch (error) {
      console.error(error);
      setLoadError("홈 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function loadTodayMemos() {
    setMemoLoading(true);

    try {
      const list = await getConferenceMemos(todayString(), 10);
      setTodayMemos(list);
    } catch (error) {
      console.error("오늘의 메모를 불러오지 못했습니다.", error);
      setTodayMemos([]);
    } finally {
      setMemoLoading(false);
    }
  }

  async function refreshHome() {
    await Promise.all([loadData(), loadTodayMemos()]);
  }

  useEffect(() => {
    refreshHome();
  }, []);

  const todayReservations = useMemo(() => {
    return reservations.filter(isTodayReservation);
  }, [reservations]);

  const todayVisitors = useMemo(() => {
    return todayReservations.filter(
      (r) => r.operationStatus && r.operationStatus !== "내원전" && r.operationStatus !== "부도"
    ).length;
  }, [todayReservations]);

  return (
    <div className="space-y-[18px]">
      {loadError && (
        <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{loadError}</div>
      )}
      <div className="grid min-h-0 grid-cols-1 gap-[18px] xl:grid-cols-[1.4fr_1fr]">
        <section className="min-w-0">
          {/* 2×2 grid — all 4 boxes same size on every breakpoint */}
          <div className="mb-[18px] grid grid-cols-2 gap-3">
            {/* TODAY OVERVIEW */}
            <div className="flex flex-col justify-center rounded-[12px] border border-black/10 bg-white px-5 py-4 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <div className="text-xs font-bold text-[#1d9e75]">TODAY OVERVIEW</div>
              <div className="mt-1.5 text-xs leading-5 text-[#6b7280]">홈 화면에서는 오늘의 현황을 간단히 보여 줍니다.</div>
            </div>

            {/* 오늘 날짜 */}
            <div className="flex flex-col justify-center rounded-[12px] border border-black/10 bg-white p-[18px] shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <div className="mb-2.5 text-xs text-[#6b7280]">오늘 날짜</div>
              <div className="text-[22px] font-bold text-[#1a1a1a]">
                {todayDisplayString()}
              </div>
            </div>

            {/* 오늘 예약 */}
            <div className="flex flex-col justify-center rounded-[12px] border border-black/10 bg-white p-[18px] shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <div className="mb-2.5 text-xs text-[#6b7280]">오늘 예약</div>
              <div className="text-[26px] font-bold text-[#1a1a1a]">
                {loading ? "-" : todayReservations.length}
              </div>
            </div>

            {/* 오늘 내원자 */}
            <div className="flex flex-col justify-center rounded-[12px] border border-black/10 bg-white p-[18px] shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <div className="mb-2.5 text-xs text-[#6b7280]">오늘 내원자</div>
              <div className="text-[26px] font-bold text-[#1d9e75]">
                {loading ? "-" : todayVisitors}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-[18px]">
            <div className="min-h-[174px] rounded-[12px] border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <div>
                  <div className="mb-1 text-[15px] font-bold text-[#1a1a1a]">
                    오늘의 전체 메모
                  </div>
                  <div className="text-xs leading-6 text-[#6b7280]">
                    오늘 표시되는 전체 운영 메모입니다.
                  </div>
                </div>

                <button
                  onClick={loadTodayMemos}
                  className="shrink-0 rounded-[8px] border border-black/10 bg-[#f9fafb] px-3 py-2 text-xs text-[#6b7280] transition hover:bg-gray-100 active:scale-95"
                >
                  새로고침
                </button>
              </div>

              <div className="flex flex-col gap-[9px]">
                {memoLoading ? (
                  <div className="rounded-[8px] border border-black/10 bg-[#f9fafb] p-3 text-xs leading-6 text-[#6b7280]">
                    메모를 불러오는 중...
                  </div>
                ) : todayMemos.length === 0 ? (
                  <div className="rounded-[8px] border border-black/10 bg-[#f9fafb] p-3 text-xs leading-6 text-[#6b7280]">
                    등록된 메모가 없습니다.
                  </div>
                ) : (
                  todayMemos.map((memo) => {
                    const memoTime = formatMemoTime(memo.createdAt);

                    return (
                      <div
                        key={memo.id}
                        className="rounded-[8px] border border-emerald-100 bg-emerald-50 p-3 text-xs leading-6 text-emerald-800"
                      >
                        <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-emerald-600">
                          <span>{memo.createdByName || "시스템"}</span>
                          {memoTime ? <span>{memoTime}</span> : null}
                        </div>

                        <div className="whitespace-pre-line">
                          {memo.memoText}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 빠른 실행 — PC only (mobile shows in shared 2-col row below) */}
            <div className="hidden xl:block rounded-[12px] border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <div className="mb-2.5 text-[15px] font-bold text-[#1a1a1a]">빠른 실행</div>
              <div className="text-xs leading-6 text-[#6b7280]">자주 사용하는 작업으로 바로 이동할 수 있습니다.</div>
              <div className="mt-3.5 flex flex-wrap gap-2">
                <button onClick={() => router.push("/schedule")} className="rounded-[8px] border border-[#1d9e75] bg-[#1d9e75] px-3.5 py-2.5 text-xs text-white">스케줄 열기</button>
                <button onClick={() => router.push("/reservations")} className="rounded-[8px] border border-black/10 bg-[#f9fafb] px-3.5 py-2.5 text-xs text-[#1a1a1a]">예약관리</button>
                <button onClick={() => router.push("/dashboard")} className="rounded-[8px] border border-black/10 bg-[#f9fafb] px-3.5 py-2.5 text-xs text-[#1a1a1a]">KPI 확인</button>
              </div>
            </div>
          </div>
        </section>

        <section className="min-w-0">
          {/* 현재 로그인 권한 — PC only (mobile shows in shared 2-col row below) */}
          <div className="hidden xl:block mb-[18px] rounded-[12px] border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
            <div className="mb-2.5 text-[15px] font-bold text-[#1a1a1a]">현재 로그인 권한</div>
            <div className="text-xs leading-6 text-[#6b7280]">로그인된 계정의 권한에 따라 접근 가능한 기능이 달라집니다.</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {ROLE_LIST.map((role) => {
                const active = currentUser?.role === role;
                return (
                  <span key={role} className={`rounded-[5px] border px-[9px] py-[5px] text-[11px] ${active ? "border-[#1d9e75] bg-[#1d9e75] font-bold text-white" : "border-black/10 bg-[#f3f4f6] text-[#6b7280]"}`}>{role}</span>
                );
              })}
            </div>
          </div>

          <div className="rounded-[12px] border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
            <div className="mb-2.5 text-[15px] font-bold text-[#1a1a1a]">
              운영 안내
            </div>

            <div className="mt-3 flex flex-col gap-2.5">
              <div className="rounded-[8px] border border-black/10 bg-[#f9fafb] p-3 text-xs leading-6 text-[#6b7280]">
                스케줄에서 일·주·월 단위로 상담·수술·치료·경과 일정을 확인할 수 있습니다.
              </div>

              <div className="rounded-[8px] border border-black/10 bg-[#f9fafb] p-3 text-xs leading-6 text-[#6b7280]">
                예약 정보 수정, 메모, 로그 확인은 예약 상세 팝업에서 가능합니다.
              </div>

              <div className="rounded-[8px] border border-black/10 bg-[#f9fafb] p-3 text-xs leading-6 text-[#6b7280]">
                KPI 대시보드에서 병원별·유형별 통계를 확인할 수 있습니다.
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Mobile only: 빠른 실행 + 현재 로그인 권한 side by side */}
      <div className="grid grid-cols-2 gap-[18px] xl:hidden">
        <div className="rounded-[12px] border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <div className="mb-2.5 text-[15px] font-bold text-[#1a1a1a]">빠른 실행</div>
          <div className="text-xs leading-6 text-[#6b7280]">자주 사용하는 작업으로 바로 이동할 수 있습니다.</div>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <button onClick={() => router.push("/timeline")} className="rounded-[8px] border border-[#1d9e75] bg-[#1d9e75] px-3.5 py-2.5 text-xs text-white">타임라인 열기</button>
            <button onClick={() => router.push("/reservations")} className="rounded-[8px] border border-black/10 bg-[#f9fafb] px-3.5 py-2.5 text-xs text-[#1a1a1a]">예약관리</button>
            <button onClick={() => router.push("/dashboard")} className="rounded-[8px] border border-black/10 bg-[#f9fafb] px-3.5 py-2.5 text-xs text-[#1a1a1a]">KPI 확인</button>
          </div>
        </div>
        <div className="rounded-[12px] border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <div className="mb-2.5 text-[15px] font-bold text-[#1a1a1a]">현재 로그인 권한</div>
          <div className="text-xs leading-6 text-[#6b7280]">로그인된 계정의 권한에 따라 접근 가능한 기능이 달라집니다.</div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ROLE_LIST.map((role) => {
              const active = currentUser?.role === role;
              return (
                <span key={role} className={`rounded-[5px] border px-[9px] py-[5px] text-[11px] ${active ? "border-[#1d9e75] bg-[#1d9e75] font-bold text-white" : "border-black/10 bg-[#f3f4f6] text-[#6b7280]"}`}>{role}</span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
