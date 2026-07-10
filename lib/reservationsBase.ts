import { auth, db } from "./firebase";
import { collection, onSnapshot, query, where, getDocs } from "firebase/firestore";
import type { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";
import { parseBirthInfo } from "./reservationUtils";
import type { AmountRow, AmountRowType } from "./reservationAmountRows";
import type {
  ReservationApiAction,
  ReservationApiPayload,
  ReservationApiRequest,
  ReservationApiResult,
} from "./reservationApiContracts";

async function callReservationsApi<A extends ReservationApiAction>(
  action: A,
  payload: ReservationApiPayload<A>
): Promise<ReservationApiResult<A>> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    return { success: false, message: "로그인 상태를 확인할 수 없습니다. 페이지를 새로고침 후 다시 시도해주세요." };
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { success: false, message: "인터넷 연결을 확인해주세요." };
  }
  try {
    const idToken = await firebaseUser.getIdToken();
    const request: ReservationApiRequest<A> = { idToken, action, payload };
    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = await res.json().catch(() => ({})) as ReservationApiResult<A>;
    if (!res.ok) {
      return {
        ...body,
        success: false,
        message: typeof body.message === "string"
          ? body.message
          : `서버 오류가 발생했습니다. (${res.status})`,
      };
    }
    return body;
  } catch {
    return { success: false, message: "네트워크 오류가 발생했습니다. 연결 상태를 확인해주세요." };
  }
}

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

  depositAmount: string;
  surgeryCost: string;
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
  })();

  return _doctorsPromise;
}

export function invalidateDoctorsCache() {
  _doctorsPromise = null;
  _doctorsCachedAt = 0;
}

// ── 공용 read 헬퍼 (목록/타임라인/구독에서 매핑·정렬·45일 계산을 단일화) ──────────
// 기본 조회 범위: 45일 전(약 1.5개월) — 6개월 전체 스캔 방지.
export function get45DaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 45);
  return d.toISOString().slice(0, 10);
}

// 예약 정렬: 목록(date)=날짜+시간+이름, 타임라인(time)=시간+이름. 정렬 키 차이를 보존.
function sortReservations(
  list: ReservationRecord[],
  sortKey: "date" | "time"
): ReservationRecord[] {
  return [...list].sort((a, b) => {
    const aa = sortKey === "date"
      ? `${a.reservationDate} ${a.reservationTime} ${a.name}`
      : `${a.reservationTime} ${a.name}`;
    const bb = sortKey === "date"
      ? `${b.reservationDate} ${b.reservationTime} ${b.name}`
      : `${b.reservationTime} ${b.name}`;
    return aa.localeCompare(bb);
  });
}

function mapReservationsFromApi(
  raw: Record<string, unknown>[] | undefined,
  sortKey: "date" | "time"
): ReservationRecord[] {
  const mapped = (raw || [])
    .map((r) => mapReservationDoc(String(r.id || ""), r))
    .filter((item) => !item.isDeleted);
  return sortReservations(mapped, sortKey);
}

function mapDoctorsFromApi(raw: Record<string, unknown>[] | undefined): DoctorOption[] {
  return (raw || [])
    .map((d) => ({
      uid: String(d.id || ""),
      displayName: cleanText(d.displayName || d["display_name"] || d.name),
      email: cleanText(d.email),
      orderNo: cleanNumber(d.orderNo ?? d["order_no"]),
    }))
    .filter((d) => d.displayName)
    .sort((a, b) => a.orderNo - b.orderNo || a.displayName.localeCompare(b.displayName));
}

function withDoctorFallback(
  doctors: DoctorOption[],
  reservations: ReservationRecord[]
): DoctorOption[] {
  return doctors.length ? doctors : makeDoctorOptionsFromReservations(reservations);
}

export async function getAllReservations(): Promise<{
  reservations: ReservationRecord[];
  doctors: DoctorOption[];
}> {
  const result = await callReservationsApi("read_all", { from: get45DaysAgo() });
  const reservations = mapReservationsFromApi(
    result.reservations as Record<string, unknown>[] | undefined,
    "date"
  );
  const doctors = withDoctorFallback(
    mapDoctorsFromApi(result.doctors as Record<string, unknown>[] | undefined),
    reservations
  );
  return { reservations, doctors };
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

// getAllReservations와 동일 동작(45일 1회 조회). 호출부 호환을 위해 별칭 유지.
export const fetchAllReservationsOnce = getAllReservations;

// 예약을 [from, to] 날짜 범위로 실시간 구독한다. to가 null이면 from 이후 전체.
// 화면별 필요한 범위만 구독하는 구조의 기반(홈=오늘, 스케줄=선택 범위).
// 인덱스: reservations (isDeleted ASC, reservationDate) — firestore.indexes.json.
export function subscribeReservationsByRange(
  from: string,
  to: string | null,
  callback: (data: {
    reservations: ReservationRecord[];
    doctors: DoctorOption[];
  }) => void,
  onError?: (error: Error) => void
) {
  let unsubscribeSnapshot: (() => void) | null = null;
  let latestDoctors: DoctorOption[] = [];

  const unsubscribeAuth = auth.onAuthStateChanged((user) => {
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    if (!user) return;

    // 실시간 단일 경로: onSnapshot이 데이터를 공급. 의사 목록만 별도 조회.
    getClientDoctors().then((d) => { latestDoctors = d; }).catch(() => {});

    const constraints = [
      where("isDeleted", "==", false),
      where("reservationDate", ">=", from),
    ];
    if (to) constraints.push(where("reservationDate", "<=", to));

    unsubscribeSnapshot = onSnapshot(
      query(collection(db, "reservations"), ...constraints),
      (snap) => {
        if (snap.metadata.fromCache && snap.empty) {
          callback({ reservations: [], doctors: latestDoctors });
          return;
        }
        const reservations = sortReservations(
          snap.docs
            .map((d) => mapReservationDoc(d.id, d.data() as Record<string, unknown>))
            .filter((item) => !item.isDeleted),
          "date"
        );
        const fallback = makeDoctorOptionsFromReservations(reservations);
        callback({ reservations, doctors: latestDoctors.length ? latestDoctors : fallback });
      },
      (error) => {
        console.error("[subscribeReservationsByRange error]", (error as Error)?.message ?? "");
        onError?.(error);
      }
    );
  });

  return () => {
    unsubscribeAuth();
    unsubscribeSnapshot?.();
  };
}

// 최근 45일 전체 구독(하위호환) — 범위 구독의 특수 케이스.
export function subscribeAllReservations(
  callback: (data: {
    reservations: ReservationRecord[];
    doctors: DoctorOption[];
  }) => void,
  onError?: (error: Error) => void
) {
  return subscribeReservationsByRange(get45DaysAgo(), null, callback, onError);
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

    // 상태 필드(completed/cancelled/surgeryReserved/surgeryReservedAt)와 invoice 필드는
    // 서버가 기본값을 기록한다(create 화이트리스트에서 제외 → 주입 시 400). 여기서 보내지 않는다.

    depositAmount: cleanText(params.depositAmount),
    surgeryCost: cleanText(params.surgeryCost),
    consultArea: cleanText(params.consultArea),

    doctors,
    coordinators: Array.isArray(params.coordinators)
      ? params.coordinators.map(cleanText).filter(Boolean)
      : [],

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

  invalidateReservationDerivedCaches(patientId);
  const savedReservationId = String(apiResult.reservationDocId || "");

  // 감사로그는 서버(/api/reservations create)에서 권위 있게 기록됨 → 클라 createLog 제거(중복 방지).

  return {
    success: true,
    reservation: mapReservationDoc(savedReservationId, { ...reservationData, createdAt: null, updatedAt: null }),
  };
}

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
  depositCount?: number;      // 묶음 그룹 수
  surgeryCostCount?: number;  // 묶음 그룹 수
  invoiceCount?: number;
  memoCount?: number;
  totalDepositAmount?: number;
  totalSurgeryCost?: number;
  lastReservationDate?: string;
  lastReservationTime?: string;
  hasMemo?: boolean;
  hasInvoice?: boolean;
  reservationCountCapped?: boolean;
};

// patients 문서(요약 포함) → PatientRecord. 숫자 필드는 숫자만 통과(백필 전엔 undefined).
function mapPatientRecord(p: Record<string, unknown>): PatientRecord {
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
    depositCount: num(p.depositCount),
    surgeryCostCount: num(p.surgeryCostCount),
    invoiceCount: num(p.invoiceCount),
    memoCount: num(p.memoCount),
    totalDepositAmount: num(p.totalDepositAmount),
    totalSurgeryCost: num(p.totalSurgeryCost),
    lastReservationDate: cleanText(p.lastReservationDate),
    lastReservationTime: cleanText(p.lastReservationTime),
    hasMemo: p.hasMemo === true,
    hasInvoice: p.hasInvoice === true,
    reservationCountCapped: p.reservationCountCapped === true,
  };
}

export {
  getPatientSummaryCache,
  setPatientSummaryCache,
  invalidatePatientSummaryCache,
  isPatientSummaryCacheFresh,
} from "./patientSummaryClientCache";

import { invalidatePatientSummaryCache as _invalidatePatientSummaryCache } from "./patientSummaryClientCache";
// Alias kept for existing callsites in this file and reservationsSafe.ts
export const invalidatePatientsSummaryCache = _invalidatePatientSummaryCache;
// Legacy compat — old callers used getCachedPatientsSummary()
export function getCachedPatientsSummary(): { patients: PatientRecord[]; nextCursor: string | null } | undefined {
  // No UID available here — return undefined so page uses the new UID-aware API
  return undefined;
}

export async function listPatientsSummary(
  limit = 30,
  cursor?: string
): Promise<{ patients: PatientRecord[]; nextCursor: string | null }> {
  const result = await callReservationsApi("list_patients_summary", { limit, cursor });
  if (!result.success || !Array.isArray(result.patients)) {
    throw new Error(result.message ? String(result.message) : "고객 목록을 불러오지 못했습니다.");
  }
  return {
    patients: (result.patients as Record<string, unknown>[]).map(mapPatientRecord),
    nextCursor: (result.nextCursor as string) ?? null,
  };
}

const _patientAmountRowsCache = new Map<string, { at: number; rows: AmountRow[] }>();
const PATIENT_AMOUNT_ROWS_TTL = 3 * 60 * 1000;

function amountRowsCacheKey(patientId: string, type: AmountRowType) {
  return `${patientId}:${type}`;
}

export function invalidatePatientAmountRowsCache(patientId: string) {
  _patientAmountRowsCache.delete(amountRowsCacheKey(patientId, "deposit"));
  _patientAmountRowsCache.delete(amountRowsCacheKey(patientId, "surgery"));
}

// 예약 mutation 뒤 두 화면이 동일한 원본을 다시 읽도록 관련 세션 캐시를 한 번에 비운다.
export function invalidateReservationDerivedCaches(patientId: string) {
  const id = cleanText(patientId);
  if (!id) return;
  invalidatePatientsCache();
  invalidatePatientsSummaryCache();
  invalidatePatientFullHistoryCache(id);
  invalidatePatientAmountRowsCache(id);
}

function mapAmountRow(raw: Record<string, unknown>): AmountRow {
  const id = cleanText(raw.id);
  return {
    id,
    reservationId: cleanText(raw.reservationId) || id,
    patientId: cleanText(raw.patientId),
    date: cleanText(raw.date),
    hospital: cleanText(raw.hospital),
    consultArea: cleanText(raw.consultArea),
    doctors: Array.isArray(raw.doctors) ? (raw.doctors as unknown[]).map((d) => cleanText(d)).filter(Boolean) : [],
    amount: cleanText(raw.amount),
  };
}

export async function getPatientAmountRowsCached(
  patientId: string,
  type: AmountRowType,
  expectedCount = 0
): Promise<{ rows: AmountRow[]; source: string }> {
  const key = amountRowsCacheKey(patientId, type);
  const cached = _patientAmountRowsCache.get(key);
  if (cached && Date.now() - cached.at < PATIENT_AMOUNT_ROWS_TTL) {
    return { rows: cached.rows, source: "cache" };
  }

  const result = await callReservationsApi("patient_amount_rows", { patientId, type, expectedCount });
  if (!result.success) throw new Error(String(result.message || "금액 내역 조회 실패"));

  const rows = ((result.rows as Record<string, unknown>[] | undefined) || []).map(mapAmountRow);
  _patientAmountRowsCache.set(key, { at: Date.now(), rows });
  return { rows, source: String(result.source || "flag") };
}

// 예약금/수술비 최소 수정 — 금액 팝오버 저장용. 화이트리스트 필드만 patch하며
// 신원/감사로그/요약 재계산은 서버가 처리한다.
export async function updateReservationAmount(
  reservationDocId: string,
  reservationId: string,
  patientId: string,
  field: "depositAmount" | "surgeryCost",
  value: string
): Promise<{ success: boolean; message?: string }> {
  const apiResult = await callReservationsApi("update", {
    reservationDocId,
    reservationId,
    patientId,
    reservationPatch: { [field]: cleanText(value) },
  });
  if (!apiResult.success) {
    return { success: false, message: cleanText(apiResult.message) || "금액 저장에 실패했습니다." };
  }
  invalidateReservationDerivedCaches(patientId);
  return { success: true };
}

export async function createPatientOnly(
  params: { name: string; birthInput: string; phone: string; nationality: string; patientId?: string },
  currentUser: StaffUser
): Promise<{ success: boolean; message?: string; patientDocId?: string }> {
  const name = cleanText(params.name);
  if (!name) return { success: false, message: "이름을 입력하세요." };

  const patientId = cleanText(params.patientId) || makeDateBasedId("P");
  const parsed = parseBirthInfo(params.birthInput || "", "");

  const patient = {
    patientId,
    name,
    birth: parsed.birth,
    birthInput: parsed.birthInput,
    gender: parsed.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),
    createdBy: currentUser.displayName,
    createdByUid: currentUser.uid,
    updatedBy: currentUser.displayName,
    updatedByUid: currentUser.uid,
  };

  const result = await callReservationsApi("create_patient", { patient });
  if (result.success) { invalidatePatientsCache(); invalidatePatientsSummaryCache(); }
  return result.success
    ? { success: true, patientDocId: String(result.patientDocId || "") }
    : { success: false, message: cleanText(result.message) || "등록 실패" };
}

// 환자 목록 인메모리 캐시 (반복 500건 스캔 억제). 생성 시 무효화.
// 누락 방지: 서버는 isDeleted!==true만 반환하므로 캐시는 그 결과를 그대로 보관.
let _patientsCache: { at: number; data: PatientRecord[] } | null = null;
const PATIENTS_CACHE_TTL = 10 * 60 * 1000;

export function invalidatePatientsCache() {
  _patientsCache = null;
}

export async function listPatients(force = false): Promise<PatientRecord[]> {
  if (!force && _patientsCache && Date.now() - _patientsCache.at < PATIENTS_CACHE_TTL) {
    return _patientsCache.data;
  }
  const result = await callReservationsApi("list_patients", {});
  if (!result.success || !Array.isArray(result.patients)) return _patientsCache?.data ?? [];
  const data = (result.patients as Record<string, unknown>[]).map(mapPatientRecord);
  _patientsCache = { at: Date.now(), data };
  return data;
}

// 검색토큰 기반 환자 검색(매칭만 읽음). 단어 단위 전체일치(한글 이름 전체/영문 단어).
// 전체 스캔(listPatients)을 대체 — 검색 시 매칭된 환자만 읽어 비용 절감.
export async function searchPatients(term: string): Promise<PatientRecord[]> {
  const t = term.trim();
  if (!t) return [];
  const result = await callReservationsApi("search_patients", { term: t });
  if (!result.success || !Array.isArray(result.patients)) {
    throw new Error(result.message ? String(result.message) : "검색에 실패했습니다.");
  }
  return (result.patients as Record<string, unknown>[]).map(mapPatientRecord);
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

  // 감사로그는 서버(/api/reservations toggleSurgery)에서 권위 있게 기록됨 → 클라 createLog 제거.

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
};

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
  if (params.depositAmount !== undefined) reservationPatch.depositAmount = cleanText(params.depositAmount);
  if (params.surgeryCost !== undefined) reservationPatch.surgeryCost = cleanText(params.surgeryCost);
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

export async function updateReservationFull(
  reservationDocId: string,
  reservationId: string,
  patientId: string,
  params: UpdateReservationParams,
  staff: StaffUser
) {
  const name = cleanText(params.name);
  const reservationDate = cleanText(params.reservationDate);

  if (!name) {
    return { success: false, message: "이름을 입력하세요." };
  }

  if (!reservationDate) {
    return { success: false, message: "예약날짜를 선택하세요." };
  }

  const { reservationPatch } = buildReservationUpdatePayload(params, staff);

  // 예약 수정은 reservations 문서만 건드린다. 환자 마스터(patients) 정정은
  // update_patient_profile 전용 경로로만 처리한다(책임 분리). patientId는 서버가
  // reservationDocId로 기존 문서를 읽어 canonical 값을 파생하므로 전송하지 않는다.
  // reservationId는 서버 감사로그(reservation_update)용 — 로그는 서버에서 기록한다.
  const apiResult = await callReservationsApi("update", {
    reservationDocId,
    reservationId,
    reservationPatch,
  });

  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "예약 수정에 실패했습니다." };
  }

  invalidateReservationDerivedCaches(patientId);
  return { success: true };
}

export async function searchReservationsByDateRange(
  from: string,
  to: string
): Promise<ReservationRecord[]> {
  // KPI/대시보드는 기간 전체를 서버 pagination으로 정확히 집계한다(500 상한 부분집계 금지).
  // 하드 상한 초과 시 서버가 KPI_QUERY_LIMIT_EXCEEDED 오류를 주고, 여기서 그대로 throw한다.
  const result = await callReservationsApi("read_range_all", { from, to });
  if (!result.success) throw new Error(String(result.message || "검색 실패"));
  const raw = (result.reservations as Record<string, unknown>[] | undefined) || [];
  return raw
    .map((r) => mapReservationDoc(String(r.id || ""), r))
    .filter((item) => !item.isDeleted)
    .sort((a, b) => `${b.reservationDate} ${b.reservationTime}`.localeCompare(`${a.reservationDate} ${a.reservationTime}`));
}

export async function getPatientReservationHistory(
  patientId: string,
  cursor?: string
): Promise<{ reservations: ReservationRecord[]; nextCursor: string | null; hasMore: boolean }> {
  const result = await callReservationsApi("patient_history", { patientId, cursor });
  if (!result.success) throw new Error(String(result.message || "이력 조회 실패"));
  const raw = (result.reservations as Record<string, unknown>[] | undefined) || [];
  return {
    reservations: raw.map((r) => mapReservationDoc(String(r.id || ""), r)),
    nextCursor: (result.nextCursor as string | null) ?? null,
    hasMore: Boolean(result.hasMore),
  };
}

// 환자별 "전체 예약 이력" 결과 캐시 — 라이브 구독 윈도우(45일)와 무관하게 정확한
// 고객관리 배지("총 건수"/예약금/수술비용/부위)와 "전체 이력" 모달이 공유한다.
// 금액 정보를 포함하므로 localStorage가 아닌 세션 메모리(Map)에만 유지(로그아웃/새로고침 시 자연 소멸).
const _patientFullHistoryCache = new Map<string, { at: number; reservations: ReservationRecord[]; capped: boolean }>();
const PATIENT_FULL_HISTORY_TTL = 3 * 60 * 1000;

export async function getPatientFullHistory(
  patientId: string
): Promise<{ reservations: ReservationRecord[]; capped: boolean }> {
  const result = await callReservationsApi("patient_full_history", { patientId });
  if (!result.success) throw new Error(String(result.message || "이력 조회 실패"));
  const raw = (result.reservations as Record<string, unknown>[] | undefined) || [];
  return {
    reservations: raw
      .map((r) => mapReservationDoc(String(r.id || ""), r))
      .sort((a, b) => `${b.reservationDate} ${b.reservationTime}`.localeCompare(`${a.reservationDate} ${a.reservationTime}`)),
    capped: Boolean(result.capped),
  };
}

export async function getPatientFullHistoryPage(
  patientId: string,
  options: { cursor?: string | null; limit?: number } = {}
): Promise<{
  reservations: ReservationRecord[];
  nextCursor: string | null;
  hasMore: boolean;
  capped: boolean;
}> {
  const result = await callReservationsApi("patient_full_history_page", {
    patientId,
    cursor: options.cursor || "",
    limit: options.limit || 10,
  });
  if (!result.success) throw new Error(String(result.message || "이력 조회 실패"));
  const raw = (result.reservations as Record<string, unknown>[] | undefined) || [];
  return {
    reservations: raw
      .map((r) => mapReservationDoc(String(r.id || ""), r))
      .sort((a, b) => `${b.reservationDate} ${b.reservationTime}`.localeCompare(`${a.reservationDate} ${a.reservationTime}`)),
    nextCursor: result.nextCursor ? String(result.nextCursor) : null,
    hasMore: result.hasMore === true,
    capped: Boolean(result.capped),
  };
}

export function getCachedPatientFullHistory(
  patientId: string
): { reservations: ReservationRecord[]; capped: boolean } | undefined {
  const e = _patientFullHistoryCache.get(patientId);
  if (!e || Date.now() - e.at >= PATIENT_FULL_HISTORY_TTL) return undefined;
  return { reservations: e.reservations, capped: e.capped };
}

export async function getPatientFullHistoryCached(
  patientId: string
): Promise<{ reservations: ReservationRecord[]; capped: boolean }> {
  const cached = getCachedPatientFullHistory(patientId);
  if (cached) return cached;
  const result = await getPatientFullHistory(patientId);
  _patientFullHistoryCache.set(patientId, { at: Date.now(), ...result });
  return result;
}

export function invalidatePatientFullHistoryCache(patientId: string) {
  _patientFullHistoryCache.delete(patientId);
}


// 여러 환자의 전체 이력 캐시를 "1번의 배치 쿼리"로 데운다. 고객관리 카드 배지가
// 환자마다 getPatientFullHistoryCached를 따로 부르면 서버 왕복이 N번 생기므로,
// 아직 캐시가 없는 환자만 모아 patient_full_history_batch(45일보다 오래된 것만)로
// 한 번에 받고, 라이브 구독이 이미 갖고 있는 45일치 데이터와 합쳐서 캐시에 채운다.
// 이후 getPatientFullHistoryCached(pid) 호출은 이 캐시를 그대로 재사용한다.
export async function warmPatientFullHistoryCache(
  patientIds: string[],
  liveWindowByPatientId: Record<string, ReservationRecord[]>
): Promise<void> {
  const stale = [...new Set(patientIds.filter(Boolean))].filter(
    (pid) => !getCachedPatientFullHistory(pid)
  );
  if (!stale.length) return;

  const CHUNK = 30; // Firestore where(...,"in",[...]) 최대 30개
  const before = get45DaysAgo();

  for (let i = 0; i < stale.length; i += CHUNK) {
    const chunk = stale.slice(i, i + CHUNK);
    const result = await callReservationsApi("patient_full_history_batch", { patientIds: chunk, before });
    if (!result.success) continue;

    const byPatient = (result.byPatient as Record<string, Record<string, unknown>[]> | undefined) || {};
    for (const pid of chunk) {
      const older = (byPatient[pid] || []).map((r) => mapReservationDoc(String(r.id || ""), r));
      const live = liveWindowByPatientId[pid] || [];
      const merged = [...live, ...older]
        .filter((r, idx, arr) => arr.findIndex((x) => x.id === r.id) === idx)
        .sort((a, b) => `${b.reservationDate} ${b.reservationTime}`.localeCompare(`${a.reservationDate} ${a.reservationTime}`))
        .slice(0, 300);
      _patientFullHistoryCache.set(pid, { at: Date.now(), reservations: merged, capped: merged.length >= 300 });
    }
  }
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

  // 감사로그는 서버(/api/reservations delete)에서 권위 있게 기록됨 → 클라 createLog 제거.
  const canonicalPatientId = cleanText(apiResult.patientId);
  if (canonicalPatientId) invalidateReservationDerivedCaches(canonicalPatientId);

  return { success: true };
}

// CSV 내보내기용 서버 조회: 지정 기간을 Firestore 쿼리로 정확히 읽고 메모를 배치로 묶는다.
// (기존 클라 CSV의 "45일 메모리 데이터만 포함 + 메모 N회 호출" 문제 해결)
export async function fetchReservationsForExport(
  startDate: string,
  endDate: string,
  includeNotes: boolean
): Promise<{
  reservations: ReservationRecord[];
  notesByDoc: Record<string, { createdBy: string; memoText: string }[]>;
  capped: boolean;
}> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error("로그인 상태를 확인할 수 없습니다.");
  const idToken = await firebaseUser.getIdToken();
  const res = await fetch("/api/reservations/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, startDate, endDate, includeNotes }),
  });
  if (!res.ok) throw new Error(`서버 오류가 발생했습니다. (${res.status})`);
  const data = (await res.json()) as Record<string, unknown> & { success: boolean; message?: string };
  if (!data.success) throw new Error(String(data.message || "내보내기에 실패했습니다."));
  const raw = (data.reservations as Record<string, unknown>[] | undefined) || [];
  return {
    reservations: raw.map((r) => mapReservationDoc(String(r.id || ""), r)),
    notesByDoc: (data.notesByDoc as Record<string, { createdBy: string; memoText: string }[]>) || {},
    capped: Boolean(data.capped),
  };
}

// 환자 정보 수정: 예약 N건마다 update를 호출하던 걸 서버 1회 배치로 대체.
// patients 마스터 1회 + 해당 환자의 예약 역정규화 필드를 서버 배치로 갱신한다.
// 감사로그는 서버(update_patient_profile)가 기록하므로 클라 로그는 남기지 않는다.
export async function updatePatientProfile(
  patientId: string,
  params: { name: string; birthInput?: string; phone?: string; nationality?: string; gender?: string }
) {
  const name = cleanText(params.name);
  if (!name) return { success: false, message: "이름을 입력하세요." };
  const parsed = parseBirthInfo(params.birthInput || "", params.gender || "");
  const patientPatch = {
    name,
    birth: parsed.birth,
    birthInput: parsed.birthInput,
    gender: parsed.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),
  };
  const apiResult = await callReservationsApi("update_patient_profile", { patientId, patientPatch });
  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "환자 정보 수정에 실패했습니다." };
  }
  invalidateReservationDerivedCaches(patientId);
  return { success: true };
}

// 환자 전체 삭제(admin 전용): patientId 기준 모든 예약 + 환자 문서 soft-delete.
// 45일 윈도우 밖 과거 예약까지 서버에서 일괄 처리하고 감사로그도 서버가 기록한다.
export async function deletePatient(patientId: string, staff: StaffUser) {
  if (staff.role !== "admin") {
    return { success: false, message: "환자 삭제 권한이 없습니다." };
  }
  const apiResult = await callReservationsApi("delete_patient", { patientId });
  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "환자 삭제에 실패했습니다." };
  }
  invalidateReservationDerivedCaches(patientId);
  return {
    success: true,
    deletedReservations: Number(apiResult.deletedReservations || 0),
  };
}
