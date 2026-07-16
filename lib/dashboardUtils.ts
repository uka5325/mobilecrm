import { cleanText } from "./stringUtils";
export { cleanText };

// Types
export type StaffRole = "admin" | "doctor" | "coordinator" | "staff" | "interpreter";

export type StaffDoc = {
  uid?: string;
  email?: string;
  displayName?: string;
  display_name?: string;
  name?: string;
  role?: StaffRole | string;
  active?: boolean;
  orderNo?: number;
  order_no?: number;
};

export type ReservationDoc = {
  id: string;
  reservationId?: string;
  reservation_id?: string;
  patientId?: string;
  patient_id?: string;
  name?: string;
  patientName?: string;
  patient_name?: string;
  birth?: string;
  birthInput?: string;
  birth_input?: string;
  reservationDate?: string;
  reservation_date?: string;
  date?: string;
  reservationTime?: string;
  reservation_time?: string;
  time?: string;
  hospital?: string;
  appointmentType?: string;
  completed?: boolean;
  consultArea?: string;
  consult_area?: string;
  area?: string;
  doctors?: string[];
  doctor?: string;
  doctorName?: string;
  doctor_name?: string;
  coordinators?: string[];
  manager?: string;
  managerName?: string;
  manager_name?: string;
  coordinator?: string;
  surgeryReserved?: boolean;
  surgery_reserved?: boolean;
  surgeryStatus?: string;
  surgery_status?: string;
  nationality?: string;
  phone?: string;
  cancelled?: boolean;
};

export type Counter = {
  name?: string;
  total: number;
  surgery: number;
  consultCount: number;
  surgeryTypeCount: number;
  treatmentCount: number;
  followUpCount: number;
  completedCount: number;
};

export type KpiRow = Counter & {
  surgeryRate: number;
  shareRate?: number;
};

export const CURRENCY_ORDER = ["KRW", "MNT", "USD", "JPY", "CNY", "VND"];
export const CURRENCY_SYMBOL: Record<string, string> = {
  KRW: "₩",
  MNT: "₮",
  USD: "$",
  JPY: "¥",
  CNY: "¥",
  VND: "₫",
};

// Utility functions
export function formatDate(date: Date) {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

function cleanName(value: unknown) {
  let text = cleanText(value);
  if (!text) return "";

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        text = parsed.map(cleanName).filter(Boolean).join(", ");
      }
    } catch {
      // ignore
    }
  }

  return text
    .replace(/^\s*\[\s*|\s*\]\s*$/g, "")
    .replace(/^\s*["']+|["']+\s*$/g, "")
    .replace(/\\"/g, "")
    .replace(/["']/g, "")
    .trim();
}

export function getStaffDisplayName(item: StaffDoc) {
  return cleanName(item.displayName || item.display_name || item.name);
}

function splitNames(value: unknown) {
  if (Array.isArray(value)) return value.map(cleanName).filter(Boolean);
  return cleanText(value)
    .split(/[,/|·、，\n]/)
    .map(cleanName)
    .filter(Boolean);
}

function normalizeDate(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";

  const dot = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (dot) {
    return `${dot[1]}-${String(Number(dot[2])).padStart(2, "0")}-${String(Number(dot[3])).padStart(2, "0")}`;
  }

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  return raw.slice(0, 10);
}

function normalizeTime(value: unknown) {
  const raw = cleanText(value);
  const m = raw.match(/(\d{1,2}):(\d{2})/);
  if (!m) return raw || "-";
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

export function getReservationDate(item: ReservationDoc) {
  return normalizeDate(item.reservationDate || item.reservation_date || item.date || "");
}

export function getReservationTime(item: ReservationDoc) {
  return normalizeTime(item.reservationTime || item.reservation_time || item.time || "");
}

export function getPatientName(item: ReservationDoc) {
  return cleanName(item.name || item.patientName || item.patient_name || "-");
}

export function getConsultArea(item: ReservationDoc) {
  return cleanName(item.consultArea || item.consult_area || item.area || "미지정");
}

export function getConsultAreas(item: ReservationDoc) {
  const raw = item.consultArea || item.consult_area || item.area;
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map(cleanName).filter(Boolean)));
  }

  const text = cleanText(raw);
  if (!text) return ["미지정"];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const areas = parsed.map(cleanName).filter(Boolean);
        if (areas.length) return Array.from(new Set(areas));
      }
    } catch {
      // Continue with delimiter-based parsing for legacy text values.
    }
  }

  const areas = text
    .split(/[,/|·、，\n]/)
    .map(cleanName)
    .filter(Boolean);
  return areas.length ? Array.from(new Set(areas)) : ["미지정"];
}

export function getPatientKey(item: ReservationDoc) {
  const patientId = cleanText(item.patientId || item.patient_id);
  if (patientId) return `pid:${patientId}`;

  const name = cleanText(item.name || item.patientName || item.patient_name)
    .normalize("NFC")
    .replace(/\s+/g, "")
    .toLowerCase();
  const phone = cleanText(item.phone).replace(/[^0-9]/g, "");
  if (name && phone) return `legacy:${name}:${phone}`;

  const birth = cleanText(item.birth || item.birthInput || item.birth_input).replace(/[^0-9]/g, "");
  if (name && birth) return `legacy:${name}:${birth.slice(0, 8)}`;

  return `reservation:${cleanText(item.id || item.reservationId || item.reservation_id)}`;
}

export function getHospital(item: ReservationDoc) {
  return cleanName(item.hospital || "");
}

export function getAppointmentType(item: ReservationDoc) {
  const v = cleanText(item.appointmentType || "");
  if (v === "상담" || v === "수술" || v === "시술" || v === "치료" || v === "경과" || v === "진료" || v === "검진") return v;
  return "상담";
}

const SURGERY_AREA_GROUPS: Array<{ name: string; pattern: RegExp }> = [
  { name: "눈", pattern: /(눈|쌍꺼풀|트임|안검|눈매교정)/i },
  { name: "코", pattern: /(코|콧|비중격|비주|비밸브|비절골)/i },
  { name: "가슴", pattern: /(가슴|유방|유두|유륜|여유증)/i },
  { name: "윤곽", pattern: /(윤곽|광대|사각턱|턱끝|양악|안면골|피질골)/i },
  { name: "리프팅", pattern: /(리프팅|거상|스마스|smas)/i },
  { name: "지방이식", pattern: /지방이식/i },
  { name: "지방흡입", pattern: /(지방흡입|지흡|복부|허벅지|팔뚝|옆구리)/i },
  { name: "입술", pattern: /입술/i },
];

export function getDemandAreas(item: ReservationDoc) {
  const appointmentType = getAppointmentType(item);
  if (appointmentType === "시술") return ["시술"];

  const areas = getConsultAreas(item);
  if (appointmentType !== "수술") return areas;

  return Array.from(new Set(areas.map((area) => {
    const group = SURGERY_AREA_GROUPS.find(({ pattern }) => pattern.test(area));
    return group?.name || area;
  })));
}

export function isCompleted(item: ReservationDoc) {
  return item.completed === true;
}

export function getDoctors(item: ReservationDoc) {
  const fromArray = splitNames(item.doctors);
  const fromSingle = splitNames(item.doctor || item.doctorName || item.doctor_name);
  return Array.from(new Set([...fromArray, ...fromSingle])).filter(Boolean);
}

export function getManagers(item: ReservationDoc) {
  const fromArray = splitNames(item.coordinators);
  const fromSingle = splitNames(
    item.manager || item.managerName || item.manager_name || item.coordinator
  );
  return Array.from(new Set([...fromArray, ...fromSingle])).filter(Boolean);
}

export function isSurgeryReserved(item: ReservationDoc) {
  if (typeof item.surgeryReserved === "boolean") return item.surgeryReserved;
  if (typeof item.surgery_reserved === "boolean") return item.surgery_reserved;

  const raw = cleanText(
    item.surgeryStatus || item.surgery_status || item.surgery_reserved || ""
  ).toLowerCase();

  return ["true", "1", "y", "yes", "예약", "수술예약", "수술 예약", "확정", "완료", "o", "○"].includes(raw);
}

function parseMoney(value: unknown) {
  if (typeof value === "number") return value;
  const raw = cleanText(value).replace(/,/g, "");
  const m = raw.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function detectCurrency(value: unknown) {
  const raw = cleanText(value).toLowerCase();

  if (raw.includes("투그릭") || raw.includes("mnt") || raw.includes("₮") || raw.includes("төг") || raw.includes("tugrik")) return "MNT";
  if (raw.includes("달러") || raw.includes("usd") || raw.includes("$")) return "USD";
  if (raw.includes("엔") || raw.includes("jpy") || raw.includes("¥") || raw.includes("円")) return "JPY";
  if (raw.includes("위안") || raw.includes("cny") || raw.includes("rmb") || raw.includes("元") || raw.includes("￥")) return "CNY";
  if (raw.includes("동") || raw.includes("vnd") || raw.includes("₫")) return "VND";

  return "KRW";
}

function parseDepositParts(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return [];

  return raw
    .split("/")
    .map((part) => {
      const amount = parseMoney(part);
      if (!amount) return null;
      return { currency: detectCurrency(part), amount };
    })
    .filter(Boolean) as { currency: string; amount: number }[];
}

export function emptyCounter(name?: string): Counter {
  return { name, total: 0, surgery: 0, consultCount: 0, surgeryTypeCount: 0, treatmentCount: 0, followUpCount: 0, completedCount: 0 };
}

export function accumulate(counter: Counter, item: ReservationDoc) {
  const apptType = getAppointmentType(item);
  counter.total += 1;
  if (isSurgeryReserved(item)) counter.surgery += 1;
  if (apptType === "상담") counter.consultCount += 1;
  if (apptType === "수술") counter.surgeryTypeCount += 1;
  if (apptType === "치료") counter.treatmentCount += 1;
  if (apptType === "경과") counter.followUpCount += 1;
  if (isCompleted(item)) counter.completedCount += 1;
}

export function rate(a: number, b: number) {
  if (!b) return 0;
  return Math.round((a / b) * 1000) / 10;
}

export function finalizeCounter(counter: Counter, shareBase?: number): KpiRow {
  return {
    ...counter,
    surgeryRate: rate(counter.surgery, counter.consultCount || counter.total),
    shareRate: shareBase ? rate(counter.consultCount, shareBase) : 0,
  };
}

export function formatDepositMap(map: Record<string, number>) {
  const parts: string[] = [];

  CURRENCY_ORDER.forEach((currency) => {
    const amount = Number(map[currency] || 0);
    if (!amount) return;
    parts.push(`${amount.toLocaleString("ko-KR")}${CURRENCY_SYMBOL[currency]}`);
  });

  Object.keys(map).sort().forEach((currency) => {
    if (CURRENCY_ORDER.includes(currency)) return;
    const amount = Number(map[currency] || 0);
    if (!amount) return;
    parts.push(`${amount.toLocaleString("ko-KR")}${currency}`);
  });

  return parts.length ? parts : ["0₩"];
}

export function pctText(value: number) {
  return `${Number(value || 0).toFixed(1).replace(".0", "")}%`;
}

export function setQuickRange(type: "today" | "week" | "month" | "lastMonth" | "last7" | "last30") {
  const now = new Date();
  let start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let end = new Date(start.getTime());

  if (type === "week") {
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    end = new Date(start.getTime());
    end.setDate(start.getDate() + 6);
  }

  if (type === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }

  if (type === "lastMonth") {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 0);
  }

  if (type === "last7") start.setDate(start.getDate() - 6);
  if (type === "last30") start.setDate(start.getDate() - 29);

  return { start: formatDate(start), end: formatDate(end) };
}
