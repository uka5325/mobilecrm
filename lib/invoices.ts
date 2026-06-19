import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import type { StaffUser } from "./auth";
import { mapReservationDoc, type ReservationRecord } from "./reservations";
import { cleanText } from "./stringUtils";
import { createLog } from "./logs";
import { getReservationBirthInfo } from "./reservationUtils";

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

  // 인보이스 핵심 필드
  hospitalName: string;
  surgeryItems: string;
  totalAmount: number;

  // 결제 방법 및 커미션
  paymentMethod?: "card" | "cash" | "mixed";
  cardAmount?: number;
  cashAmount?: number;
  commissionRate?: number;
  commissionStaffUid?: string;
  commissionStaffName?: string;
  commissionBase?: number;
  commissionAmount?: number;

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
  status?: "draft" | "confirmed" | "void";
};

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function makeInvoiceId(reservation: ReservationRecord) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const namePart = cleanText(reservation.name || reservation.patientName || "고객")
    .replace(/[\\/#?[\]*.]/g, " ")
    .replace(/\s+/g, "")
    .slice(0, 20);
  return `INV-${yy}${mm}${dd}-${namePart}`;
}

function mapInvoiceDoc(id: string, data: Record<string, unknown>): InvoiceRecord {
  return {
    id,
    invoiceId: cleanText(data.invoiceId || id),

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
    totalAmount: toNumber(data.totalAmount),

    paymentMethod: (["card", "cash", "mixed"].includes(String(data.paymentMethod))
      ? data.paymentMethod
      : undefined) as "card" | "cash" | "mixed" | undefined,
    cardAmount: data.cardAmount !== undefined ? toNumber(data.cardAmount) : undefined,
    cashAmount: data.cashAmount !== undefined ? toNumber(data.cashAmount) : undefined,
    commissionRate: data.commissionRate !== undefined ? toNumber(data.commissionRate) : undefined,
    commissionStaffUid: data.commissionStaffUid ? cleanText(data.commissionStaffUid) : undefined,
    commissionStaffName: data.commissionStaffName ? cleanText(data.commissionStaffName) : undefined,
    commissionBase: data.commissionBase !== undefined ? toNumber(data.commissionBase) : undefined,
    commissionAmount: data.commissionAmount !== undefined ? toNumber(data.commissionAmount) : undefined,

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

export async function getReservationByDocId(reservationDocId: string) {
  const snap = await getDoc(doc(db, "reservations", reservationDocId));
  if (!snap.exists()) return null;
  return mapReservationDoc(snap.id, snap.data());
}

export async function getInvoiceByReservationDocId(reservationDocId: string) {
  const snap = await getDocs(
    query(
      collection(db, "invoices"),
      where("reservationDocId", "==", reservationDocId)
    )
  );
  for (const docSnap of snap.docs) {
    const inv = mapInvoiceDoc(docSnap.id, docSnap.data());
    if (!inv.isDeleted) return inv;
  }
  return null;
}

export async function getOrCreateInvoiceDraft(
  reservationDocId: string,
  staff: StaffUser
) {
  const existing = await getInvoiceByReservationDocId(reservationDocId);
  if (existing) return { success: true, invoice: existing, alreadyExists: true };

  const reservation = await getReservationByDocId(reservationDocId);
  if (!reservation) return { success: false, message: "예약 정보를 찾을 수 없습니다." };

  const birthInfo = getReservationBirthInfo(reservation);
  const invoiceId = makeInvoiceId(reservation);

  const payload = {
    invoiceId,
    reservationDocId: reservation.id,
    reservationId: reservation.reservationId,
    patientId: reservation.patientId,

    patientName: reservation.name || reservation.patientName,
    birth: birthInfo.birth,
    birthDisplay: (birthInfo.birthDisplay || "").replace(/[^0-9]/g, "").slice(2),
    gender: birthInfo.gender,
    nationality: reservation.nationality,
    phone: reservation.phone,

    doctors: reservation.doctors || [],
    coordinators: reservation.coordinators || [],

    hospitalName: reservation.hospital || "",
    surgeryItems: "",
    totalAmount: 0,

    memo: "",
    status: "draft",

    createdAt: serverTimestamp(),
    createdBy: staff.displayName,
    createdByUid: staff.uid,
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,

    isDeleted: false,
  };

  const invoiceDocRef = await addDoc(collection(db, "invoices"), payload);
  const invoiceDocId = invoiceDocRef.id;

  await updateDoc(doc(db, "reservations", reservationDocId), {
    invoiceId,
    invoiceDocId,
    invoiceStatus: "draft",
    invoiceUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  await createLog({
    action: "invoice_create",
    targetType: "invoice",
    targetId: invoiceDocId,
    patientId: reservation.patientId,
    reservationId: reservation.reservationId,
    staff,
    message: `${staff.displayName}님이 인보이스를 생성했습니다.`,
    before: null,
    after: { invoiceId, invoiceDocId },
  });

  return {
    success: true,
    invoice: mapInvoiceDoc(invoiceDocId, { ...payload, invoiceId }),
    alreadyExists: false,
  };
}

export async function updateInvoice(
  invoiceDocId: string,
  payload: InvoiceUpdatePayload,
  staff: StaffUser
) {
  const invoiceRef = doc(db, "invoices", invoiceDocId);
  const invoiceSnap = await getDoc(invoiceRef);

  if (!invoiceSnap.exists()) {
    return { success: false, message: "인보이스를 찾을 수 없습니다." };
  }

  const current = mapInvoiceDoc(invoiceSnap.id, invoiceSnap.data());

  const patch: Record<string, unknown> = {
    hospitalName: cleanText(payload.hospitalName),
    surgeryItems: cleanText(payload.surgeryItems),
    totalAmount: toNumber(payload.totalAmount),
    paymentMethod: payload.paymentMethod ?? null,
    cardAmount: payload.cardAmount ?? null,
    cashAmount: payload.cashAmount ?? null,
    commissionRate: payload.commissionRate ?? null,
    commissionStaffUid: payload.commissionStaffUid ?? null,
    commissionStaffName: payload.commissionStaffName ?? null,
    commissionBase: payload.commissionBase ?? null,
    commissionAmount: payload.commissionAmount ?? null,
    memo: cleanText(payload.memo),
    status: payload.status || current.status || "draft",
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
    isDeleted: false,
  };

  await updateDoc(invoiceRef, patch);

  await updateDoc(doc(db, "reservations", current.reservationDocId), {
    invoiceId: current.invoiceId,
    invoiceDocId,
    invoiceStatus: patch.status,
    invoiceUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  await createLog({
    action: "invoice_update",
    targetType: "invoice",
    targetId: current.invoiceId,
    patientId: current.patientId,
    reservationId: current.reservationId,
    staff,
    message: `${staff.displayName}님이 인보이스를 수정했습니다.`,
    before: null,
    after: { invoiceId: current.invoiceId, totalAmount: patch.totalAmount, status: patch.status },
  });

  return {
    success: true,
    invoice: mapInvoiceDoc(invoiceDocId, { ...current, ...patch }),
  };
}

export async function deleteInvoice(invoiceDocId: string, staff: StaffUser) {
  const invoiceRef = doc(db, "invoices", invoiceDocId);
  const invoiceSnap = await getDoc(invoiceRef);
  if (!invoiceSnap.exists()) return { success: false, message: "인보이스를 찾을 수 없습니다." };

  const current = mapInvoiceDoc(invoiceSnap.id, invoiceSnap.data());

  await updateDoc(invoiceRef, {
    isDeleted: true,
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  await updateDoc(doc(db, "reservations", current.reservationDocId), {
    invoiceId: "",
    invoiceDocId: "",
    invoiceStatus: "",
    invoiceUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  await createLog({
    action: "invoice_delete",
    targetType: "invoice",
    targetId: current.invoiceId,
    patientId: current.patientId,
    reservationId: current.reservationId,
    staff,
    message: `${staff.displayName}님이 인보이스를 삭제했습니다.`,
    before: { invoiceId: current.invoiceId },
    after: null,
  });

  return { success: true };
}

export type InvoiceListFilter = {
  startDate?: string;
  endDate?: string;
  status?: "draft" | "confirmed" | "void" | "";
  patientName?: string;
  commissionStaffUid?: string;
};

export async function getInvoices(filters?: InvoiceListFilter): Promise<InvoiceRecord[]> {
  const now = new Date();

  let q;
  if (!filters?.startDate && !filters?.endDate) {
    q = query(
      collection(db, "invoices"),
      orderBy("createdAt", "desc")
    );
  } else {
    const start = filters?.startDate
      ? new Date(filters.startDate + "T00:00:00")
      : new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const end = filters?.endDate
      ? new Date(filters.endDate + "T23:59:59")
      : now;
    q = query(
      collection(db, "invoices"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<=", Timestamp.fromDate(end)),
      orderBy("createdAt", "desc")
    );
  }

  const snap = await getDocs(q);
  let records = snap.docs
    .map((docSnap) => mapInvoiceDoc(docSnap.id, docSnap.data()))
    .filter((r) => !r.isDeleted);

  if (filters?.status) {
    records = records.filter((r) => r.status === filters.status);
  }

  if (filters?.patientName) {
    const search = filters.patientName.toLowerCase();
    records = records.filter((r) => r.patientName.toLowerCase().includes(search));
  }

  if (filters?.commissionStaffUid) {
    records = records.filter((r) => r.commissionStaffUid === filters.commissionStaffUid);
  }

  return records;
}
