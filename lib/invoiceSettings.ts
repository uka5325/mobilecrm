import {
  collection,
  doc,
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
import { createLog } from "./logs";

export type InvoiceCurrency = "KRW" | "USD" | "JPY" | "CNY" | "MNT" | "VND";

export type InvoiceCategory = {
  id: string;
  categoryId: string;

  nameKo: string;
  nameEn: string;
  nameLocal: string;

  active: boolean;
  sortOrder: number;

  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByUid?: string;
};

export type InvoiceItem = {
  id: string;
  itemId: string;

  categoryId: string;
  categoryKo: string;
  categoryLocal: string;

  nameKo: string;
  nameEn: string;
  nameLocal: string;

  regularPrice: number;
  eventPrice: number;
  costPrice: number;
  currency: InvoiceCurrency | string;

  active: boolean;
  sortOrder: number;

  memo?: string;
  descriptionKo?: string;
  descriptionEn?: string;
  descriptionLocal?: string;

  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByUid?: string;
};

export type InvoiceTemplateSection = {
  id: string;
  sectionId: string;

  titleKo: string;
  titleEn: string;
  titleLocal: string;

  contentKo: string;
  contentEn: string;
  contentLocal: string;

  active: boolean;
  sortOrder: number;

  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByUid?: string;
};

export type InvoiceTemplate = {
  id: string;
  templateId: string;

  titleKo: string;
  titleEn: string;
  titleLocal: string;

  hospitalNameKo: string;
  hospitalNameEn: string;
  hospitalNameLocal: string;

  footerKo: string;
  footerEn: string;
  footerLocal: string;

  language: string;
  active: boolean;
  sortOrder: number;

  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByUid?: string;
};

export type SaveInvoiceCategoryParams = {
  categoryId?: string;
  nameKo: string;
  nameEn?: string;
  nameLocal?: string;
  active?: boolean;
  sortOrder?: number;
};

export type SaveInvoiceItemParams = {
  itemId?: string;

  categoryId: string;
  categoryKo?: string;
  categoryLocal?: string;

  nameKo: string;
  nameEn?: string;
  nameLocal?: string;

  regularPrice?: number | string;
  eventPrice?: number | string;
  costPrice?: number | string;
  currency?: InvoiceCurrency | string;

  active?: boolean;
  sortOrder?: number;

  memo?: string;
  descriptionKo?: string;
  descriptionEn?: string;
  descriptionLocal?: string;
};

export type SaveInvoiceTemplateSectionParams = {
  sectionId?: string;

  titleKo: string;
  titleEn?: string;
  titleLocal?: string;

  contentKo?: string;
  contentEn?: string;
  contentLocal?: string;

  active?: boolean;
  sortOrder?: number;
};

export type SaveInvoiceTemplateParams = {
  templateId?: string;

  titleKo: string;
  titleEn?: string;
  titleLocal?: string;

  hospitalNameKo?: string;
  hospitalNameEn?: string;
  hospitalNameLocal?: string;

  footerKo?: string;
  footerEn?: string;
  footerLocal?: string;

  language?: string;
  active?: boolean;
  sortOrder?: number;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function cleanNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = cleanText(value).replace(/,/g, "");
  const num = Number(raw);

  if (Number.isFinite(num)) return num;

  return fallback;
}

function normalizeBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;

  return fallback;
}

function makeSafeId(value: string, prefix: string) {
  const raw = cleanText(value)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_가-힣-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (raw) return raw;

  return `${prefix}_${Date.now()}`;
}

function sortByOrder<
  T extends { sortOrder: number; nameKo?: string; titleKo?: string },
>(rows: T[]) {
  return [...rows].sort((a, b) => {
    return (
      cleanNumber(a.sortOrder, 999999) -
        cleanNumber(b.sortOrder, 999999) ||
      cleanText(a.nameKo || a.titleKo).localeCompare(
        cleanText(b.nameKo || b.titleKo)
      )
    );
  });
}

function mapCategory(id: string, data: Record<string, unknown>): InvoiceCategory {
  return {
    id,
    categoryId: cleanText(data.categoryId || id),

    nameKo: cleanText(data.nameKo || data.categoryKo),
    nameEn: cleanText(data.nameEn),
    nameLocal: cleanText(data.nameLocal || data.categoryLocal),

    active: normalizeBoolean(data.active, true),
    sortOrder: cleanNumber(data.sortOrder, 999999),

    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    updatedBy: cleanText(data.updatedBy),
    updatedByUid: cleanText(data.updatedByUid),
  };
}

function mapItem(id: string, data: Record<string, unknown>): InvoiceItem {
  return {
    id,
    itemId: cleanText(data.itemId || id),

    categoryId: cleanText(data.categoryId),
    categoryKo: cleanText(data.categoryKo),
    categoryLocal: cleanText(data.categoryLocal),

    nameKo: cleanText(data.nameKo),
    nameEn: cleanText(data.nameEn),
    nameLocal: cleanText(data.nameLocal),

    regularPrice: cleanNumber(data.regularPrice),
    eventPrice: cleanNumber(data.eventPrice),
    costPrice: cleanNumber(data.costPrice),
    currency: cleanText(data.currency || "KRW"),

    active: normalizeBoolean(data.active, true),
    sortOrder: cleanNumber(data.sortOrder, 999999),

    memo: cleanText(data.memo),
    descriptionKo: cleanText(data.descriptionKo),
    descriptionEn: cleanText(data.descriptionEn),
    descriptionLocal: cleanText(data.descriptionLocal),

    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    updatedBy: cleanText(data.updatedBy),
    updatedByUid: cleanText(data.updatedByUid),
  };
}

function mapSection(id: string, data: Record<string, unknown>): InvoiceTemplateSection {
  return {
    id,
    sectionId: cleanText(data.sectionId || id),

    titleKo: cleanText(data.titleKo),
    titleEn: cleanText(data.titleEn),
    titleLocal: cleanText(data.titleLocal),

    contentKo: cleanText(data.contentKo),
    contentEn: cleanText(data.contentEn),
    contentLocal: cleanText(data.contentLocal),

    active: normalizeBoolean(data.active, true),
    sortOrder: cleanNumber(data.sortOrder, 999999),

    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    updatedBy: cleanText(data.updatedBy),
    updatedByUid: cleanText(data.updatedByUid),
  };
}

function mapTemplate(id: string, data: Record<string, unknown>): InvoiceTemplate {
  return {
    id,
    templateId: cleanText(data.templateId || id),

    titleKo: cleanText(data.titleKo),
    titleEn: cleanText(data.titleEn),
    titleLocal: cleanText(data.titleLocal),

    hospitalNameKo: cleanText(data.hospitalNameKo),
    hospitalNameEn: cleanText(data.hospitalNameEn),
    hospitalNameLocal: cleanText(data.hospitalNameLocal),

    footerKo: cleanText(data.footerKo),
    footerEn: cleanText(data.footerEn),
    footerLocal: cleanText(data.footerLocal),

    language: cleanText(data.language || "mn"),
    active: normalizeBoolean(data.active, true),
    sortOrder: cleanNumber(data.sortOrder, 999999),

    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    updatedBy: cleanText(data.updatedBy),
    updatedByUid: cleanText(data.updatedByUid),
  };
}

async function logInvoiceSettingChange({
  staff,
  targetId,
  message,
  before,
  after,
}: {
  staff: StaffUser;
  targetId: string;
  message: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}) {
  await createLog({
    action: "settings_update",
    targetType: "settings",
    targetId,
    staff,
    message,
    before: before || null,
    after: after || null,
  });
}

/**
 * 대분류
 */
export async function getInvoiceCategories(includeInactive = true) {
  const snap = await getDocs(
    query(collection(db, "invoiceCategories"), orderBy("sortOrder", "asc"))
  );

  const rows = snap.docs
    .map((docSnap) => mapCategory(docSnap.id, docSnap.data()))
    .filter((item) => includeInactive || item.active);

  return sortByOrder(rows);
}

export async function saveInvoiceCategory(
  params: SaveInvoiceCategoryParams,
  staff: StaffUser
) {
  const nameKo = cleanText(params.nameKo);

  if (!nameKo) {
    throw new Error("대분류명을 입력하세요.");
  }

  const categoryId =
    cleanText(params.categoryId) || makeSafeId(nameKo, "category");

  const ref = doc(db, "invoiceCategories", categoryId);

  const payload = {
    categoryId,

    nameKo,
    nameEn: cleanText(params.nameEn),
    nameLocal: cleanText(params.nameLocal),

    active: params.active ?? true,
    sortOrder: cleanNumber(params.sortOrder, 999999),

    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  };

  await setDoc(
    ref,
    {
      ...payload,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  await logInvoiceSettingChange({
    staff,
    targetId: categoryId,
    message: `${staff.displayName}님이 인보이스 대분류를 저장했습니다: ${nameKo}`,
    after: payload,
  });

  return {
    success: true,
    categoryId,
  };
}

export async function deactivateInvoiceCategory(
  categoryId: string,
  staff: StaffUser
) {
  const id = cleanText(categoryId);

  if (!id) {
    throw new Error("대분류 ID가 없습니다.");
  }

  await updateDoc(doc(db, "invoiceCategories", id), {
    active: false,
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  await logInvoiceSettingChange({
    staff,
    targetId: id,
    message: `${staff.displayName}님이 인보이스 대분류를 비활성화했습니다: ${id}`,
    after: {
      active: false,
    },
  });

  return {
    success: true,
  };
}

/**
 * 소분류 / 수술항목
 */
export async function getInvoiceItems(options?: {
  includeInactive?: boolean;
  categoryId?: string;
}) {
  const includeInactive = options?.includeInactive ?? true;
  const categoryId = cleanText(options?.categoryId);

  const baseQuery = categoryId
    ? query(
        collection(db, "invoiceItems"),
        where("categoryId", "==", categoryId),
        orderBy("sortOrder", "asc")
      )
    : query(collection(db, "invoiceItems"), orderBy("sortOrder", "asc"));

  const snap = await getDocs(baseQuery);

  const rows = snap.docs
    .map((docSnap) => mapItem(docSnap.id, docSnap.data()))
    .filter((item) => includeInactive || item.active);

  return sortByOrder(rows);
}

export async function saveInvoiceItem(
  params: SaveInvoiceItemParams,
  staff: StaffUser
) {
  const nameKo = cleanText(params.nameKo);
  const categoryId = cleanText(params.categoryId);

  if (!categoryId) {
    throw new Error("대분류를 선택하세요.");
  }

  if (!nameKo) {
    throw new Error("수술항목명을 입력하세요.");
  }

  const itemId =
    cleanText(params.itemId) ||
    makeSafeId(`${categoryId}_${nameKo}`, "invoice_item");

  const ref = doc(db, "invoiceItems", itemId);

  const payload = {
    itemId,

    categoryId,
    categoryKo: cleanText(params.categoryKo),
    categoryLocal: cleanText(params.categoryLocal),

    nameKo,
    nameEn: cleanText(params.nameEn),
    nameLocal: cleanText(params.nameLocal),

    regularPrice: cleanNumber(params.regularPrice),
    eventPrice: cleanNumber(params.eventPrice),
    costPrice: cleanNumber(params.costPrice),
    currency: cleanText(params.currency || "KRW"),

    active: params.active ?? true,
    sortOrder: cleanNumber(params.sortOrder, 999999),

    memo: cleanText(params.memo),
    descriptionKo: cleanText(params.descriptionKo),
    descriptionEn: cleanText(params.descriptionEn),
    descriptionLocal: cleanText(params.descriptionLocal),

    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  };

  await setDoc(
    ref,
    {
      ...payload,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  await logInvoiceSettingChange({
    staff,
    targetId: itemId,
    message: `${staff.displayName}님이 인보이스 수술항목을 저장했습니다: ${nameKo}`,
    after: payload,
  });

  return {
    success: true,
    itemId,
  };
}

export async function deactivateInvoiceItem(itemId: string, staff: StaffUser) {
  const id = cleanText(itemId);

  if (!id) {
    throw new Error("항목 ID가 없습니다.");
  }

  await updateDoc(doc(db, "invoiceItems", id), {
    active: false,
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  await logInvoiceSettingChange({
    staff,
    targetId: id,
    message: `${staff.displayName}님이 인보이스 수술항목을 비활성화했습니다: ${id}`,
    after: {
      active: false,
    },
  });

  return {
    success: true,
  };
}

/**
 * 안내사항
 */
export async function getInvoiceTemplateSections(includeInactive = true) {
  const snap = await getDocs(
    query(
      collection(db, "invoiceTemplateSections"),
      orderBy("sortOrder", "asc")
    )
  );

  const rows = snap.docs
    .map((docSnap) => mapSection(docSnap.id, docSnap.data()))
    .filter((item) => includeInactive || item.active);

  return sortByOrder(rows);
}

export async function saveInvoiceTemplateSection(
  params: SaveInvoiceTemplateSectionParams,
  staff: StaffUser
) {
  const titleKo = cleanText(params.titleKo);

  if (!titleKo) {
    throw new Error("안내사항 제목을 입력하세요.");
  }

  const sectionId =
    cleanText(params.sectionId) || makeSafeId(titleKo, "section");

  const ref = doc(db, "invoiceTemplateSections", sectionId);

  const payload = {
    sectionId,

    titleKo,
    titleEn: cleanText(params.titleEn),
    titleLocal: cleanText(params.titleLocal),

    contentKo: cleanText(params.contentKo),
    contentEn: cleanText(params.contentEn),
    contentLocal: cleanText(params.contentLocal),

    active: params.active ?? true,
    sortOrder: cleanNumber(params.sortOrder, 999999),

    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  };

  await setDoc(
    ref,
    {
      ...payload,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  await logInvoiceSettingChange({
    staff,
    targetId: sectionId,
    message: `${staff.displayName}님이 인보이스 안내사항을 저장했습니다: ${titleKo}`,
    after: payload,
  });

  return {
    success: true,
    sectionId,
  };
}

export async function deactivateInvoiceTemplateSection(
  sectionId: string,
  staff: StaffUser
) {
  const id = cleanText(sectionId);

  if (!id) {
    throw new Error("안내사항 ID가 없습니다.");
  }

  await updateDoc(doc(db, "invoiceTemplateSections", id), {
    active: false,
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  await logInvoiceSettingChange({
    staff,
    targetId: id,
    message: `${staff.displayName}님이 인보이스 안내사항을 비활성화했습니다: ${id}`,
    after: {
      active: false,
    },
  });

  return {
    success: true,
  };
}

/**
 * 제목 / 템플릿
 */
export async function getInvoiceTemplates(includeInactive = true) {
  const snap = await getDocs(
    query(collection(db, "invoiceTemplates"), orderBy("sortOrder", "asc"))
  );

  const rows = snap.docs
    .map((docSnap) => mapTemplate(docSnap.id, docSnap.data()))
    .filter((item) => includeInactive || item.active);

  return sortByOrder(rows);
}

export async function saveInvoiceTemplate(
  params: SaveInvoiceTemplateParams,
  staff: StaffUser
) {
  const titleKo = cleanText(params.titleKo);

  if (!titleKo) {
    throw new Error("인보이스 제목을 입력하세요.");
  }

  const templateId =
    cleanText(params.templateId) || makeSafeId(titleKo, "template");

  const ref = doc(db, "invoiceTemplates", templateId);

  const payload = {
    templateId,

    titleKo,
    titleEn: cleanText(params.titleEn),
    titleLocal: cleanText(params.titleLocal),

    hospitalNameKo: cleanText(params.hospitalNameKo),
    hospitalNameEn: cleanText(params.hospitalNameEn),
    hospitalNameLocal: cleanText(params.hospitalNameLocal),

    footerKo: cleanText(params.footerKo),
    footerEn: cleanText(params.footerEn),
    footerLocal: cleanText(params.footerLocal),

    language: cleanText(params.language || "mn"),
    active: params.active ?? true,
    sortOrder: cleanNumber(params.sortOrder, 999999),

    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  };

  await setDoc(
    ref,
    {
      ...payload,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  await logInvoiceSettingChange({
    staff,
    targetId: templateId,
    message: `${staff.displayName}님이 인보이스 템플릿을 저장했습니다: ${titleKo}`,
    after: payload,
  });

  return {
    success: true,
    templateId,
  };
}

export async function deactivateInvoiceTemplate(
  templateId: string,
  staff: StaffUser
) {
  const id = cleanText(templateId);

  if (!id) {
    throw new Error("템플릿 ID가 없습니다.");
  }

  await updateDoc(doc(db, "invoiceTemplates", id), {
    active: false,
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  await logInvoiceSettingChange({
    staff,
    targetId: id,
    message: `${staff.displayName}님이 인보이스 템플릿을 비활성화했습니다: ${id}`,
    after: {
      active: false,
    },
  });

  return {
    success: true,
  };
}
