import { HOUR_HEIGHT } from "@/lib/scheduleLayout";

// 타임그리드 시간별 가로 구분선 — 일간·주간 뷰가 카드 영역 배경으로 재사용한다.
export function ScheduleHourGrid({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-b border-[#f1f3f5]"
          style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
        />
      ))}
    </>
  );
}
