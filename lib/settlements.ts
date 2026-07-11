
import { auth } from "./firebase";
import { cleanText } from "./stringUtils";
import type {
  SettlementAggregate,
  SettlementCategory,
  SettlementDirection,
  SettlementPaymentMethod,
  SettlementStatus,
} from "./settlementMath";

export type SettlementRecord = {
  id: string;
  patientId: string;
  reservationDocId: string;
  reservationId: string;
  appointmentDate: string;
  appointmentType: string;
  hospital: string;
  consultArea: string;
  direction: SettlementDirection;
  category: SettlementCategory;
  amount: number;
  paymentMethod: SettlementPaymentMethod;
  paidAt: string;
  memo: string;
  status: SettlementStatus;
  voidReason?: string;
  createdAt?: unknown;
  createdBy?: string;
  updatedAt?: unknown;
  updatedBy?: string;
};

export type SettlementAppointment = {
  id: string;
  reservationId: string;
  patientId: string;
  reservationDate: string;
  reservationTime: string;
  appointmentType: string;
  hospital: string;
  consultArea: string;
};

export type SettlementMutationInput = {
  patientId: string;
  reservationDocId: string;
  direction: SettlementDirection;
  category: SettlementCategory;
  amount: number;
  paymentMethod: SettlementPaymentMethod;
  paidAt: string;
  memo?: string;
};

type SettlementListResult = {
  success: boolean;
  message?: string;
  settlements?: Record<string, unknown>[];
  appointments?: Record<string, unknown>[];
  appointmentsLoaded?: boolean;
  aggregate?: SettlementAggregate;
};

type PatientSettlementsCacheEntry = {
  at: number;
  data: {
    settlements: SettlementRecord[];
    appointments: SettlementAppointment[];
    appointmentsLoaded: boolean;
    aggregate: SettlementAggregate;
  };
};

const SETTLEMENTS_BY_PATIENT_TTL = 3 * 60 * 1000;
const _settlementsByPatientCache = new Map<string, PatientSettlementsCacheEntry>();
const _settlementsByPatientInflight = new Map<string, Promise<PatientSettlementsCacheEntry["data"]>>();

async function callSettlementsApi(action: string, payload: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) return { success: false, message: "로그인이 필요합니다." } as SettlementListResult;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { success: false, message: "인터넷 연결을 확인해주세요." } as SettlementListResult;
  }
  try {
    const idToken = await user.getIdToken();
    const response = await fetch("/api/settlements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, action, payload }),
    });
    const body = await response.json().catch(() => ({})) as SettlementListResult;
    if (!response.ok) {
      return {
        ...body,
        success: false,
        message: body.message || `서버 오류가 발생했습니다. (${response.status})`,
      };
    }
    return body;
  } catch {
    return { success: false, message: "네트워크 오류가 발생했습니다." } as SettlementListResult;
  }
}

function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapSettlement(raw: Record<string, unknown>): SettlementRecord {
  return {
    id: cleanText(raw.id),
    patientId: cleanText(raw.patientId),
    reservationDocId: cleanText(raw.reservationDocId),
    reservationId: cleanText(raw.reservationId),
    appointmentDate: cleanText(raw.appointmentDate),
    appointmentType: cleanText(raw.appointmentType),
    hospital: cleanText(raw.hospital),
    consultArea: cleanText(raw.consultArea),
    direction: raw.direction === "refund" ? "refund" : "payment",
    category: (["deposit", "surgery_fee", "procedure_fee", "other"].includes(String(raw.category))
      ? raw.category
      : "other") as SettlementCategory,
    amount: numberValue(raw.amount),
    paymentMethod: (["card", "cash", "bank_transfer", "foreign_card", "other"].includes(String(raw.paymentMethod))
      ? raw.paymentMethod
      : "other") as SettlementPaymentMethod,
    paidAt: cleanText(raw.paidAt),
    memo: cleanText(raw.memo),
    status: raw.status === "void" ? "void" : "active",
    voidReason: cleanText(raw.voidReason) || undefined,
    createdAt: raw.createdAt,
    createdBy: cleanText(raw.createdBy),
    updatedAt: raw.updatedAt,
    updatedBy: cleanText(raw.updatedBy),
  };
}

function mapAppointment(raw: Record<string, unknown>): SettlementAppointment {
  return {
    id: cleanText(raw.id),
    reservationId: cleanText(raw.reservationId),
    patientId: cleanText(raw.patientId),
    reservationDate: cleanText(raw.reservationDate),
    reservationTime: cleanText(raw.reservationTime),
    appointmentType: cleanText(raw.appointmentType),
    hospital: cleanText(raw.hospital),
    consultArea: cleanText(raw.consultArea),
  };
}

const EMPTY_AGGREGATE: SettlementAggregate = {
  count: 0,
  paymentCount: 0,
  refundCount: 0,
  totalPaid: 0,
  totalRefunded: 0,
  netAmount: 0,
  methodTotals: { card: 0, cash: 0, bank_transfer: 0, foreign_card: 0, other: 0 },
  cardAmount: 0,
  cashAmount: 0,
  commissionBase: 0,
  lastPaidAt: "",
};

export function getCachedPatientSettlements(patientId: string) {
  const cached = _settlementsByPatientCache.get(patientId);
  if (!cached || Date.now() - cached.at >= SETTLEMENTS_BY_PATIENT_TTL) return undefined;
  return cached.data;
}

export function invalidatePatientSettlementsCache(patientId: string) {
  _settlementsByPatientCache.delete(patientId);
  for (const key of _settlementsByPatientInflight.keys()) {
    if (key.startsWith(`${patientId}:`)) _settlementsByPatientInflight.delete(key);
  }
}

export async function listPatientSettlements(
  patientId: string,
  options: { includeAppointments?: boolean } = {}
): Promise<{
  settlements: SettlementRecord[];
  appointments: SettlementAppointment[];
  appointmentsLoaded: boolean;
  aggregate: SettlementAggregate;
}> {
  const includeAppointments = options.includeAppointments !== false;
  const cached = getCachedPatientSettlements(patientId);
  if (cached && (!includeAppointments || cached.appointmentsLoaded)) return cached;

  const inflightKey = `${patientId}:${includeAppointments ? "with-appointments" : "settlements-only"}`;
  const inflight = _settlementsByPatientInflight.get(inflightKey);
  if (inflight) return inflight;

  const promise = fetchPatientSettlements(patientId, includeAppointments);
  _settlementsByPatientInflight.set(inflightKey, promise);
  try {
    const data = await promise;
    _settlementsByPatientCache.set(patientId, { at: Date.now(), data });
    return data;
  } finally {
    _settlementsByPatientInflight.delete(inflightKey);
  }
}

async function fetchPatientSettlements(patientId: string, includeAppointments: boolean): Promise<{
  settlements: SettlementRecord[];
  appointments: SettlementAppointment[];
  appointmentsLoaded: boolean;
  aggregate: SettlementAggregate;
}> {
  const result = await callSettlementsApi("list", { patientId, includeAppointments });
  if (!result.success) throw new Error(result.message || "정산 내역을 불러오지 못했습니다.");
  return {
    settlements: (result.settlements || []).map(mapSettlement),
    appointments: (result.appointments || []).map(mapAppointment),
    appointmentsLoaded: result.appointmentsLoaded === true,
    aggregate: result.aggregate || EMPTY_AGGREGATE,
  };
}

export async function createSettlement(input: SettlementMutationInput) {
  const result = await callSettlementsApi("create", input as unknown as Record<string, unknown>);
  if (result.success) invalidatePatientSettlementsCache(input.patientId);
  return result;
}

export async function updateSettlement(settlementId: string, input: SettlementMutationInput) {
  const result = await callSettlementsApi("update", { settlementId, ...input });
  if (result.success) invalidatePatientSettlementsCache(input.patientId);
  return result;
}

export async function voidSettlement(settlementId: string, reason: string) {
  const result = await callSettlementsApi("void", { settlementId, reason });
  if (result.success) _settlementsByPatientCache.clear();
  return result;
}
