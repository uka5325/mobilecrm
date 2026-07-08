import { auth } from "./firebase";
import { cleanText } from "./stringUtils";
import { parseBirthInfo } from "./reservationUtils";
import type { StaffUser } from "./auth";
import * as base from "./reservations";
import type {
  AppointmentType,
  CreateReservationParams,
  PatientRecord,
  UpdateReservationParams,
} from "./reservations";

export * from "./reservations";

export type PatientCandidate = {
  patientDocId: string;
  patientId: string;
  name: string;
  birth: string;
  phone: string;
  nationality: string;
};

type PatientDecision = {
  confirmNewPatient?: boolean;
  linkToPatientId?: string;
};

type ApiResult = Record<string, unknown> & {
  success: boolean;
  message?: string;
  code?: string;
};

type CallApiOptions = {
  signal?: AbortSignal;
};

let activePatientSearchController: AbortController | null = null;
let latestPatientListPromise: Promise<PatientRecord[]> | null = null;
let patientRequestGeneration = 0;

function makeDateBasedId(prefix: "P" | "R") {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  return `${prefix}-${date}-${Math.floor(100000 + Math.random() * 900000)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : (error as { name?: string })?.name === "AbortError";
}

async function callApi(
  action: string,
  payload: Record<string, unknown>,
  options: CallApiOptions = {}
): Promise<ApiResult> {
  const user = auth.currentUser;
  if (!user) return { success: false, message: "로그인이 필요합니다." };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { success: false, message: "인터넷 연결을 확인해주세요." };
  }

  try {
    const idToken = await user.getIdToken();
    const response = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, action, payload }),
      signal: options.signal,
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ...body,
        success: false,
        message: typeof body.message === "string"
          ? body.message
          : `서버 오류가 발생했습니다. (${response.status})`,
      };
    }
    return body as ApiResult;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { success: false, message: "네트워크 오류가 발생했습니다." };
  }
}

function parseCandidates(value: unknown): PatientCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const patientId = cleanText(item.patientId);
    if (!patientId) return [];
    return [{
      patientDocId: cleanText(item.patientDocId),
      patientId,
      name: cleanText(item.name),
      birth: cleanText(item.birth),
      phone: cleanText(item.phone),
      nationality: cleanText(item.nationality),
    }];
  });
}

function chooseCandidate(candidates: PatientCandidate[]): PatientDecision | null {
  if (typeof window === "undefined" || candidates.length === 0) return null;
  const choices = candidates.map((candidate, index) =>
    `${index + 1}. ${candidate.name || "이름 없음"} / ${candidate.birth || "생년월일 없음"} / ${candidate.phone || "연락처 없음"} / ${candidate.nationality || "국적 없음"}`
  ).join("\n");
  const answer = window.prompt(
    `유사한 기존 환자가 발견되었습니다.\n\n${choices}\n\n연결할 번호를 입력하세요. 새 환자로 등록하려면 N을 입력하세요.`,
    "1"
  );
  if (answer === null || !answer.trim()) return null;
  if (answer.trim().toLowerCase() === "n") return { confirmNewPatient: true };
  const selected = candidates[Number(answer.trim()) - 1];
  return selected
    ? { confirmNewPatient: true, linkToPatientId: selected.patientId }
    : null;
}

async function resolveCandidate(
  action: "create" | "create_patient",
  basePayload: Record<string, unknown>,
  result: ApiResult,
  decision?: PatientDecision
): Promise<ApiResult> {
  if (result.code !== "PATIENT_CANDIDATES") return result;
  const candidates = parseCandidates(result.candidates);
  const selected = decision || chooseCandidate(candidates);
  if (!selected) {
    return {
      success: false,
      code: "PATIENT_CANDIDATES",
      candidates,
      message: "기존 환자 연결 또는 새 환자 등록을 선택해야 합니다.",
    };
  }

  let retryPayload: Record<string, unknown> = { ...basePayload, ...selected };
  if (action === "create" && selected.linkToPatientId) {
    const patientId = selected.linkToPatientId;
    retryPayload = {
      ...retryPayload,
      patient: {
        ...((basePayload.patient as Record<string, unknown> | undefined) || {}),
        patientId,
      },
      reservation: {
        ...((basePayload.reservation as Record<string, unknown> | undefined) || {}),
        patientId,
      },
    };
  }
  return callApi(action, retryPayload);
}

export async function searchPatients(term: string): Promise<PatientRecord[]> {
  const query = term.trim();
  if (!query) return [];

  activePatientSearchController?.abort();
  const controller = new AbortController();
  const generation = ++patientRequestGeneration;
  activePatientSearchController = controller;

  const ownPromise = (async () => {
    try {
      const result = await callApi("search_patients", { term: query }, { signal: controller.signal });
      if (!result.success || !Array.isArray(result.patients)) {
        throw new Error(result.message ? String(result.message) : "검색에 실패했습니다.");
      }
      return (result.patients as Record<string, unknown>[]).map((patient) => ({
        id: cleanText(patient.id),
        patientId: cleanText(patient.patientId),
        name: cleanText(patient.name),
        birth: cleanText(patient.birth),
        birthInput: cleanText(patient.birthInput),
        gender: cleanText(patient.gender),
        phone: cleanText(patient.phone),
        nationality: cleanText(patient.nationality),
        reservationCount: typeof patient.reservationCount === "number" ? patient.reservationCount : undefined,
        depositCount: typeof patient.depositCount === "number" ? patient.depositCount : undefined,
        surgeryCostCount: typeof patient.surgeryCostCount === "number" ? patient.surgeryCostCount : undefined,
        invoiceCount: typeof patient.invoiceCount === "number" ? patient.invoiceCount : undefined,
        memoCount: typeof patient.memoCount === "number" ? patient.memoCount : undefined,
        totalDepositAmount: typeof patient.totalDepositAmount === "number" ? patient.totalDepositAmount : undefined,
        totalSurgeryCost: typeof patient.totalSurgeryCost === "number" ? patient.totalSurgeryCost : undefined,
        lastReservationDate: cleanText(patient.lastReservationDate),
        lastReservationTime: cleanText(patient.lastReservationTime),
        hasMemo: patient.hasMemo === true,
        hasInvoice: patient.hasInvoice === true,
        reservationCountCapped: patient.reservationCountCapped === true,
      }));
    } catch (error) {
      if (!isAbortError(error)) throw error;
      await Promise.resolve();
      const replacement = latestPatientListPromise;
      if (patientRequestGeneration !== generation && replacement) return replacement;
      throw error;
    }
  })();

  latestPatientListPromise = ownPromise;
  try {
    return await ownPromise;
  } finally {
    if (activePatientSearchController === controller) activePatientSearchController = null;
    if (latestPatientListPromise === ownPromise) latestPatientListPromise = null;
  }
}

export async function listPatientsSummary(
  limit = 30,
  cursor?: string
): Promise<{ patients: PatientRecord[]; nextCursor: string | null }> {
  patientRequestGeneration += 1;
  activePatientSearchController?.abort();
  activePatientSearchController = null;

  const resultPromise = base.listPatientsSummary(limit, cursor);
  const listPromise = resultPromise.then((result) => result.patients);
  latestPatientListPromise = listPromise;
  try {
    return await resultPromise;
  } finally {
    if (latestPatientListPromise === listPromise) latestPatientListPromise = null;
  }
}

export async function createReservation(
  params: CreateReservationParams,
  staff: StaffUser,
  decision?: PatientDecision
) {
  const name = cleanText(params.name);
  const reservationDate = cleanText(params.reservationDate);
  if (!name) return { success: false, message: "이름을 입력하세요." };
  if (!reservationDate) return { success: false, message: "예약날짜를 선택하세요." };

  const patientId = cleanText(params.patientId) || makeDateBasedId("P");
  const reservationId = cleanText(params.reservationId) || makeDateBasedId("R");
  const parsed = parseBirthInfo(params.birthInput || params.birth || "", params.gender || "");
  const patient = {
    patientId,
    name,
    birth: parsed.birth,
    birthInput: parsed.birthInput,
    gender: parsed.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),
  };
  const reservation = {
    reservationId,
    patientId,
    name,
    patientName: name,
    birth: parsed.birth,
    birthInput: parsed.birthInput,
    gender: parsed.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),
    reservationDate,
    reservationTime: cleanText(params.reservationTime),
    hospital: cleanText(params.hospital),
    appointmentType: (params.appointmentType || "상담") as AppointmentType,
    depositAmount: cleanText(params.depositAmount),
    surgeryCost: cleanText(params.surgeryCost),
    consultArea: cleanText(params.consultArea),
    doctors: Array.isArray(params.doctors) ? params.doctors.map(cleanText).filter(Boolean) : [],
    coordinators: Array.isArray(params.coordinators) ? params.coordinators.map(cleanText).filter(Boolean) : [],
    createdBy: staff.displayName,
    createdByUid: staff.uid,
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
    isDeleted: false,
  };

  const basePayload = { patient, reservation };
  let result = await callApi("create", { ...basePayload, ...(decision || {}) });
  result = await resolveCandidate("create", basePayload, result, decision);
  if (!result.success) {
    return {
      success: false,
      code: cleanText(result.code),
      candidates: parseCandidates(result.candidates),
      message: result.message || "예약 등록에 실패했습니다.",
    };
  }

  base.invalidatePatientsCache();
  base.invalidatePatientsSummaryCache();
  const savedPatientId = cleanText(result.patientId || patientId);
  return {
    success: true,
    reservation: base.mapReservationDoc(String(result.reservationDocId || ""), {
      ...reservation,
      patientId: savedPatientId,
      createdAt: null,
      updatedAt: null,
    }),
  };
}

export async function createPatientOnly(
  params: { name: string; birthInput: string; phone: string; nationality: string; patientId?: string },
  currentUser: StaffUser,
  decision?: PatientDecision
) {
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

  const basePayload = { patient };
  let result = await callApi("create_patient", { ...basePayload, ...(decision || {}) });
  result = await resolveCandidate("create_patient", basePayload, result, decision);
  if (!result.success) {
    return {
      success: false,
      code: cleanText(result.code),
      candidates: parseCandidates(result.candidates),
      message: result.message || "등록에 실패했습니다.",
    };
  }

  base.invalidatePatientsCache();
  base.invalidatePatientsSummaryCache();
  return {
    success: true,
    patientDocId: String(result.patientDocId || ""),
    patientId: cleanText(result.patientId || patientId),
  };
}

export async function updateReservationFull(
  reservationDocId: string,
  reservationId: string,
  patientId: string,
  params: UpdateReservationParams,
  staff: StaffUser
) {
  const result = await base.updateReservationFull(
    reservationDocId,
    reservationId,
    patientId,
    params,
    staff
  );
  if (!result.success) {
    throw new Error(result.message || "예약 수정에 실패했습니다.");
  }
  return result;
}
