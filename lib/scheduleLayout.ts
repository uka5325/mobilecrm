import {
  type AppointmentType,
  APPOINTMENT_TYPE_COLORS,
  type ReservationRecord,
} from "@/lib/reservations";

// 스케줄 타임그리드 레이아웃 상수/헬퍼 — 일간·주간 뷰가 공유한다.

export const HOUR_HEIGHT = 72; // px per hour
export const START_HOUR = 8;
export const END_HOUR = 22;
export const TOTAL_HOURS = END_HOUR - START_HOUR;
export const TIME_COL_W = 52; // px width of time label column
export const CARD_HEIGHT = HOUR_HEIGHT - 6;
export const WEEK_CARD_H = 20; // compact height for week view

// KPI 바 / 색상 범례에서 쓰는 예약 유형 표시 순서.
export const SCHEDULE_APPOINTMENT_TYPES: AppointmentType[] = [
  "상담",
  "수술",
  "시술",
  "치료",
  "경과",
  "진료",
  "검진",
];

export function timeToMinutes(time: string) {
  if (!time) return START_HOUR * 60;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minutesToPx(minutes: number) {
  return ((minutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
}

export function getAppointmentColor(type: AppointmentType | string) {
  return APPOINTMENT_TYPE_COLORS[type as AppointmentType] || "#6b7280";
}

// Places overlapping cards side-by-side in columns instead of stacking vertically.
export function buildColumnPositions(items: ReservationRecord[], cardH = CARD_HEIGHT) {
  const sorted = [...items].sort((a, b) =>
    timeToMinutes(a.reservationTime || "00:00") - timeToMinutes(b.reservationTime || "00:00")
  );
  const placed: { item: ReservationRecord; top: number; bottom: number; col: number }[] = [];
  const columns: number[] = [];

  for (const item of sorted) {
    const top = minutesToPx(timeToMinutes(item.reservationTime || `${START_HOUR}:00`));
    const bottom = top + cardH;
    let col = columns.findIndex((colBottom) => colBottom <= top + 1);
    if (col === -1) { col = columns.length; columns.push(bottom + 2); }
    else columns[col] = bottom + 2;
    placed.push({ item, top, bottom, col });
  }

  return placed.map(({ item, top, bottom, col }) => {
    const overlapping = placed.filter((p) => p.top < bottom && p.bottom > top);
    const totalCols = Math.max(...overlapping.map((p) => p.col + 1));
    return { item, top, col, totalCols };
  });
}
