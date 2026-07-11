import { auth } from "./firebase";
import { cleanText } from "./stringUtils";
import type { StaffUser } from "./auth";
import { INVOICE_LIST_CACHE_PREFIX } from "./clientCache";

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
  bankTransferAmount?: number;
  foreignCardAmount?: number;
  otherAmount?: number;
  settlementPaidAmount?: number;
  settlementRefundAmount?: number;
  settlementCount?: number;
  invoiceRevision?: number;
  updatedAfterConfirmation?: boolean;
  lastSettlementSyncedAt?: unknown;
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
const _invoicesByPatientInflight = new Map<string, Promise<InvoiceRecord[]>>();

// 환자별 인보이스 건수 캐시 (고객관리 행 뱃지) — 재진입 시 환자별 N개 재조회 방지.
// 변경 반영: TTL 만료 시 재조회 + 내 생성/삭제 시 무효화.
const _invoiceCountCache = new Map<string, { at: number; count: number }>();
const INVOICE_COUNT_TTL = 3 * 60 * 1000;

export function getCachedInvoiceCount(patientId: string): number | undefined {
  const e = _invoiceCountCache.get(patientId);
  return e && Date.now() - e.at < INVOICE_COUNT_TTL ? e.count : undefined;
}

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
  _invoicesByPatientInflight.delete(patientId);
  _invoiceCountCache.delete(patientId);
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
    bankTransferAmount: data.bankTransferAmount != null ? toNumber(data.bankTransferAmount) : undefined,
    foreignCardAmount: data.foreignCardAmount != null ? toNumber(data.foreignCardAmount) : undefined,
    otherAmount: data.otherAmount != null ? toNumber(data.otherAmount) : undefined,
    settlementPaidAmount: data.settlementPaidAmount != null ? toNumber(data.settlementPaidAmount) : undefined,
    settlementRefundAmount: data.settlementRefundAmount != null ? toNumber(data.settlementRefundAmount) : undefined,
    settlementCount: data.settlementCount != null ? toNumber(data.settlementCount) : undefined,
    invoiceRevision: data.invoiceRevision != null ? toNumber(data.invoiceRevision) : undefined,
    updatedAfterConfirmation: data.updatedAfterConfirmation === true,
    lastSettlementSyncedAt: data.lastSettlementSyncedAt,
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
  const cached = getInvoicesByPatientCache(patientId);
  if (cached) return cached;

  const inflight = _invoicesByPatientInflight.get(patientId);
  if (inflight) return inflight;

  const promise = (async () => {
    const result = await callInvoicesApi("get_by_patient", { patientId });
    if (!result.success || !Array.isArray(result.invoices)) return [];
    const records = (result.invoices as Record<string, unknown>[]).map(mapInvoiceDoc);
    _invoicesByPatientCache.set(patientId, records);
    _invoiceCountCache.set(patientId, { at: Date.now(), count: records.length });
    try { sessionStorage.setItem(`inv_${patientId}`, JSON.stringify(records)); } catch {}
    return records;
  })();

  _invoicesByPatientInflight.set(patientId, promise);
  try {
    return await promise;
  } finally {
    _invoicesByPatientInflight.delete(patientId);
  }
}

export async function getInvoiceCountByPatientId(patientId: string): Promise<number> {
  const cached = getCachedInvoiceCount(patientId);
  if (cached !== undefined) return cached;
  const invoices = await getInvoicesByPatientId(patientId);
  return invoices.length;
}

// 여러 환자의 인보이스 개수를 "1번의 배치 요청"으로 채운다. 고객관리 카드 배지가
// 환자마다 getInvoiceCountByPatientId를 따로 부르면 서버 왕복이 N번 생기므로,
// 아직 캐시가 없는 환자만 모아 counts_by_patients로 한 번에 받는다.
export async function warmInvoiceCountCache(patientIds: string[]): Promise<void> {
  const stale = [...new Set(patientIds.filter(Boolean))].filter(
    (pid) => getCachedInvoiceCount(pid) === undefined
  );
  if (!stale.length) return;

  const result = await callInvoicesApi("counts_by_patients", { patientIds: stale });
  if (!result.success) return;
  const counts = (result.counts as Record<string, number> | undefined) || {};
  const now = Date.now();
  for (const pid of stale) {
    _invoiceCountCache.set(pid, { at: now, count: counts[pid] ?? 0 });
  }
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
  invalidateInvoiceListCache();
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
  invalidateInvoiceListCache();
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
  if (result.success) invalidateInvoiceListCache();
  return { success: result.success, message: result.message };
}

export type InvoiceListFilter = {
  startDate?: string;
  endDate?: string;
  status?: "draft" | "confirmed" | "void" | "";
  patientName?: string;
  commissionStaffUid?: string;
};

// INVOICE_LIST_CACHE_PREFIX는 @/lib/clientCache에서 단일 관리(로그아웃 purge와 출처 공유).
const INVOICE_LIST_CACHE_TTL = 2 * 60 * 1000; // 2분 (금액 데이터라 신선도 우선)

type InvoiceListCacheEntry = {
  invoices: InvoiceRecord[];
  total: number;
  capped: boolean;
  cachedAt: number;
};

function getInvoiceListCache(key: string): InvoiceListCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: InvoiceListCacheEntry = JSON.parse(raw);
    if (Date.now() - parsed.cachedAt > INVOICE_LIST_CACHE_TTL) return null;
    return parsed;
  } catch { return null; }
}

function setInvoiceListCache(key: string, data: Omit<InvoiceListCacheEntry, "cachedAt">) {
  if (typeof window === "undefined") return;
  setTimeout(() => {
    try {
      localStorage.setItem(key, JSON.stringify({ ...data, cachedAt: Date.now() }));
    } catch {}
  }, 0);
}

export function invalidateInvoiceListCache() {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(INVOICE_LIST_CACHE_PREFIX));
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

// 서버가 권한 스코프를 쿼리로 적용하고 상한(HARD_CAP)까지 전체를 반환한다.
// 따라서 합계/KPI를 결과 전체로 정확히 계산할 수 있다(이전: 50건 페이지 한정으로 오류).
// capped=true면 상한 초과로 일부가 누락됐을 수 있다(기간을 좁혀 재조회 권장).
export async function getInvoices(
  filters?: InvoiceListFilter
): Promise<{ invoices: InvoiceRecord[]; total: number; capped: boolean }> {
  // 캐시 키에 로그인 uid를 포함해 사용자별로 분리한다(공용기기에서 권한 스코프가 다른
  // 사용자끼리 캐시를 공유해 인보이스가 노출/누락되는 것을 차단). 신원 미확정 시 캐시 우회.
  const uid = auth.currentUser?.uid;
  const cacheKey = uid
    ? INVOICE_LIST_CACHE_PREFIX + uid + "_" + JSON.stringify(filters ?? {})
    : null;
  if (cacheKey) {
    const cached = getInvoiceListCache(cacheKey);
    if (cached) return { invoices: cached.invoices, total: cached.total, capped: cached.capped };
  }

  const result = await callInvoicesApi("list", {
    startDate: filters?.startDate || "",
    endDate: filters?.endDate || "",
    status: filters?.status || "",
    patientName: filters?.patientName || "",
    commissionStaffUid: filters?.commissionStaffUid || "",
  });
  if (!result.success || !Array.isArray(result.invoices)) {
    return { invoices: [], total: 0, capped: false };
  }
  const invoices = (result.invoices as Record<string, unknown>[]).map(mapInvoiceDoc);
  const total = typeof result.total === "number" ? (result.total as number) : invoices.length;
  const capped = Boolean(result.capped);
  if (cacheKey) setInvoiceListCache(cacheKey, { invoices, total, capped });
  return { invoices, total, capped };
}
