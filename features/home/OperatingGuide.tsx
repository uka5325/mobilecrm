"use client";

const guides = [
  "스케줄에서 상담·수술·치료 일정을 확인합니다.",
  "고객관리에서 예약 수정, 로그, 결제 기록을 확인합니다.",
  "인보이스와 커미션은 더보기 메뉴에서 확인합니다.",
];

export default function OperatingGuide() {
  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)] lg:p-6">
      <h2 className="text-xl font-black tracking-[-0.04em] text-[#12151f]">운영 안내</h2>

      <div className="mt-5 space-y-3">
        {guides.map((guide, index) => (
          <div key={guide} className="flex items-center gap-4 rounded-[24px] border border-[#e5e9ed] bg-white px-4 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#e8f5f2] text-sm font-black text-[#0f8f83]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <p className="text-sm leading-6 text-[#4b5563]">{guide}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
