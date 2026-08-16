"use client";

import type { ReservationRecord } from "@/features/reservations/domain/reservationModels";

type TodayReservationsProps = {
  reservations: ReservationRecord[];
  loading: boolean;
};

function reservationKey(item: ReservationRecord, index: number) {
  return String((item as { id?: string }).id || index);
}

function doctorText(item: ReservationRecord) {
  const doctors = (item as { doctors?: string[] }).doctors;
  if (!Array.isArray(doctors) || doctors.length === 0) return "담당자 미지정";
  return doctors.join(", ");
}

export default function TodayReservations({ reservations, loading }: TodayReservationsProps) {
  const visibleReservations = reservations.slice(0, 5);

  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] lg:p-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs font-black tracking-[0.14em] text-[#0f8f83]">SCHEDULE</div>
          <h2 className="mt-2 text-xl font-black tracking-[-0.04em] text-[#12151f]">오늘 예약</h2>
        </div>
        {reservations.length > 5 ? (
          <div className="text-xs font-bold text-[#8b93a1]">+{reservations.length - 5}</div>
        ) : null}
      </div>

      <div className="mt-5 space-y-3">
        {loading && visibleReservations.length === 0 ? (
          <div className="rounded-2xl bg-[#f6f7f5] p-4 text-sm text-[#7b8290]">예약을 불러오는 중...</div>
        ) : visibleReservations.length === 0 ? (
          <div className="rounded-2xl bg-[#f6f7f5] p-4 text-sm text-[#7b8290]">오늘 예약이 없습니다.</div>
        ) : (
          visibleReservations.map((item, index) => (
            <article key={reservationKey(item, index)} className="rounded-2xl bg-[#f6f7f5] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-black text-[#12151f]">
                    {item.reservationTime || "--:--"} · {item.name || "이름 없음"}
                  </div>
                  <div className="mt-1 truncate text-sm text-[#7b8290]">
                    {item.consultArea || "상담항목 미입력"} · {doctorText(item)}
                  </div>
                </div>
                {(item as { surgeryReserved?: boolean }).surgeryReserved ? (
                  <span className="shrink-0 rounded-full bg-[#0f8f83] px-3 py-1 text-xs font-bold text-white">
                    수술예약
                  </span>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
