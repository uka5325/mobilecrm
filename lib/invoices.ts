import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import type { StaffUser } from "./auth";
import { mapReservationDoc, type ReservationRecord } from "./reservations";
import { cleanText } from "./stringUtils";
import { toDate } from "./settingsUtils";
import { createLog } from "./logs";
import { getReservationBirthInfo } from "./reservationUtils";

export type InvoiceTemplate = {
  templateId: string;
  language: string;
  label: string;
  active: boolean;

  clinicTitleKo: string;
  mainTitle: string;
  invoiceTitle: string;

  patientInfoLabels: {
    name: string;
    birth: string;
    doctor: string;
    surgerySchedule: string;
    totalAmount: string;
    deposit: string;
  };

  regularPriceLabel: string;
  eventPriceLabel: string;
  totalLabel: string;
  balanceLabel: string;

  categoryOrder: string[];
  sectionOrder: string[];
};

export type InvoiceTemplateSection = {
  sectionId: string;
  templateId: string;
  type: string;
  titleKo: string;
  titleLocal: string;
  backgroundColor?: string;
  borderColor?: string;
  sortOrder: number;
  active: boolean;
  lines: {
    ko: string;
    local: string;
  }[];
};

export type InvoiceItemMaster = {
  itemId: string;
  categoryId: string;
  categoryKo: string;
  categoryLocal: string;

  nameKo: string;
  nameLocal: string;
  nameEn?: string;

  regularPrice: number;
  eventPrice: number;
  costPrice?: number;

  currency: string;
  active: boolean;
  sortOrder: number;
};

export type InvoiceItemSnapshot = InvoiceItemMaster & {
  selected: boolean;
  quantity: number;
  customRegularPrice: number | null;
  customEventPrice: number | null;
  finalRegularPrice: number;
  finalEventPrice: number;
};

export type InvoiceDiscount = {
  discountId: string;
  labelKo: string;
  labelLocal: string;
  type: "rate" | "amount";
  value: number;
  selected: boolean;
  amount: number;
};

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

  language: string;
  templateId: string;
  templateSnapshot: InvoiceTemplate | null;
  sectionsSnapshot: InvoiceTemplateSection[];

  items: InvoiceItemSnapshot[];
  discounts: InvoiceDiscount[];

  depositAmount: number;

  regularTotal: number;
  eventTotal: number;
  discountTotal: number;
  finalTotal: number;
  balanceAmount: number;

  memo: string;
  internalMemo: string;

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
  items: InvoiceItemSnapshot[];
  discounts: InvoiceDiscount[];
  depositAmount: number;
  memo?: string;
  internalMemo?: string;
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

  const birthInfo = getReservationBirthInfo(reservation);
  const birthPart =
    birthInfo.birthDisplay?.replace(/[^0-9]/g, "").slice(2) || "000000";

  const namePart = cleanText(reservation.name || reservation.patientName || "고객")
    .replace(/[\\/#?[\]*.]/g, " ")
    .replace(/\s+/g, "")
    .slice(0, 20);

  return `INV-${yy}${mm}${dd}-${namePart}-${birthPart}`;
}

function mapTemplate(id: string, data: Record<string, unknown>): InvoiceTemplate {
  return {
    templateId: cleanText(data.templateId || id),
    language: cleanText(data.language),
    label: cleanText(data.label),
    active: data.active === true,

    clinicTitleKo: cleanText(data.clinicTitleKo),
    mainTitle: cleanText(data.mainTitle),
    invoiceTitle: cleanText(data.invoiceTitle),

    patientInfoLabels: (() => {
      const labels = data.patientInfoLabels as Record<string, unknown> | undefined;
      return {
        name: cleanText(labels?.name),
        birth: cleanText(labels?.birth),
        doctor: cleanText(labels?.doctor),
        surgerySchedule: cleanText(labels?.surgerySchedule),
        totalAmount: cleanText(labels?.totalAmount),
        deposit: cleanText(labels?.deposit),
      };
    })(),

    regularPriceLabel: cleanText(data.regularPriceLabel),
    eventPriceLabel: cleanText(data.eventPriceLabel),
    totalLabel: cleanText(data.totalLabel),
    balanceLabel: cleanText(data.balanceLabel),

    categoryOrder: Array.isArray(data.categoryOrder) ? data.categoryOrder : [],
    sectionOrder: Array.isArray(data.sectionOrder) ? data.sectionOrder : [],
  };
}

function mapSection(id: string, data: Record<string, unknown>): InvoiceTemplateSection {
  return {
    sectionId: cleanText(data.sectionId || id),
    templateId: cleanText(data.templateId),
    type: cleanText(data.type),
    titleKo: cleanText(data.titleKo),
    titleLocal: cleanText(data.titleLocal),
    backgroundColor: cleanText(data.backgroundColor),
    borderColor: cleanText(data.borderColor),
    sortOrder: toNumber(data.sortOrder),
    active: data.active === true,
    lines: Array.isArray(data.lines)
      ? data.lines.map((line: unknown) => ({
          ko: cleanText((line as Record<string, unknown>)?.ko),
          local: cleanText((line as Record<string, unknown>)?.local),
        }))
      : [],
  };
}

function mapItem(id: string, data: Record<string, unknown>): InvoiceItemMaster {
  return {
    itemId: cleanText(data.itemId || id),
    categoryId: cleanText(data.categoryId),
    categoryKo: cleanText(data.categoryKo),
    categoryLocal: cleanText(data.categoryLocal),

    nameKo: cleanText(data.nameKo),
    nameLocal: cleanText(data.nameLocal),
    nameEn: cleanText(data.nameEn),

    regularPrice: toNumber(data.regularPrice),
    eventPrice: toNumber(data.eventPrice),
    costPrice: toNumber(data.costPrice),

    currency: cleanText(data.currency || "KRW"),
    active: data.active === true,
    sortOrder: toNumber(data.sortOrder),
  };
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

    language: cleanText(data.language || "mn"),
    templateId: cleanText(data.templateId || "template_mn"),
    templateSnapshot: (data.templateSnapshot as InvoiceTemplate) || null,
    sectionsSnapshot: Array.isArray(data.sectionsSnapshot)
      ? (data.sectionsSnapshot as InvoiceTemplateSection[])
      : [],

    items: Array.isArray(data.items) ? (data.items as InvoiceItemSnapshot[]) : [],
    discounts: Array.isArray(data.discounts) ? (data.discounts as InvoiceDiscount[]) : [],

    depositAmount: toNumber(data.depositAmount),

    regularTotal: toNumber(data.regularTotal),
    eventTotal: toNumber(data.eventTotal),
    discountTotal: toNumber(data.discountTotal),
    finalTotal: toNumber(data.finalTotal),
    balanceAmount: toNumber(data.balanceAmount),

    memo: cleanText(data.memo),
    internalMemo: cleanText(data.internalMemo),

    status: (["draft", "confirmed", "void"].includes(String(data.status)) ? data.status : "draft") as "draft" | "confirmed" | "void",

    createdAt: data.createdAt,
    createdBy: cleanText(data.createdBy),
    createdByUid: cleanText(data.createdByUid),

    updatedAt: data.updatedAt,
    updatedBy: cleanText(data.updatedBy),
    updatedByUid: cleanText(data.updatedByUid),

    isDeleted: data.isDeleted === true,
  };
}

export function calculateInvoiceTotals(
  items: InvoiceItemSnapshot[],
  discounts: InvoiceDiscount[],
  depositAmount: number
) {
  const selectedItems = items.filter((item) => item.selected);

  const regularTotal = selectedItems.reduce((sum, item) => {
    const price =
      item.customRegularPrice !== null
        ? item.customRegularPrice
        : item.finalRegularPrice;
    return sum + price * (item.quantity || 1);
  }, 0);

  const eventTotal = selectedItems.reduce((sum, item) => {
    const price =
      item.customEventPrice !== null
        ? item.customEventPrice
        : item.finalEventPrice;
    return sum + price * (item.quantity || 1);
  }, 0);

  const calculatedDiscounts = discounts.map((discount) => {
    if (!discount.selected) {
      return {
        ...discount,
        amount: 0,
      };
    }

    if (discount.type === "rate") {
      return {
        ...discount,
        amount: Math.floor((eventTotal * discount.value) / 100),
      };
    }

    return {
      ...discount,
      amount: discount.value,
    };
  });

  const discountTotal = calculatedDiscounts.reduce(
    (sum, discount) => sum + discount.amount,
    0
  );

  const finalTotal = Math.max(eventTotal - discountTotal, 0);
  const balanceAmount = Math.max(finalTotal - depositAmount, 0);

  return {
    regularTotal,
    eventTotal,
    discounts: calculatedDiscounts,
    discountTotal,
    finalTotal,
    balanceAmount,
  };
}

export async function getInvoiceTemplate(templateId = "template_mn") {
  const snap = await getDoc(doc(db, "invoiceTemplates", templateId));
  if (!snap.exists()) return null;
  return mapTemplate(snap.id, snap.data());
}

export async function getInvoiceSections(templateId = "template_mn") {
  const snap = await getDocs(collection(db, "invoiceTemplateSections"));

  return snap.docs
    .map((docSnap) => mapSection(docSnap.id, docSnap.data()))
    .filter((section) => section.templateId === templateId && section.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getInvoiceItemMasters() {
  const snap = await getDocs(collection(db, "invoiceItems"));

  return snap.docs
    .map((docSnap) => mapItem(docSnap.id, docSnap.data()))
    .filter((item) => item.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
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
      where("reservationDocId", "==", reservationDocId),
      where("isDeleted", "==", false)
    )
  );

  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return mapInvoiceDoc(docSnap.id, docSnap.data());
}

export function buildInitialDiscounts(): InvoiceDiscount[] {
  return [
    {
      discountId: "x3_review_discount",
      labelKo: "X3C 후기조건 추가 할인",
      labelLocal: "X3C...",
      type: "rate",
      value: 10,
      selected: false,
      amount: 0,
    },
    {
      discountId: "return_visit_discount",
      labelKo: "재방문 추가 할인",
      labelLocal: "Зөвлөхийн нэмэлт хөнгөлөлт",
      type: "amount",
      value: 100000,
      selected: false,
      amount: 0,
    },
  ];
}

export function buildInvoiceItemsFromMasters(
  masters: InvoiceItemMaster[]
): InvoiceItemSnapshot[] {
  return masters.map((item) => ({
    ...item,
    selected: false,
    quantity: 1,
    customRegularPrice: null,
    customEventPrice: null,
    finalRegularPrice: item.regularPrice,
    finalEventPrice: item.eventPrice,
  }));
}

export async function createInvoiceDraftFromReservation(
  reservationDocId: string,
  staff: StaffUser,
  templateId = "template_mn"
) {
  const existing = await getInvoiceByReservationDocId(reservationDocId);
  if (existing) {
    return {
      success: true,
      invoice: existing,
      alreadyExists: true,
    };
  }

  const [reservation, template, sections, itemMasters] = await Promise.all([
    getReservationByDocId(reservationDocId),
    getInvoiceTemplate(templateId),
    getInvoiceSections(templateId),
    getInvoiceItemMasters(),
  ]);

  if (!reservation) {
    return {
      success: false,
      message: "예약 정보를 찾을 수 없습니다.",
    };
  }

  if (!template) {
    return {
      success: false,
      message: "인보이스 템플릿을 찾을 수 없습니다.",
    };
  }

  const birthInfo = getReservationBirthInfo(reservation);
  const invoiceId = makeInvoiceId(reservation);
  const invoiceDocRef = doc(db, "invoices", invoiceId);

  const items = buildInvoiceItemsFromMasters(itemMasters);
  const discounts = buildInitialDiscounts();
  const depositAmount = toNumber(reservation.depositAmount);

  const totals = calculateInvoiceTotals(items, discounts, depositAmount);

  const payload = {
    invoiceId,

    reservationDocId: reservation.id,
    reservationId: reservation.reservationId,
    patientId: reservation.patientId,

    patientName: reservation.name || reservation.patientName,
    birth: birthInfo.birth,
    birthDisplay: birthInfo.birthDisplay.replace(/[^0-9]/g, "").slice(2),
    gender: birthInfo.gender,
    nationality: reservation.nationality,
    phone: reservation.phone,

    doctors: reservation.doctors || [],
    coordinators: reservation.coordinators || [],

    language: template.language || "mn",
    templateId: template.templateId,
    templateSnapshot: template,
    sectionsSnapshot: sections,

    items,
    discounts: totals.discounts,

    depositAmount,

    regularTotal: totals.regularTotal,
    eventTotal: totals.eventTotal,
    discountTotal: totals.discountTotal,
    finalTotal: totals.finalTotal,
    balanceAmount: totals.balanceAmount,

    memo: "",
    internalMemo: "",

    status: "draft",

    createdAt: serverTimestamp(),
    createdBy: staff.displayName,
    createdByUid: staff.uid,

    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,

    isDeleted: false,
  };

  await setDoc(invoiceDocRef, payload);

  await updateDoc(doc(db, "reservations", reservationDocId), {
    invoiceId,
    invoiceDocId: invoiceId,
    invoiceStatus: "draft",
    invoiceUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  await createLog({
    action: "invoice_create",
    targetType: "invoice",
    targetId: invoiceId,
    patientId: reservation.patientId,
    reservationId: reservation.reservationId,
    staff,
    message: `${staff.displayName}님이 CRM 인보이스를 생성했습니다.`,
    before: null,
    after: {
      invoiceId,
      templateId,
    },
  });

  return {
    success: true,
    invoice: mapInvoiceDoc(invoiceId, payload),
    alreadyExists: false,
  };
}

export async function getOrCreateInvoiceDraft(
  reservationDocId: string,
  staff: StaffUser,
  templateId = "template_mn"
) {
  const existing = await getInvoiceByReservationDocId(reservationDocId);

  if (existing) {
    return {
      success: true,
      invoice: existing,
      alreadyExists: true,
    };
  }

  return createInvoiceDraftFromReservation(reservationDocId, staff, templateId);
}

export type InvoiceListFilter = {
  startDate?: string;
  endDate?: string;
  status?: "draft" | "confirmed" | "void" | "";
  doctorName?: string;
  patientName?: string;
};

export async function getInvoices(filters?: InvoiceListFilter): Promise<InvoiceRecord[]> {
  let q = query(
    collection(db, "invoices"),
    where("isDeleted", "==", false),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(q);
  let records = snap.docs.map((docSnap) => mapInvoiceDoc(docSnap.id, docSnap.data()));

  if (filters?.status) {
    records = records.filter((r) => r.status === filters.status);
  }

  if (filters?.doctorName) {
    records = records.filter((r) =>
      r.doctors.some((d) => d.includes(filters.doctorName!))
    );
  }

  if (filters?.patientName) {
    const q2 = filters.patientName.toLowerCase();
    records = records.filter((r) => r.patientName.toLowerCase().includes(q2));
  }

  if (filters?.startDate) {
    records = records.filter((r) => {
      const d = toDate(r.createdAt);
      return d ? d.toISOString().slice(0, 10) >= filters.startDate! : true;
    });
  }

  if (filters?.endDate) {
    records = records.filter((r) => {
      const d = toDate(r.createdAt);
      return d ? d.toISOString().slice(0, 10) <= filters.endDate! : true;
    });
  }

  return records;
}

export async function saveInvoiceTemplateOrder(
  templateId: string,
  categoryOrder: string[],
  sectionOrder: string[]
) {
  await updateDoc(doc(db, "invoiceTemplates", templateId), {
    categoryOrder,
    sectionOrder,
    updatedAt: serverTimestamp(),
  });
}

export async function updateInvoice(
  invoiceDocId: string,
  payload: InvoiceUpdatePayload,
  staff: StaffUser
) {
  const invoiceRef = doc(db, "invoices", invoiceDocId);
  const invoiceSnap = await getDoc(invoiceRef);

  if (!invoiceSnap.exists()) {
    return {
      success: false,
      message: "인보이스를 찾을 수 없습니다.",
    };
  }

  const current = mapInvoiceDoc(invoiceSnap.id, invoiceSnap.data());

  const totals = calculateInvoiceTotals(
    payload.items,
    payload.discounts,
    toNumber(payload.depositAmount)
  );

  const patch = {
    items: payload.items,
    discounts: totals.discounts,

    depositAmount: toNumber(payload.depositAmount),

    regularTotal: totals.regularTotal,
    eventTotal: totals.eventTotal,
    discountTotal: totals.discountTotal,
    finalTotal: totals.finalTotal,
    balanceAmount: totals.balanceAmount,

    memo: cleanText(payload.memo),
    internalMemo: cleanText(payload.internalMemo),
    status: payload.status || current.status || "draft",

    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,

    isDeleted: false,
  };

  await updateDoc(invoiceRef, patch);

  await updateDoc(doc(db, "reservations", current.reservationDocId), {
    invoiceId: current.invoiceId,
    invoiceDocId: invoiceDocId,
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
    message: `${staff.displayName}님이 CRM 인보이스를 수정 저장했습니다.`,
    before: null,
    after: {
      invoiceId: current.invoiceId,
      finalTotal: totals.finalTotal,
      balanceAmount: totals.balanceAmount,
      status: patch.status,
    },
  });

  return {
    success: true,
    invoice: mapInvoiceDoc(invoiceDocId, {
      ...current,
      ...patch,
    }),
  };
}
