import { cleanText } from "@/lib/stringUtils";
import { parseBirthInfo } from "@/lib/reservationUtils";
import type { StaffUser } from "@/lib/auth";

// 예약/환자 도메인 데이터 모양 + 순수 매퍼/빌더. Firestore/네트워크에 의존하지 않아 단위 테스트 가능.

export type DoctorOption = {
  uid: string;
  displayName: string;
  email: string;
  orderNo: number;
};

export type AppointmentType = "상담" | "수술" | "시술" | "치료" | "경과" | "진료" | "검진";

export const APPOINTMENT_TYPES: AppointmentType[] = ["상담", "수술", "시술", "치료", "경과", "진료", "검진"];

export const APPOINTMENT_TYPE_COLORS: Record<AppointmentType, string> = {
  상담: "#2563eb",
  수술: "#ef4444",
  시술: "#db2777",
  치료: "#16a34a",
  경과: "#f59e0b",
  진료: "#7c3aed",
  검진: "#0891b2",
};

export type ReservationRecord = {
  id: string;
  reservationId: string;
  patientId: string;

  name: string;
  patientName: string;
  birth: string;
  birthInput: string;
  gender: string;
  phone: string;
  nationality: string;

  reservationDate: string;
  reservationTime: string;

  hospital: string;
  appointmentType: AppointmentType;
  completed: boolean;
  cancelled: boolean;

  surgeryReserved: boolean;
  surgeryReservedAt?: string;

  consultArea: string;

  doctors: string[];
  coordinators: string[];

  invoiceUrl: string;
  invoiceId: string;
  invoiceDocId?: string;
  invoiceStatus?: string;
  invoiceSheetName: string;

  createdAt?: unknown;
  createdBy?: string;
  createdByUid?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByUid?: string;

  isDeleted: boolean;
};

export type CreateReservationParams = {
  name: string;
  birthInput?: string;
  birth?: string;
  gender?: string;
  phone?: string;
  nationality?: string;
  consultArea?: string;
  reservationDate: string;
  reservationTime?: string;
  hospital?: string;
  appointmentType?: AppointmentType;
  completed?: boolean;
  doctors?: string[];
  coordinators?: string[];
  reservationId?: string;
  patientId?: string;
};

export type UpdateReservationParams = {
  name: string;
  birthInput?: string;
  birth?: string;
  gender?: string;
  phone?: string;
  nationality?: string;
  consultArea?: string;
  reservationDate: string;
  reservationTime?: string;
  hospital?: string;
  appointmentType?: AppointmentType;
  completed?: boolean;
  cancelled?: boolean;
  doctors?: string[];
  coordinators?: string[];
};

export type PatientRecord = {
  id: string;
  patientId: string;
  name: string;
  birth?: string;
  birthInput?: string;
  gender?: string;
  phone?: string;
  nationality?: string;
  // 고객관리 배지용 요약(patients 문서 저장값 — lib/patientSummary.ts). 백필 전 문서는 undefined.
  reservationCount?: number;
  invoiceCount?: number;
  memoCount?: number;
  settlementCount?: number;
  totalSettlementPaid?: number;
  totalSettlementRefunded?: number;
  netSettlementAmount?: number;
  lastSettlementAt?: string;
  lastReservationDate?: string;
  lastReservationTime?: string;
  hasMemo?: boolean;
  hasInvoice?: boolean;
  reservationCountCapped?: boolean;
};

export function cleanNumber(value: unknown, fallback = 999999) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeAppointmentType(value: unknown): AppointmentType {
  const v = cleanText(value);
  if (v === "상담" || v === "수술" || v === "시술" || v === "치료" || v === "경과" || v === "진료" || v === "검진") return v;
  return "상담";
}

export function mapReservationDoc(id: string, data: Record<string, unknown>): ReservationRecord {
  const name = cleanText(data.name || data.patientName);

  return {
    id,
    reservationId: cleanText(data.reservationId || id),
    patientId: cleanText(data.patientId),

    name,
    patientName: name,
    birth: cleanText(data.birth),
    birthInput: cleanText(data.birthInput),
    gender: cleanText(data.gender),
    phone: cleanText(data.phone),
    nationality: cleanText(data.nationality),

    reservationDate: cleanText(data.reservationDate),
    reservationTime: cleanText(data.reservationTime),

    hospital: cleanText(data.hospital),
    appointmentType: normalizeAppointmentType(data.appointmentType),
    completed: data.completed === true,
    cancelled: data.cancelled === true,

    surgeryReserved: data.surgeryReserved === true,
    surgeryReservedAt: cleanText(data.surgeryReservedAt),

    consultArea: cleanText(data.consultArea),

    doctors: Array.isArray(data.doctors)
      ? data.doctors.map(cleanText).filter(Boolean)
      : typeof data.doctors === "string" && data.doctors
      ? data.doctors.split("|").map(cleanText).filter(Boolean)
      : [],
    coordinators: Array.isArray(data.coordinators)
      ? data.coordinators.map(cleanText).filter(Boolean)
      : typeof data.coordinators === "string" && data.coordinators
      ? data.coordinators.split("|").map(cleanText).filter(Boolean)
      : [],

    invoiceUrl: cleanText(data.invoiceUrl),
    invoiceId: cleanText(data.invoiceId),
    invoiceDocId: cleanText(data.invoiceDocId) || undefined,
    invoiceStatus: cleanText(data.invoiceStatus) || undefined,
    invoiceSheetName: cleanText(data.invoiceSheetName),

    createdAt: data.createdAt,
    createdBy: cleanText(data.createdBy),
    createdByUid: cleanText(data.createdByUid),
    updatedAt: data.updatedAt,
    updatedBy: cleanText(data.updatedBy),
    updatedByUid: cleanText(data.updatedByUid),

    isDeleted: data.isDeleted === true,
  };
}

// patients 문서(요약 포함) → PatientRecord. 숫자 필드는 숫자만 통과(백필 전엔 undefined).
export function mapPatientRecord(p: Record<string, unknown>): PatientRecord {
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    id: cleanText(p.id),
    patientId: cleanText(p.patientId),
    name: cleanText(p.name),
    birth: cleanText(p.birth),
    birthInput: cleanText(p.birthInput),
    gender: cleanText(p.gender),
    phone: cleanText(p.phone),
    nationality: cleanText(p.nationality),
    reservationCount: num(p.reservationCount),
    invoiceCount: num(p.invoiceCount),
    memoCount: num(p.memoCount),
    settlementCount: num(p.settlementCount),
    totalSettlementPaid: num(p.totalSettlementPaid),
    totalSettlementRefunded: num(p.totalSettlementRefunded),
    netSettlementAmount: num(p.netSettlementAmount),
    lastSettlementAt: cleanText(p.lastSettlementAt),
    lastReservationDate: cleanText(p.lastReservationDate),
    lastReservationTime: cleanText(p.lastReservationTime),
    hasMemo: p.hasMemo === true,
    hasInvoice: p.hasInvoice === true,
    reservationCountCapped: p.reservationCountCapped === true,
  };
}

// 예약 수정 payload(부분 patch) 순수 빌더 — firebase 미의존이라 단위 테스트 가능.
// 핵심 원칙: params에 "명시적으로 전달된" 필드만 patch에 담는다.
//   undefined → patch에서 제외(서버가 기존값 보존)
//   ""/[]/0/false 등 명시값 → 포함
// 이렇게 해야 호출부가 넘기지 않은 필드가 서버에서 조용히 초기화되지 않는다.
export function buildReservationUpdatePayload(
  params: UpdateReservationParams,
  staff: StaffUser
): { reservationPatch: Record<string, unknown> } {
  const name = cleanText(params.name);
  const reservationPatch: Record<string, unknown> = {
    name,
    patientName: name,
    reservationDate: cleanText(params.reservationDate),

    // updatedBy/updatedByUid는 서버가 SERVER_MANAGED_IGNORE로 무시하고 ctx로 강제한다(거부 대상 아님).
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  };

  if (params.phone !== undefined) reservationPatch.phone = cleanText(params.phone);
  if (params.nationality !== undefined) reservationPatch.nationality = cleanText(params.nationality);
  if (params.consultArea !== undefined) reservationPatch.consultArea = cleanText(params.consultArea);
  if (params.reservationTime !== undefined) reservationPatch.reservationTime = cleanText(params.reservationTime);
  if (params.hospital !== undefined) reservationPatch.hospital = cleanText(params.hospital);
  if (params.appointmentType !== undefined) reservationPatch.appointmentType = params.appointmentType;
  if (params.completed !== undefined) reservationPatch.completed = params.completed === true;
  if (params.cancelled !== undefined) reservationPatch.cancelled = params.cancelled === true;
  if (params.coordinators !== undefined) {
    reservationPatch.coordinators = Array.isArray(params.coordinators)
      ? params.coordinators.map(cleanText).filter(Boolean)
      : [];
  }
  if (params.doctors !== undefined) {
    reservationPatch.doctors = (params.doctors as string[]).map(cleanText).filter(Boolean);
  }

  // 생년/성별 파생 필드는 관련 입력(birthInput/birth/gender)이 하나라도 있을 때만 포함한다.
  // cleanText(undefined)가 ""를 반환하므로, 미전달 시 기존값을 blank로 덮지 않도록 undefined를 먼저 확인.
  if (params.birthInput !== undefined || params.birth !== undefined || params.gender !== undefined) {
    const parsedBirth = parseBirthInfo(
      params.birthInput || params.birth || "",
      params.gender || ""
    );
    reservationPatch.birth = parsedBirth.birth;
    reservationPatch.birthInput = parsedBirth.birthInput;
    reservationPatch.gender = parsedBirth.gender;
  }

  return { reservationPatch };
}
