import type { DoctorOption, ReservationRecord } from "@/lib/reservations";
import { getReservationBirthInfo } from "@/lib/reservationUtils";
import { toDate } from "@/lib/settingsUtils";

export const START_H = 9;
export const END_H = 21;
export const SLOT_H = 80;
const CARD_H = 66;
const CARD_GAP = 6;
const CARD_SIDE_GAP = 8;
const DOCTOR_COL_W = 320;
const SLOT_PADDING_Y = 9;

export type SlotLayout = {
  slot: number;
  label: string;
  top: number;
  height: number;
};

export function normalizeTime(value: string) {
  const raw = String(value || "").trim();
  const m = raw.match(/(\d{1,2}):(\d{2})/);

  if (!m) return "";

  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

export function getMinutes(value: string) {
  const time = normalizeTime(value);
  if (!time) return START_H * 60;

  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function getSlotIndex(value: string) {
  const minutes = getMinutes(value);
  const start = START_H * 60;
  const diff = Math.max(minutes - start, 0);

  return Math.floor(diff / 60);
}

export function getReservationDoctors(item: ReservationRecord) {
  return Array.isArray(item.doctors) ? item.doctors : [];
}

export function getCardStatus(item: ReservationRecord) {
  return item.operationStatus || "내원전";
}

export function buildGlobalSlotInfo(dayReservations: ReservationRecord[]): {
  rowMap: Map<string, number>;
  slotCounts: Map<number, number>;
} {
  const bySlot = new Map<number, ReservationRecord[]>();

  dayReservations.forEach((item) => {
    const slot = getSlotIndex(item.reservationTime || "");
    const list = bySlot.get(slot) || [];
    list.push(item);
    bySlot.set(slot, list);
  });

  const rowMap = new Map<string, number>();
  const slotCounts = new Map<number, number>();

  bySlot.forEach((items, slot) => {
    const unique = [...new Map(items.map((i) => [i.id, i])).values()].sort(
      (a, b) => String(a.name || "").localeCompare(String(b.name || ""))
    );
    slotCounts.set(slot, unique.length);
    unique.forEach((item, idx) => {
      rowMap.set(item.id, idx);
    });
  });

  return { rowMap, slotCounts };
}

export function getBirthGenderText(item: ReservationRecord) {
  const info = getReservationBirthInfo(item);
  return [info.birthDisplay, info.gender].filter(Boolean).join(" · ");
}

export function getBirthGenderNationalityText(item: ReservationRecord) {
  const info = getReservationBirthInfo(item);
  return [info.birthDisplay, info.gender, item.nationality]
    .filter(Boolean)
    .join(" · ");
}

export function buildSlotLayouts(
  _doctors: DoctorOption[],
  dayReservations: ReservationRecord[]
): SlotLayout[] {
  const countsBySlot = new Map<number, number>();

  for (let slot = 0; slot <= END_H - START_H; slot++) {
    countsBySlot.set(slot, 0);
  }

  // unique reservation count per slot (matches buildGlobalSlotInfo)
  const slotSets = new Map<number, Set<string>>();
  dayReservations.forEach((item) => {
    const slot = getSlotIndex(item.reservationTime || "");
    if (!slotSets.has(slot)) slotSets.set(slot, new Set());
    slotSets.get(slot)!.add(item.id);
  });
  slotSets.forEach((ids, slot) => {
    countsBySlot.set(slot, ids.size);
  });

  let top = 0;

  return Array.from({ length: END_H - START_H + 1 }, (_, slot) => {
    const hour = START_H + slot;
    const count = countsBySlot.get(slot) || 0;

    const requiredHeight =
      count <= 1
        ? SLOT_H
        : SLOT_PADDING_Y * 2 + count * CARD_H + (count - 1) * CARD_GAP;

    const height = Math.max(SLOT_H, requiredHeight);
    const layout = { slot, label: `${String(hour).padStart(2, "0")}:00`, top, height };
    top += height;
    return layout;
  });
}

export function getTimelineHeight(slotLayouts: SlotLayout[]) {
  if (!slotLayouts.length) return SLOT_H * (END_H - START_H + 1);

  const last = slotLayouts[slotLayouts.length - 1];
  return last.top + last.height;
}

export function layoutTimelineCards(
  items: ReservationRecord[],
  slotLayouts: SlotLayout[],
  globalRowMap?: Map<string, number>,
  globalSlotCounts?: Map<number, number>
) {
  const result: {
    item: ReservationRecord;
    top: number;
    left: number;
    width: number;
    height: number;
  }[] = [];

  if (globalRowMap && globalSlotCounts) {
    items.forEach((item) => {
      const slot = getSlotIndex(item.reservationTime || "");
      const slotLayout = slotLayouts.find((l) => l.slot === slot);
      const slotTop = slotLayout?.top || 0;
      const slotHeight = slotLayout?.height || SLOT_H;
      const totalInSlot = globalSlotCounts.get(slot) || 1;
      const rowIndex = globalRowMap.get(item.id) ?? 0;

      const totalCardsHeight = totalInSlot * CARD_H + Math.max(totalInSlot - 1, 0) * CARD_GAP;
      const startTop =
        totalInSlot === 1
          ? slotTop + Math.max((slotHeight - CARD_H) / 2, 0)
          : slotTop + Math.max((slotHeight - totalCardsHeight) / 2, SLOT_PADDING_Y);

      result.push({
        item,
        top: startTop + rowIndex * (CARD_H + CARD_GAP),
        left: CARD_SIDE_GAP,
        width: DOCTOR_COL_W - CARD_SIDE_GAP * 2,
        height: CARD_H,
      });
    });
  } else {
    const sorted = [...items].sort((a, b) => {
      const timeDiff = getMinutes(a.reservationTime || "") - getMinutes(b.reservationTime || "");
      if (timeDiff !== 0) return timeDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    const groups = new Map<number, ReservationRecord[]>();
    sorted.forEach((item) => {
      const slot = getSlotIndex(item.reservationTime || "");
      const list = groups.get(slot) || [];
      list.push(item);
      groups.set(slot, list);
    });

    groups.forEach((groupItems, slot) => {
      const slotLayout = slotLayouts.find((l) => l.slot === slot);
      const slotTop = slotLayout?.top || 0;
      const slotHeight = slotLayout?.height || SLOT_H;
      const totalCardsHeight = groupItems.length * CARD_H + Math.max(groupItems.length - 1, 0) * CARD_GAP;
      const startTop =
        groupItems.length === 1
          ? slotTop + Math.max((slotHeight - CARD_H) / 2, 0)
          : slotTop + Math.max((slotHeight - totalCardsHeight) / 2, SLOT_PADDING_Y);

      groupItems.forEach((item, index) => {
        result.push({
          item,
          top: startTop + index * (CARD_H + CARD_GAP),
          left: CARD_SIDE_GAP,
          width: DOCTOR_COL_W - CARD_SIDE_GAP * 2,
          height: CARD_H,
        });
      });
    });
  }

  return result.sort((a, b) => a.top - b.top);
}

export function formatLogDate(value: unknown) {
  const date = toDate(value);
  if (!date) return "";

  return (
    date.getFullYear() +
    "." +
    String(date.getMonth() + 1).padStart(2, "0") +
    "." +
    String(date.getDate()).padStart(2, "0") +
    " " +
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0") +
    ":" +
    String(date.getSeconds()).padStart(2, "0")
  );
}

export function formatCardLogDate(value: unknown) {
  const date = toDate(value);
  if (!date) return "";

  return (
    String(date.getMonth() + 1).padStart(2, "0") +
    "." +
    String(date.getDate()).padStart(2, "0") +
    " " +
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0") +
    ":" +
    String(date.getSeconds()).padStart(2, "0")
  );
}

export function getLogBadgeClass(action: string) {
  if (action.includes("delete")) return "bg-red-50 text-red-700";
  if (action.includes("invoice")) return "bg-orange-50 text-orange-700";
  if (action.includes("memo")) return "bg-green-50 text-green-700";
  if (action.includes("update")) return "bg-yellow-50 text-yellow-700";
  if (action.includes("reservation")) return "bg-blue-50 text-blue-700";

  return "bg-gray-100 text-gray-600";
}

export function splitComma(value: string) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatDateGroup(dateStr: string) {
  if (!dateStr) return "날짜 미정";

  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;

  const yoil = ["일", "월", "화", "수", "목", "금", "토"];

  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}.${String(d.getDate()).padStart(2, "0")} (${yoil[d.getDay()]})`;
}

export function normalizeTimeText(value: string) {
  const s = String(value || "").trim();
  if (!s) return "시간 미정";

  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;

  return s;
}
