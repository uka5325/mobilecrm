import { auth, db } from "./firebase";
import { collection, onSnapshot, query, where, getDocs, limit } from "firebase/firestore";
import type { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";
import { createLog } from "./logs";
import { parseBirthInfo } from "./reservationUtils";

async function callReservationsApi(action: string, payload: Record<string, unknown>) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    return { success: false as const, message: "로그인 상태를 확인할 수 없습니다. 페이지를 새로고침 후 다시 시도해주세요." };
  }
  const idToken = await firebaseUser.getIdToken();
  const res = await fetch("/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action, payload }),
  });
  if (!res.ok) return { success: false as const, message: `서버 오류 (${res.status})` };
  return res.json() as Promise<Record<string, unknown> & { success: boolean; message?: string }>;
}

export type DoctorOption = {
  uid: string;
  displayName: string;
  email: string;
  orderNo: number;
};

export type AppointmentType = "상담" | "수술" | "치료" | "경과" | "진료" | "검진";

export const APPOINTMENT_TYPES: AppointmentType[] = ["상담", "수술", "치료", "경과", "진료", "검진"];

export const APPOINTMENT_TYPE_COLORS: Record<AppointmentType, string> = {
  상담: "#2563eb",
  수술: "#ef4444",
  치료: "#16a34a",
  경과: "#f59e0b",
  진료: "#7c3aed",
  검진: "#0891b2",
};

export type ReservationStatus =
  | "내원전"
  | "대기"
  | "원상중"
  | "후상중"
  | "귀가"
  | "부도";

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

  operationStatus: ReservationStatus;
  preConsStatus: string;
  surgeryReserved: boolean;
  surgeryReservedAt?: string;

  depositAmount: string;
  surgeryCost: string;
  consultArea: string;

  doctors: string[];
  coordinators: string[];

  doctorStatusMap: Record<string, ReservationStatus | string>;
  doctorStatusMetaMap: Record<
    string,
    {
      status: string;
      updatedAt: string;
      updatedBy: string;
      updatedRole: string;
    }
  >;

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
  depositAmount?: string;
  surgeryCost?: string;
  reservationId?: string;
  patientId?: string;
};


function cleanNumber(value: unknown, fallback = 999999) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function makeDateBasedId(prefix: "P" | "R") {
  const now = new Date();

  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const random = Math.floor(100000 + Math.random() * 900000);

  return `${prefix}-${y}${m}${d}-${random}`;
}

function normalizeReservationStatus(value: unknown): ReservationStatus {
  const v = cleanText(value);

  if (
    v === "내원전" ||
    v === "대기" ||
    v === "원상중" ||
    v === "후상중" ||
    v === "귀가" ||
    v === "부도"
  ) {
    return v;
  }

  return "내원전";
}

function normalizeDuplicateKey(params: CreateReservationParams) {
  const doctors = Array.isArray(params.doctors)
    ? params.doctors.map(cleanText).filter(Boolean).sort().join("|")
    : "";

  return [
    cleanText(params.name).toLowerCase(),
    cleanText(params.reservationDate),
    cleanText(params.reservationTime),
    cleanText(params.phone).replace(/[^0-9+]/g, ""),
    cleanText(params.hospital),
    doctors,
  ].join("__");
}

function normalizeAppointmentType(value: unknown): AppointmentType {
  const v = cleanText(value);
  if (v === "상담" || v === "수술" || v === "치료" || v === "경과" || v === "진료" || v === "검진") return v;
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

    operationStatus: normalizeReservationStatus(data.operationStatus),
    preConsStatus: cleanText(data.preConsStatus),
    surgeryReserved: data.surgeryReserved === true,
    surgeryReservedAt: cleanText(data.surgeryReservedAt),

    depositAmount: cleanText(data.depositAmount),
    surgeryCost: cleanText(data.surgeryCost),
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

    doctorStatusMap: (data.doctorStatusMap as Record<string, string>) || {},
    doctorStatusMetaMap: (data.doctorStatusMetaMap as ReservationRecord["doctorStatusMetaMap"]) || {},

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


const DOCTORS_CACHE_KEY = "crm_doctors_v1";

function getCachedDoctors(): DoctorOption[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DOCTORS_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCachedDoctors(doctors: DoctorOption[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DOCTORS_CACHE_KEY, JSON.stringify(doctors));
  } catch {}
}

function sortDoctors(doctors: DoctorOption[]) {
  return [...doctors].sort((a, b) => {
    return (
      cleanNumber(a.orderNo) -
        cleanNumber(b.orderNo) ||
      a.displayName.localeCompare(b.displayName)
    );
  });
}

function makeDoctorOptionsFromReservations(
  reservations: ReservationRecord[]
): DoctorOption[] {
  const names = Array.from(
    new Set(
      reservations
        .flatMap((item) => item.doctors || [])
        .map(cleanText)
        .filter(Boolean)
    )
  );

  return names.map((name, index) => ({
    uid: `fallback-doctor-${index}-${name}`,
    displayName: name,
    email: "",
    orderNo: index + 1,
  }));
}

let _doctorsPromise: Promise<DoctorOption[]> | null = null;
let _doctorsCachedAt = 0;
const DOCTORS_TTL_MS = 10 * 60 * 1000;

export async function getDoctors(): Promise<DoctorOption[]> {
  if (_doctorsPromise && Date.now() - _doctorsCachedAt < DOCTORS_TTL_MS) return _doctorsPromise;

  _doctorsCachedAt = Date.now();
  _doctorsPromise = (async () => {
    try {
      const result = await callReservationsApi("read_doctors", {});
      const rawDoctors = (result.doctors as Record<string, unknown>[] | undefined) || [];

      const doctors = rawDoctors
        .map((d) => ({
          uid: String(d.id || ""),
          displayName: cleanText(d.displayName || d["display_name"] || d.name),
          email: cleanText(d.email),
          orderNo: cleanNumber(d.orderNo ?? d["order_no"]),
          role: String(d.role || ""),
          active: d.active,
        }))
        .filter((d) => d.displayName && d.role === "doctor" && d.active !== false);

      setCachedDoctors(sortDoctors(doctors));
      return sortDoctors(doctors);
    } catch (e) {
      _doctorsPromise = null;
      throw e;
    }
  })();

  return _doctorsPromise;
}

export function invalidateDoctorsCache() {
  _doctorsPromise = null;
  _doctorsCachedAt = 0;
}

export async function getAllReservations(): Promise<{
  reservations: ReservationRecord[];
  doctors: DoctorOption[];
}> {
  const fromDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 45);
    return d.toISOString().slice(0, 10);
  })();

  const result = await callReservationsApi("read_all", { from: fromDate });
  const rawReservations = (result.reservations as Record<string, unknown>[] | undefined) || [];
  const rawDoctors = (result.doctors as Record<string, unknown>[] | undefined) || [];

  const reservations = rawReservations
    .map((r) => mapReservationDoc(String(r.id || ""), r))
    .filter((item) => !item.isDeleted)
    .sort((a, b) => {
      const aa = `${a.reservationDate} ${a.reservationTime} ${a.name}`;
      const bb = `${b.reservationDate} ${b.reservationTime} ${b.name}`;
      return aa.localeCompare(bb);
    });

  const doctors: DoctorOption[] = rawDoctors
    .map((d) => ({
      uid: String(d.id || ""),
      displayName: cleanText(d.displayName || d["display_name"] || d.name),
      email: cleanText(d.email),
      orderNo: cleanNumber(d.orderNo ?? d["order_no"]),
    }))
    .filter((d) => d.displayName)
    .sort((a, b) => a.orderNo - b.orderNo || a.displayName.localeCompare(b.displayName));

  return {
    reservations,
    doctors: doctors.length ? doctors : makeDoctorOptionsFromReservations(reservations),
  };
}

// 클라이언트 SDK로 의사 목록 조회 (세션 내 캐싱)
let _clientDoctorsCache: DoctorOption[] | null = null;
let _clientDoctorsCacheAt = 0;
const CLIENT_DOCTORS_TTL = 10 * 60 * 1000;

async function getClientDoctors(): Promise<DoctorOption[]> {
  if (_clientDoctorsCache && Date.now() - _clientDoctorsCacheAt < CLIENT_DOCTORS_TTL) {
    return _clientDoctorsCache;
  }
  const snap = await getDocs(
    query(collection(db, "staff"), where("role", "==", "doctor"), where("active", "==", true))
  );
  const doctors: DoctorOption[] = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        uid: d.id,
        displayName: cleanText(data.displayName || data.display_name || data.name),
        email: cleanText(data.email),
        orderNo: cleanNumber(data.orderNo ?? data.order_no),
      };
    })
    .filter((d) => d.displayName)
    .sort((a, b) => a.orderNo - b.orderNo || a.displayName.localeCompare(b.displayName));
  _clientDoctorsCache = doctors;
  _clientDoctorsCacheAt = Date.now();
  return doctors;
}

export async function fetchAllReservationsOnce(): Promise<{
  reservations: ReservationRecord[];
  doctors: DoctorOption[];
}> {
  const fromDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 45);
    return d.toISOString().slice(0, 10);
  })();

  const result = await callReservationsApi("read_all", { from: fromDate });
  const rawReservations = (result.reservations as Record<string, unknown>[] | undefined) || [];
  const rawDoctors = (result.doctors as Record<string, unknown>[] | undefined) || [];

  const reservations = rawReservations
    .map((r) => mapReservationDoc(String(r.id || ""), r))
    .filter((item) => !item.isDeleted)
    .sort((a, b) => {
      const aa = `${a.reservationDate} ${a.reservationTime} ${a.name}`;
      const bb = `${b.reservationDate} ${b.reservationTime} ${b.name}`;
      return aa.localeCompare(bb);
    });

  const doctors: DoctorOption[] = rawDoctors
    .map((d) => ({
      uid: String(d.id || ""),
      displayName: cleanText(d.displayName || d["display_name"] || d.name),
      email: cleanText(d.email),
      orderNo: cleanNumber(d.orderNo ?? d["order_no"]),
    }))
    .filter((d) => d.displayName)
    .sort((a, b) => a.orderNo - b.orderNo || a.displayName.localeCompare(b.displayName));

  return {
    reservations,
    doctors: doctors.length ? doctors : makeDoctorOptionsFromReservations(reservations),
  };
}

export function subscribeAllReservations(
  callback: (data: {
    reservations: ReservationRecord[];
    doctors: DoctorOption[];
  }) => void,
  onError?: (error: Error) => void
) {
  let unsubscribeSnapshot: (() => void) | null = null;
  let latestDoctors: DoctorOption[] = [];
  let seedDelivered = false;

  const unsubscribeAuth = auth.onAuthStateChanged((user) => {
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    if (!user) return;

    const fromDate = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 45);
      return d.toISOString().slice(0, 10);
    })();

    const hasLoadedBefore = (() => {
      try { return localStorage.getItem("crm_loaded_once_v1") === "true"; } catch { return false; }
    })();

    // Seed with API data only on first visit (no IndexedDB cache yet)
    if (!hasLoadedBefore) {
      callReservationsApi("read_all", { from: fromDate })
        .then((result) => {
          if (!seedDelivered && result.success) {
            const rawReservations = (result.reservations as Record<string, unknown>[] | undefined) || [];
            const rawDoctors = (result.doctors as Record<string, unknown>[] | undefined) || [];
            const reservations = rawReservations
              .map((r) => mapReservationDoc(String(r.id || ""), r))
              .filter((item) => !item.isDeleted)
              .sort((a, b) => {
                const aa = `${a.reservationDate} ${a.reservationTime} ${a.name}`;
                const bb = `${b.reservationDate} ${b.reservationTime} ${b.name}`;
                return aa.localeCompare(bb);
              });
            const doctors: DoctorOption[] = rawDoctors
              .map((d) => ({
                uid: String(d.id || ""),
                displayName: cleanText(d.displayName || d["display_name"] || d.name),
                email: cleanText(d.email),
                orderNo: cleanNumber(d.orderNo ?? d["order_no"]),
              }))
              .filter((d) => d.displayName)
              .sort((a, b) => a.orderNo - b.orderNo || a.displayName.localeCompare(b.displayName));
            if (doctors.length) latestDoctors = doctors;
            callback({ reservations, doctors: doctors.length ? doctors : makeDoctorOptionsFromReservations(reservations) });
          }
        })
        .catch((e) => console.warn("[subscribeAllReservations] seed failed:", e));
    }

    getClientDoctors().then((d) => { latestDoctors = d; }).catch((e) => console.warn("[subscribeAllReservations] doctors failed:", e));

    unsubscribeSnapshot = onSnapshot(
      query(collection(db, "reservations"), where("reservationDate", ">=", fromDate), limit(500)),
      (snap) => {
        // skip empty cache snapshots — they would wipe the API seed data
        if (snap.metadata.fromCache && snap.empty) return;
        try { localStorage.setItem("crm_loaded_once_v1", "true"); } catch {}
        seedDelivered = true;
        const reservations = snap.docs
          .map((d) => mapReservationDoc(d.id, d.data() as Record<string, unknown>))
          .filter((item) => !item.isDeleted)
          .sort((a, b) => {
            const aa = `${a.reservationDate} ${a.reservationTime} ${a.name}`;
            const bb = `${b.reservationDate} ${b.reservationTime} ${b.name}`;
            return aa.localeCompare(bb);
          });
        const fallback = makeDoctorOptionsFromReservations(reservations);
        callback({ reservations, doctors: latestDoctors.length ? latestDoctors : fallback });
      },
      (error) => {
        console.error("[subscribeAllReservations error]", error);
        onError?.(error);
      }
    );
  });

  return () => {
    seedDelivered = true;
    unsubscribeAuth();
    unsubscribeSnapshot?.();
  };
}

export function subscribeTimelineReservations(
  date: string,
  callback: (data: {
    reservations: ReservationRecord[];
    doctors: DoctorOption[];
  }) => void,
  onError?: (error: Error) => void
) {
  let unsubscribeSnapshot: (() => void) | null = null;
  let latestDoctors: DoctorOption[] = [];
  let seedDelivered = false;

  const unsubscribeAuth = auth.onAuthStateChanged((user) => {
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    if (!user) return;

    const hasLoadedBefore = (() => {
      try { return localStorage.getItem("crm_loaded_once_v1") === "true"; } catch { return false; }
    })();

    // Seed with API data only on first visit (no IndexedDB cache yet)
    if (!hasLoadedBefore) {
      callReservationsApi("read_by_date", { date })
        .then((result) => {
          if (!seedDelivered && result.success) {
            const rawReservations = (result.reservations as Record<string, unknown>[] | undefined) || [];
            const rawDoctors = (result.doctors as Record<string, unknown>[] | undefined) || [];
            const reservations = rawReservations
              .map((r) => mapReservationDoc(String(r.id || ""), r))
              .filter((item) => !item.isDeleted)
              .sort((a, b) => {
                const aa = `${a.reservationTime} ${a.name}`;
                const bb = `${b.reservationTime} ${b.name}`;
                return aa.localeCompare(bb);
              });
            const doctors: DoctorOption[] = rawDoctors
              .map((d) => ({
                uid: String(d.id || ""),
                displayName: cleanText(d.displayName || d["display_name"] || d.name),
                email: cleanText(d.email),
                orderNo: cleanNumber(d.orderNo ?? d["order_no"]),
              }))
              .filter((d) => d.displayName)
              .sort((a, b) => a.orderNo - b.orderNo || a.displayName.localeCompare(b.displayName));
            if (doctors.length) latestDoctors = doctors;
            callback({ reservations, doctors: doctors.length ? doctors : makeDoctorOptionsFromReservations(reservations) });
          }
        })
        .catch((e) => console.warn("[subscribeTimelineReservations] seed failed:", e));
    }

    getClientDoctors().then((d) => { latestDoctors = d; }).catch((e) => console.warn("[subscribeTimelineReservations] doctors failed:", e));

    unsubscribeSnapshot = onSnapshot(
      query(collection(db, "reservations"), where("reservationDate", "==", date)),
      (snap) => {
        // skip empty cache snapshots — they would wipe the API seed data
        if (snap.metadata.fromCache && snap.empty) return;
        try { localStorage.setItem("crm_loaded_once_v1", "true"); } catch {}
        seedDelivered = true;
        const reservations = snap.docs
          .map((d) => mapReservationDoc(d.id, d.data() as Record<string, unknown>))
          .filter((item) => !item.isDeleted)
          .sort((a, b) => {
            const aa = `${a.reservationTime} ${a.name}`;
            const bb = `${b.reservationTime} ${b.name}`;
            return aa.localeCompare(bb);
          });
        const fallback = makeDoctorOptionsFromReservations(reservations);
        callback({ reservations, doctors: latestDoctors.length ? latestDoctors : fallback });
      },
      (error) => {
        console.error("[subscribeTimelineReservations error]", error);
        onError?.(error);
      }
    );
  });

  return () => {
    seedDelivered = true;
    unsubscribeAuth();
    unsubscribeSnapshot?.();
  };
}

export async function getTimelineReservations(date: string): Promise<{
  reservations: ReservationRecord[];
  doctors: DoctorOption[];
}> {
  const result = await callReservationsApi("read_by_date", { date });
  const rawReservations = (result.reservations as Record<string, unknown>[] | undefined) || [];
  const rawDoctors = (result.doctors as Record<string, unknown>[] | undefined) || [];

  const reservations = rawReservations
    .map((r) => mapReservationDoc(String(r.id || ""), r))
    .filter((item) => !item.isDeleted)
    .sort((a, b) => {
      const aa = `${a.reservationTime} ${a.name}`;
      const bb = `${b.reservationTime} ${b.name}`;
      return aa.localeCompare(bb);
    });

  const doctors: DoctorOption[] = rawDoctors
    .map((d) => ({
      uid: String(d.id || ""),
      displayName: cleanText(d.displayName || d["display_name"] || d.name),
      email: cleanText(d.email),
      orderNo: cleanNumber(d.orderNo ?? d["order_no"]),
    }))
    .filter((d) => d.displayName)
    .sort((a, b) => a.orderNo - b.orderNo || a.displayName.localeCompare(b.displayName));

  return {
    reservations,
    doctors: doctors.length ? doctors : makeDoctorOptionsFromReservations(reservations),
  };
}

export async function createReservation(
  params: CreateReservationParams,
  staff: StaffUser
) {
  const name = cleanText(params.name);
  const reservationDate = cleanText(params.reservationDate);
  const hospital = cleanText(params.hospital);
  const doctors = Array.isArray(params.doctors)
    ? params.doctors.map(cleanText).filter(Boolean)
    : [];

  if (!name) {
    return { success: false, message: "이름을 입력하세요." };
  }

  if (!reservationDate) {
    return { success: false, message: "예약날짜를 선택하세요." };
  }

  const patientId = cleanText(params.patientId) || makeDateBasedId("P");
  const reservationId = cleanText(params.reservationId) || makeDateBasedId("R");

  const parsedBirth = parseBirthInfo(
    params.birthInput || params.birth || "",
    params.gender || ""
  );

  const patientData = {
    patientId,
    name,
    birth: parsedBirth.birth,
    birthInput: parsedBirth.birthInput,
    gender: parsedBirth.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),
  };

  const doctorStatusMap: Record<string, ReservationStatus> = {};
  const doctorStatusMetaMap: ReservationRecord["doctorStatusMetaMap"] = {};

  doctors.forEach((doctor) => {
    doctorStatusMap[doctor] = "내원전";
    doctorStatusMetaMap[doctor] = {
      status: "내원전",
      updatedAt: "",
      updatedBy: "",
      updatedRole: "",
    };
  });

  const reservationData = {
    reservationId,
    patientId,

    name,
    patientName: name,
    birth: parsedBirth.birth,
    birthInput: parsedBirth.birthInput,
    gender: parsedBirth.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),

    reservationDate,
    reservationTime: cleanText(params.reservationTime),

    hospital,
    appointmentType: (params.appointmentType || "상담") as AppointmentType,
    completed: params.completed === true,

    operationStatus: "내원전" as ReservationStatus,
    surgeryReserved: false,
    surgeryReservedAt: "",

    depositAmount: cleanText(params.depositAmount),
    surgeryCost: cleanText(params.surgeryCost),
    consultArea: cleanText(params.consultArea),

    doctors,
    coordinators: Array.isArray(params.coordinators)
      ? params.coordinators.map(cleanText).filter(Boolean)
      : [],

    doctorStatusMap,
    doctorStatusMetaMap,

    invoiceUrl: "",
    invoiceId: "",
    invoiceSheetName: "",

    createdBy: staff.displayName,
    createdByUid: staff.uid,
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,

    isDeleted: false,
  };

  const apiResult = await callReservationsApi("create", { patient: patientData, reservation: reservationData });
  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "예약 등록에 실패했습니다." };
  }

  const savedReservationId = String(apiResult.reservationDocId || "");

  createLog({
    action: "reservation_create",
    targetType: "reservation",
    targetId: reservationId,
    patientId,
    reservationId,
    staff,
    message: `${staff.displayName}님이 신규 예약을 등록했습니다.`,
    before: null,
    after: {
      name,
      reservationDate,
      reservationTime: cleanText(params.reservationTime),
      hospital,
      appointmentType: params.appointmentType || "상담",
    },
  }).catch((e) => console.warn("[createReservation] log write failed:", e));

  return {
    success: true,
    reservation: mapReservationDoc(savedReservationId, { ...reservationData, createdAt: null, updatedAt: null }),
  };
}

export async function createReservationsBatch(
  payloads: CreateReservationParams[],
  staff: StaffUser
) {
  let successCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];

    try {
      const result = await createReservation(payload, staff);

      if (result.success) {
        successCount += 1;
      } else {
        errors.push(`${i + 2}행: ${result.message || "저장 실패"}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "저장 중 오류 발생";
      errors.push(`${i + 2}행: ${message}`);
    }
  }

  return {
    success: successCount > 0,
    count: successCount,
    errors,
  };
}

export async function updateDoctorStatus(
  reservationDocId: string,
  reservationId: string,
  doctorName: string,
  newStatus: ReservationStatus,
  staff: StaffUser,
  options?: { previousOperationStatus?: string }
) {
  const reservationPatch: Record<string, unknown> = {
    [`doctorStatusMap.${doctorName}`]: newStatus,
    [`doctorStatusMetaMap.${doctorName}.status`]: newStatus,
    [`doctorStatusMetaMap.${doctorName}.updatedAt`]: new Date().toISOString(),
    [`doctorStatusMetaMap.${doctorName}.updatedBy`]: staff.displayName,
    [`doctorStatusMetaMap.${doctorName}.updatedRole`]: staff.role,
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  };

  if (newStatus === "원상중") {
    reservationPatch.operationStatus = "원상중";
    if (options?.previousOperationStatus !== undefined) {
      reservationPatch.preConsStatus = options.previousOperationStatus;
    }
  } else {
    reservationPatch.preConsStatus = "";
  }

  const apiResult = await callReservationsApi("update", {
    reservationDocId,
    reservationPatch,
  });

  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "상태 변경에 실패했습니다." };
  }

  createLog({
    action: "reservation_update",
    targetType: "reservation",
    targetId: reservationId,
    reservationId,
    staff,
    message: `${staff.displayName}님이 ${doctorName} 원상중 상태를 변경했습니다.`,
    before: null,
    after: { doctorStatusMap: { [doctorName]: newStatus } },
  }).catch((e) => console.warn("[updateDoctorStatus] log write failed:", e));

  return { success: true };
}

export async function updateReservationStatus(
  reservationDocId: string,
  reservationId: string,
  newStatus: ReservationStatus,
  staff: StaffUser
) {
  const reservationPatch = {
    operationStatus: newStatus,
    preConsStatus: "",
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  };

  const apiResult = await callReservationsApi("update", {
    reservationDocId,
    reservationPatch,
  });

  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "상태 변경에 실패했습니다." };
  }

  createLog({
    action: "reservation_update",
    targetType: "reservation",
    targetId: reservationId,
    reservationId,
    staff,
    message: `${staff.displayName}님이 예약 상태를 ${newStatus}(으)로 변경했습니다.`,
    before: null,
    after: {
      operationStatus: newStatus,
    },
  }).catch((e) => console.warn("[updateReservationStatus] log write failed:", e));

  return { success: true };
}

export async function toggleSurgeryReserved(
  reservationDocId: string,
  reservationId: string,
  nextValue: boolean,
  staff: StaffUser
) {
  const apiResult = await callReservationsApi("toggleSurgery", {
    reservationDocId,
    surgeryReserved: nextValue,
    staffDisplay: staff.displayName,
    staffUid: staff.uid,
  });

  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "수술예약 상태 변경에 실패했습니다." };
  }

  createLog({
    action: "reservation_update",
    targetType: "reservation",
    targetId: reservationId,
    reservationId,
    staff,
    message: `${staff.displayName}님이 수술예약 상태를 ${
      nextValue ? "예약" : "미예약"
    }으로 변경했습니다.`,
    before: null,
    after: {
      surgeryReserved: nextValue,
    },
  }).catch((e) => console.warn("[toggleSurgeryReserved] log write failed:", e));

  return { success: true };
}

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
  depositAmount?: string;
  surgeryCost?: string;
  currentDoctorStatusMap?: Record<string, string>;
  currentDoctorStatusMetaMap?: ReservationRecord["doctorStatusMetaMap"];
  clientUpdatedAt?: number;
};

export async function updateReservationFull(
  reservationDocId: string,
  reservationId: string,
  patientId: string,
  params: UpdateReservationParams,
  staff: StaffUser
) {
  const name = cleanText(params.name);
  const reservationDate = cleanText(params.reservationDate);
  const doctorsProvided = params.doctors !== undefined;
  const doctors = doctorsProvided
    ? (params.doctors as string[]).map(cleanText).filter(Boolean)
    : null;

  if (!name) {
    return { success: false, message: "이름을 입력하세요." };
  }

  if (!reservationDate) {
    return { success: false, message: "예약날짜를 선택하세요." };
  }

  const parsedBirth = parseBirthInfo(
    params.birthInput || params.birth || "",
    params.gender || ""
  );

  const previousDoctorStatusMap = params.currentDoctorStatusMap || {};
  const previousDoctorStatusMetaMap = params.currentDoctorStatusMetaMap || {};

  const doctorStatusMap: Record<string, ReservationStatus | string> = {};
  const doctorStatusMetaMap: ReservationRecord["doctorStatusMetaMap"] = {};

  if (doctors !== null) {
    doctors.forEach((doctor) => {
      doctorStatusMap[doctor] = previousDoctorStatusMap[doctor] || "내원전";
      doctorStatusMetaMap[doctor] = previousDoctorStatusMetaMap[doctor] || {
        status: String(doctorStatusMap[doctor] || "내원전"),
        updatedAt: "",
        updatedBy: "",
        updatedRole: "",
      };
    });
  }

  const reservationPatch: Record<string, unknown> = {
    name,
    patientName: name,

    birth: parsedBirth.birth,
    birthInput: parsedBirth.birthInput,
    gender: parsedBirth.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),

    reservationDate,
    reservationTime: cleanText(params.reservationTime),

    hospital: cleanText(params.hospital),
    appointmentType: params.appointmentType || "상담",
    completed: params.completed === true,
    cancelled: params.cancelled === true,

    consultArea: cleanText(params.consultArea),
    depositAmount: cleanText(params.depositAmount),
    surgeryCost: cleanText(params.surgeryCost),

    coordinators: Array.isArray(params.coordinators)
      ? params.coordinators.map(cleanText).filter(Boolean)
      : [],

    ...(doctors !== null && { doctors, doctorStatusMap, doctorStatusMetaMap }),

    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  };

  const patientPatch = {
    name,
    birth: parsedBirth.birth,
    birthInput: parsedBirth.birthInput,
    gender: parsedBirth.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),
  };

  // Pass patientId so server can find the patientDocId
  const apiResult = await callReservationsApi("update", {
    reservationDocId,
    patientId,
    reservationPatch,
    patientPatch,
    clientUpdatedAt: params.clientUpdatedAt,
  });

  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "예약 수정에 실패했습니다." };
  }

  createLog({
    action: "reservation_update",
    targetType: "reservation",
    targetId: reservationId,
    patientId,
    reservationId,
    staff,
    message: `${staff.displayName}님이 예약 정보를 수정했습니다.`,
    before: null,
    after: {
      name,
      birth: parsedBirth.birth,
      hospital: cleanText(params.hospital),
      appointmentType: params.appointmentType,
      completed: params.completed,
      consultArea: cleanText(params.consultArea),
      reservationDate,
      reservationTime: cleanText(params.reservationTime),
      doctors,
      coordinators: params.coordinators || [],
      depositAmount: cleanText(params.depositAmount),
      surgeryCost: cleanText(params.surgeryCost),
    },
  }).catch((e) => console.warn("[updateReservationFull] log write failed:", e));

  return { success: true };
}

export async function deleteReservation(
  reservationDocId: string,
  reservationId: string,
  staff: StaffUser
) {
  if (staff.role !== "admin") {
    return { success: false, message: "예약 삭제 권한이 없습니다." };
  }

  const apiResult = await callReservationsApi("delete", {
    reservationDocId,
    staffDisplay: staff.displayName,
    staffUid: staff.uid,
  });

  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "예약 삭제에 실패했습니다." };
  }

  createLog({
    action: "reservation_delete",
    targetType: "reservation",
    targetId: reservationId,
    reservationId,
    staff,
    message: `${staff.displayName}님이 예약을 삭제 처리했습니다.`,
    before: null,
    after: {
      isDeleted: true,
    },
  }).catch((e) => console.warn("[deleteReservation] log write failed:", e));

  return { success: true };
}
