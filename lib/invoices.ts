import { auth } from "./firebase";
import { cleanText } from "./stringUtils";
import type { StaffUser } from "./auth";

export type InvoiceRecord = {
  id: string;
  invoiceId: string;

  reservationDocId: string;
  reservationId: string;
  patientId: string;

  patientName: string;
  birth: string;
  birthDisplay: string;
  gender: string;
  nationality: string;
  phone: string;
  doctors: string[];
  coordinators: string[];

  hospitalName: string;
  surgeryItems: string;
  totalAmount: number;

  paymentMethod?: "card" | "cash" | "mixed";
  cardAmount?: number;
  cashAmount?: number;
  commissionRate?: number;
  commissionStaffUid?: string;
  commissionStaffName?: string;
  commissionBase?: number;
  commissionAmount?: number;

  surgeryDate?: string;
  memo?: string;
  status: "draft" | "confirmed" | "void";

  createdAt?: unknown;
  createdBy: string;
  createdByUid: string;
  updatedAt?: unknown;
  updatedBy: string;
  updatedByUid: string;

  isDeleted: boolean;
};

export type InvoiceUpdatePayload = {
  hospitalName: string;
  surgeryItems: string;
  surgeryDate?: string;
  totalAmount: number;
  paymentMethod?: "card" | "cash" | "mixed";
  cardAmount?: number;
  cashAmount?: number;
  commissionRate?: number;
  commissionStaffUid?: string;
  commissionStaffName?: string;
  commissionBase?: number;
  commissionAmount?: number;
  memo?: string;
  doctors?: string[];
  status?: "draft" | "confirmed" | "void";
};

// 환자별 인보이스 결과 캐시 (pre-fetch 결과를 모달에서 즉시 재사용)
const _invoicesByPatientCache = new Map<string, InvoiceRecord[]>();

export function getInvoicesByPatientCache(patientId: string): InvoiceRecord[] | undefined {
  if (_invoicesByPatientCache.has(patientId)) return _invoicesByPatientCache.get(patientId);
  try {
    const raw = sessionStorage.getItem(`inv_${patientId}`);
    if (raw) {
      const d = JSON.parse(raw) as InvoiceRecord[];
      _invoicesByPatientCache.set(patientId, d);
      return d;
    }
  } catch {}
  return undefined;
}

export function invalidateInvoicesByPatientCache(patientId: string) {
  _invoicesByPatientCache.delete(patientId);
  try { sessionStorage.removeItem(`inv_${patientId}`); } catch {}
}

async function callInvoicesApi(action: string, payload: Record<string, unknown>) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    return { success: false as const, message: "로그인 상태를 확인할 수 없습니다. 페이지를 새로고침 후 다시 시도해주세요." };
  }
  if (!navigator.onLine) {
    return { success: false as const, message: "인터넷 연결을 확인해주세요." };
  }
  try {
    const idToken = await firebaseUser.getIdToken();
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, action, payload }),
    });
    if (!res.ok) {
      return { success: false as const, message: `서버 오류가 발생했습니다. (${res.status})` };
    }
    return res.json() as Promise<Record<string, unknown> & { success: boolean; message?: string }>;
  } catch {
    return { success: false as const, message: "네트워크 오류가 발생했습니다. 연결 상태를 확인해주세요." };
  }
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function mapInvoiceDoc(data: Record<string, unknown>): InvoiceRecord {
  return {
    id: cleanText(data.id),
    invoiceId: cleanText(data.invoiceId || data.id),

    reservationDocId: cleanText(data.reservationDocId),
    reservationId: cleanText(data.reservationId),
    patientId: cleanText(data.patientId),

    patientName: cleanText(data.patientName),
    birth: cleanText(data.birth),
    birthDisplay: cleanText(data.birthDisplay),
    gender: cleanText(data.gender),
    nationality: cleanText(data.nationality),
    phone: cleanText(data.phone),

    doctors: Array.isArray(data.doctors) ? data.doctors : [],
    coordinators: Array.isArray(data.coordinators) ? data.coordinators : [],

    hospitalName: cleanText(data.hospitalName),
    surgeryItems: cleanText(data.surgeryItems),
    surgeryDate: cleanText(data.surgeryDate),
    totalAmount: toNumber(data.totalAmount),

    paymentMethod: (["card", "cash", "mixed"].includes(String(data.paymentMethod))
      ? data.paymentMethod
      : undefined) as "card" | "cash" | "mixed" | undefined,
    cardAmount: data.cardAmount != null ? toNumber(data.cardAmount) : undefined,
    cashAmount: data.cashAmount != null ? toNumber(data.cashAmount) : undefined,
    commissionRate: data.commissionRate != null ? toNumber(data.commissionRate) : undefined,
    commissionStaffUid: data.commissionStaffUid ? cleanText(data.commissionStaffUid) : undefined,
    commissionStaffName: data.commissionStaffName ? cleanText(data.commissionStaffName) : undefined,
    commissionBase: data.commissionBase != null ? toNumber(data.commissionBase) : undefined,
    commissionAmount: data.commissionAmount != null ? toNumber(data.commissionAmount) : undefined,

    memo: cleanText(data.memo),
    status: (["draft", "confirmed", "void"].includes(String(data.status))
      ? data.status
      : "draft") as "draft" | "confirmed" | "void",

    createdAt: data.createdAt,
    createdBy: cleanText(data.createdBy),
    createdByUid: cleanText(data.createdByUid),
    updatedAt: data.updatedAt,
    updatedBy: cleanText(data.updatedBy),
    updatedByUid: cleanText(data.updatedByUid),

    isDeleted: data.isDeleted === true,
  };
}

export async function getInvoicesByPatientId(patientId: string): Promise<InvoiceRecord[]> {
  const result = await callInvoicesApi("get_by_patient", { patientId });
  if (!result.success || !Array.isArray(result.invoices)) return [];
  const records = (result.invoices as Record<string, unknown>[]).map(mapInvoiceDoc);
  _invoicesByPatientCache.set(patientId, records);
  try { sessionStorage.setItem(`inv_${patientId}`, JSON.stringify(records)); } catch {}
  return records;
}

export async function getInvoiceCountByPatientId(patientId: string): Promise<number> {
  const invoices = await getInvoicesByPatientId(patientId);
  return invoices.length;
}

export async function getInvoiceByReservationDocId(reservationDocId: string) {
  const result = await callInvoicesApi("get_by_reservation", { reservationDocId });
  if (!result.success || !result.invoice) return null;
  return mapInvoiceDoc(result.invoice as Record<string, unknown>);
}

export async function getOrCreateInvoiceDraft(
  reservationDocId: string,
  staff: StaffUser
) {
  const result = await callInvoicesApi("create", {
    reservationDocId,
    staffUid: staff.uid,
    staffName: staff.displayName,
    staffEmail: staff.email,
    staffRole: staff.role,
    staffCode: staff.staffCode || "",
  });
  if (!result.success || !result.invoice) {
    return { success: false as const, message: result.message || "인보이스 생성 실패" };
  }
  return {
    success: true as const,
    invoice: mapInvoiceDoc(result.invoice as Record<string, unknown>),
    alreadyExists: !!result.alreadyExists,
  };
}

export async function updateInvoice(
  invoiceDocId: string,
  payload: InvoiceUpdatePayload,
  staff: StaffUser
) {
  const result = await callInvoicesApi("update", {
    invoiceDocId,
    staffUid: staff.uid,
    staffName: staff.displayName,
    staffEmail: staff.email,
    staffRole: staff.role,
    staffCode: staff.staffCode || "",
    hospitalName: payload.hospitalName,
    surgeryItems: payload.surgeryItems,
    surgeryDate: payload.surgeryDate,
    totalAmount: payload.totalAmount,
    paymentMethod: payload.paymentMethod,
    cardAmount: payload.cardAmount,
    cashAmount: payload.cashAmount,
    commissionRate: payload.commissionRate,
    commissionStaffUid: payload.commissionStaffUid,
    commissionStaffName: payload.commissionStaffName,
    commissionBase: payload.commissionBase,
    commissionAmount: payload.commissionAmount,
    memo: payload.memo,
    doctors: payload.doctors,
    status: payload.status,
  });
  if (!result.success || !result.invoice) {
    return { success: false as const, message: result.message || "저장 실패" };
  }
  return {
    success: true as const,
    invoice: mapInvoiceDoc(result.invoice as Record<string, unknown>),
  };
}

export async function deleteInvoice(invoiceDocId: string, staff: StaffUser) {
  const result = await callInvoicesApi("delete", {
    invoiceDocId,
    staffUid: staff.uid,
    staffName: staff.displayName,
    staffEmail: staff.email,
    staffRole: staff.role,
    staffCode: staff.staffCode || "",
  });
  return { success: result.success, message: result.message };
}

export type InvoiceListFilter = {
  startDate?: string;
  endDate?: string;
  status?: "draft" | "confirmed" | "void" | "";
  patientName?: string;
  commissionStaffUid?: string;
  cursor?: string;
};

export async function getInvoices(
  filters?: InvoiceListFilter
): Promise<{ invoices: InvoiceRecord[]; nextCursor: string | null; hasMore: boolean }> {
  const result = await callInvoicesApi("list", {
    startDate: filters?.startDate || "",
    endDate: filters?.endDate || "",
    status: filters?.status || "",
    patientName: filters?.patientName || "",
    commissionStaffUid: filters?.commissionStaffUid || "",
    cursor: filters?.cursor || "",
  });
  if (!result.success || !Array.isArray(result.invoices)) {
    return { invoices: [], nextCursor: null, hasMore: false };
  }
  return {
    invoices: (result.invoices as Record<string, unknown>[]).map(mapInvoiceDoc),
    nextCursor: (result.nextCursor as string | null) ?? null,
    hasMore: Boolean(result.hasMore),
  };
}
