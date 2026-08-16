"use client";

type HomeStatsProps = {
  dateLabel: string;
  reservationCount: number;
  nextTime?: string;
  nextName?: string;
  nextType?: string;
  loading?: boolean;
};

export default function HomeStats({
  dateLabel,
  reservationCount,
  nextTime,
  nextName,
  nextType,
  loading = false,
}: HomeStatsProps) {
  return (
    <section className="overflow-hidden rounded-[26px] bg-[linear-gradient(145deg,#061f24_0%,#07383A_48%,#0f655c_100%)] p-5 text-white shadow-[0_18px_50px_rgba(7,56,58,0.20)] lg:p-6">
      <div className="pointer-events-none absolute" />

      <div className="text-xs font-black tracking-[0.12em] text-[#79e5c8]">
        TODAY · {dateLabel}
      </div>

      <div className="mt-4 flex items-end gap-3">
        <div className="text-[48px] font-black leading-none tracking-[-0.08em] lg:text-[56px]">
          {loading ? "-" : reservationCount}
        </div>
        <div className="pb-1.5 text-base font-semibold text-white/70">건의 예약</div>
      </div>

      <div className="mt-5">
        <div className="text-xs font-bold text-white/58">다음 · {nextTime || "--:--"}</div>
        <div className="mt-1.5 text-sm font-semibold leading-5 text-white/82">
          {nextName ? `${nextName} · ${nextType || "예약"}` : "예정된 다음 예약이 없습니다."}
        </div>
      </div>
    </section>
  );
}
