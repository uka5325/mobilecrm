"use client";

import { useMemo, useRef, useState } from "react";
import { type ReservationRecord, type ReservationStatus } from "@/lib/reservations";
import { getLatestLogsByReservationIds } from "@/lib/logs";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTimelineData } from "@/hooks/useTimelineData";
import { todayString } from "@/lib/dateUtils";
import {
  buildGlobalSlotInfo,
  formatCardLogDate,
  getBirthGenderText,
  getCardStatusForDoctor,
  getReservationDoctors,
  layoutTimelineCards,
} from "@/lib/timelineUtils";
import { getReadableTextColor, getStatusColor } from "@/lib/colorUtils";
import { KpiBox } from "@/components/timeline/KpiBox";
import { DetailDrawer } from "@/components/timeline/DetailDrawer";
import { NewReservationDrawer } from "@/components/timeline/NewReservationDrawer";

const STATUS_LABELS: Record<string, string> = {
  내원전: "내원전",
  대기: "대기",
  원상중: "원상중",
  후상중: "후상중",
  귀가: "귀가",
  부도: "부도",
};

export default function TimelinePage() {

  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const timeScaleRef = useRef<HTMLDivElement | null>(null);

  const { currentUser, authReady } = useCurrentUser();
  const [selectedDate, setSelectedDate] = useState(todayString());

  const {
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
  } = useTimelineData(currentUser, authReady, selectedDate);

  const [detailOpen, setDetailOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [selectedReservation, setSelectedReservation] =
    useState<ReservationRecord | null>(null);

  async function refreshLatestLog(item: ReservationRecord) {
    const ids = [item.reservationId, item.id].filter(Boolean);

    if (!ids.length) return;

    try {
      const map = await getLatestLogsByReservationIds(ids);
      setLatestLogMap((prev) => ({
        ...prev,
        ...map,
      }));
    } catch (error) {
      console.error(error);
    }
  }

  function handleTimelineScroll() {
    const scrollTop = timelineScrollRef.current?.scrollTop || 0;

    if (timeScaleRef.current) {
      timeScaleRef.current.style.transform = `translateY(-${scrollTop}px)`;
    }
  }

  const kpi = useMemo(() => {
    const base = {
      total: dayReservations.length,
      before: 0,
      wait: 0,
      cons: 0,
      post: 0,
      left: 0,
      no: 0,
      surg: 0,
    };

    dayReservations.forEach((item) => {
      if (item.operationStatus === "내원전") base.before += 1;
      if (item.operationStatus === "대기") base.wait += 1;
      if (item.operationStatus === "원상중") base.cons += 1;
      if (item.operationStatus === "후상중") base.post += 1;
      if (item.operationStatus === "귀가") base.left += 1;
      if (item.operationStatus === "부도") base.no += 1;
      if (item.surgeryReserved) base.surg += 1;
    });

    return base;
  }, [dayReservations]);

  const [clickedDoctorName, setClickedDoctorName] = useState<string | undefined>(undefined);

  function openDetail(item: ReservationRecord, doctorName?: string) {
    setSelectedReservation(item);
    setClickedDoctorName(doctorName);
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
    setSelectedReservation(null);
    setClickedDoctorName(undefined);
  }

  function openNewDrawer() {
    setNewOpen(true);
  }

  return (
    <div className="-mx-6 -mb-6 mt-5 flex h-[calc(100vh-170px)] min-h-[640px] flex-col overflow-hidden rounded-2xl border border-[#edf0f3] bg-white">
      <div className="flex shrink-0 flex-col">
        <div className="flex items-start justify-between rounded-t-2xl border-b border-[#edf0f3] bg-[#ecfdf5] px-6 py-3">
          <div className="min-w-0 flex-1 pr-4">
            <div className="mb-1 text-xs font-extrabold text-emerald-700">
              오늘의 메모
            </div>

            <div className="text-sm leading-6 text-emerald-800">
              {todayMemos.length === 0 ? (
                "등록된 메모가 없습니다."
              ) : (
                <div className="space-y-0.5">
                  {todayMemos.map((memo, index) => (
                    <div key={`${memo}-${index}`} className="line-clamp-1">
                      • {memo}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-10 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm transition focus:border-[#1d9e75] focus:outline-none"
            />

            <button
              onClick={openNewDrawer}
              className="h-10 rounded-xl bg-black px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
            >
              신규 예약
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 border-b border-[#edf0f3] bg-white px-6 py-2 md:grid-cols-8">
          <KpiBox label="전체" value={kpi.total} className="bg-gray-100" />
          <KpiBox label="내원전" value={kpi.before} color={statusColors.내원전} />
          <KpiBox label="대기" value={kpi.wait} color={statusColors.대기} />
          <KpiBox label="원상중" value={kpi.cons} color={statusColors.원상중} />
          <KpiBox label="후상중" value={kpi.post} color={statusColors.후상중} />
          <KpiBox label="귀가" value={kpi.left} color={statusColors.귀가} />
          <KpiBox label="부도" value={kpi.no} color={statusColors.부도} />
          <KpiBox
            label="예약"
            value={kpi.surg}
            className="bg-purple-50 text-purple-700"
          />
        </div>

      </div>
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-b-2xl">
          <div className="flex w-16 shrink-0 flex-col border-r border-[#edf0f3] bg-white">
            <div className="flex h-[60px] shrink-0 items-center justify-center border-b border-[#edf0f3] bg-white text-xs font-semibold text-gray-500">
              시간
            </div>

            <div className="flex-1 overflow-hidden">
              <div ref={timeScaleRef} className="will-change-transform">
                {slotLayouts.map((slot) => (
                  <div
                    key={slot.slot}
                    className="flex items-start justify-center border-b border-[#f1f3f5] pt-1.5 text-xs text-gray-400"
                    style={{ height: slot.height }}
                  >
                    {slot.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div
            ref={timelineScrollRef}
            onScroll={handleTimelineScroll}
            className="relative flex-1 overflow-auto bg-white"
          >
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                데이터 로딩 중...
              </div>
            ) : doctors.length === 0 ? (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-gray-400">
                등록된 원장이 없습니다.
              </div>
            ) : (
              <div className="min-w-max">
                <div className="sticky top-0 z-50 flex border-b border-[#edf0f3] bg-white">
                  {doctors.map((doctor, index) => {
                    const count = dayReservations.filter((item) =>
                      getReservationDoctors(item).includes(doctor.displayName)
                    ).length;

                    const colors = [
                      "#1d9e75",
                      "#2563eb",
                      "#8b5cf6",
                      "#f59e0b",
                      "#ef4444",
                    ];

                    return (
                      <div
                        key={doctor.uid}
                        className="flex h-[60px] w-[320px] shrink-0 items-center justify-center gap-2 border-r border-[#edf0f3] bg-white"
                      >
                        <div
                          className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                          style={{
                            background: colors[index % colors.length],
                          }}
                        >
                          {doctor.displayName.charAt(0)}
                        </div>

                        <span className="text-sm font-semibold">
                          {doctor.displayName}
                        </span>

                        <span className="text-xs text-gray-400">{count}명</span>
                      </div>
                    );
                  })}
                </div>

                <div
                  className="relative z-0 flex"
                  style={{ minHeight: timelineHeight }}
                >
                  {(() => {
                    const { rowMap, slotCounts } = buildGlobalSlotInfo(dayReservations);
                    return doctors.map((doctor) => {
                    const doctorReservations = dayReservations.filter((item) =>
                      getReservationDoctors(item).includes(doctor.displayName)
                    );

                    const laidOutReservations = layoutTimelineCards(
                      doctorReservations,
                      slotLayouts,
                      rowMap,
                      slotCounts
                    );

                    return (
                      <div
                        key={doctor.uid}
                        className="relative w-[320px] shrink-0 border-r border-[#edf0f3] bg-white"
                        style={{ height: timelineHeight }}
                      >
                        {slotLayouts.map((slot) => (
                          <div
                            key={`${doctor.uid}-${slot.slot}`}
                            className="border-b border-[#f1f3f5] bg-white"
                            style={{ height: slot.height }}
                          />
                        ))}

                        {laidOutReservations.map(
                          ({ item, top, left, width, height }) => {
                            const status = getCardStatusForDoctor(item, doctor.displayName);
                            const cardColor = getStatusColor(
                              status,
                              statusColors
                            );
                            const cardTextColor =
                              getReadableTextColor(cardColor);

                            const latestLog =
                              latestLogMap[item.reservationId] ||
                              latestLogMap[item.id] ||
                              latestLogMap[item.reservationId || item.id];

                            const infoLine = [
                              item.consultArea || "-",
                              getBirthGenderText(item),
                            ]
                              .filter(Boolean)
                              .join(" · ");

                            return (
                              <button
                                key={`${doctor.uid}-${item.id}`}
                                onClick={() => openDetail(item, doctor.displayName)}
                                className="absolute z-[2] flex overflow-hidden rounded-xl px-2.5 py-2 text-left shadow-[0_3px_10px_rgba(0,0,0,0.12)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.18)] active:scale-[0.99]"
                                style={{
                                  top,
                                  left,
                                  width,
                                  height,
                                  backgroundColor: cardColor,
                                  color: cardTextColor,
                                }}
                              >
                                <div className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate text-[12px] font-bold leading-[15px]">
                                      {item.name}
                                    </span>
                                    <span className="shrink-0 text-[11px] font-semibold leading-[15px] opacity-95">
                                      {item.reservationTime || "시간 미정"}
                                    </span>
                                  </div>

                                  <div className="mt-[3px] truncate text-[11px] font-medium leading-[14px] opacity-95">
                                    {infoLine}
                                  </div>

                                  <div className="mt-[6px] truncate text-[10px] leading-[13px] opacity-90">
                                    {STATUS_LABELS[status] || status}
                                    {latestLog && (
                                      <>
                                        {" "}
                                        · {latestLog.staffName || "시스템"} ·{" "}
                                        {formatCardLogDate(latestLog.createdAt)}
                                      </>
                                    )}
                                    {item.surgeryReserved ? " · 🏥수술" : ""}
                                  </div>
                                </div>
                              </button>
                            );
                          }
                        )}
                      </div>
                    );
                  });
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>

      <DetailDrawer
        open={detailOpen}
        reservation={selectedReservation}
        doctors={doctors}
        currentUser={currentUser!}
        statusColors={statusColors}
        clickedDoctorName={clickedDoctorName}
        onClose={closeDetail}
        onRefreshLatestLog={refreshLatestLog}
      />

      <NewReservationDrawer
        open={newOpen}
        onClose={() => setNewOpen(false)}
        doctors={doctors}
        currentUser={currentUser!}
        initialDate={selectedDate}
      />

    </div>
  );
}

