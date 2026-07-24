import { auth } from "@/lib/firebase";
import { cleanText } from "@/lib/stringUtils";
import { parseBirthInfo } from "@/lib/reservationUtils";
import type { StaffUser } from "@/lib/auth";
import type {
  ReservationApiAction,
  ReservationApiPayload,
  ReservationApiRequest,
  ReservationApiResult,
} from "@/lib/reservationApiContracts";
import {
  buildReservationUpdatePayload,
  mapPatientRecord,
  mapReservationDoc,
  type AppointmentType,
  type CreateReservationParams,
  type PatientRecord,
  type UpdateReservationParams,
} from "@/features/reservations/domain/reservationModels";
import { invalidatePatientFullHistoryCache } from "./reservationHistory";
export {
  getPatientSummaryCache,
  setPatientSummaryCache,
  invalidatePatientSummaryCache,
  isPatientSummaryCacheFresh,
} from "@/lib/patientSummaryClientCache";
import { invalidatePatientSummaryCache as _invalidatePatientSummaryCache } from "@/lib/patientSummaryClientCache";

export const invalidatePatientsSummaryCache = _invalidatePatientSummaryCache;

export function invalidateReservationDerivedCaches(patientId: string) {
  const id = cleanText(patientId);
  if (!id) return;
  invalidatePatientsSummaryCache();
  invalidatePatientFullHistoryCache(id);
}

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

type ApiResult = ReservationApiResult;

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

async function callApi<A extends ReservationApiAction>(
  action: A,
  payload: ReservationApiPayload<A>,
  options: CallApiOptions = {}
): Promise<ReservationApiResult<A>> {
  const user = auth.currentUser;
  if (!user) return { success: false, message: "로그인이 필요합니다." };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { success: false, message: "인터넷 연결을 확인해주세요." };
  }

  try {
    const idToken = await user.getIdToken();
    const request: ReservationApiRequest<A> = { idToken, action, payload };
    const response = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options.signal,
    });
    const body = await response.json().catch(() => ({})) as ReservationApiResult<A>;
    if (!response.ok) {
      return {
        ...body,
        success: false,
        message: typeof body.message === "string"
          ? body.message
          : `서버 오류가 발생했습니다. (${response.status})`,
      };
    }
    return body;
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
  return callApi(action, retryPayload as ReservationApiPayload<typeof action>);
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
        invoiceCount: typeof patient.invoiceCount === "number" ? patient.invoiceCount : undefined,
        memoCount: typeof patient.memoCount === "number" ? patient.memoCount : undefined,
        settlementCount: typeof patient.settlementCount === "number" ? patient.settlementCount : undefined,
        totalSettlementPaid: typeof patient.totalSettlementPaid === "number" ? patient.totalSettlementPaid : undefined,
        totalSettlementRefunded: typeof patient.totalSettlementRefunded === "number" ? patient.totalSettlementRefunded : undefined,
        netSettlementAmount: typeof patient.netSettlementAmount === "number" ? patient.netSettlementAmount : undefined,
        lastSettlementAt: cleanText(patient.lastSettlementAt),
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

  const resultPromise = (async () => {
    const result = await callApi("list_patients_summary", { limit, cursor });
    if (!result.success || !Array.isArray(result.patients)) {
      throw new Error(result.message ? String(result.message) : "고객 목록을 불러오지 못했습니다.");
    }
    return {
      patients: (result.patients as Record<string, unknown>[]).map(mapPatientRecord),
      nextCursor: (result.nextCursor as string) ?? null,
    };
  })();

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

  const savedPatientId = cleanText(result.patientId || patientId);
  invalidateReservationDerivedCaches(savedPatientId);
  return {
    success: true,
    reservation: mapReservationDoc(String(result.reservationDocId || ""), {
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

  invalidatePatientsSummaryCache();
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
): Promise<{ success: boolean; message?: string }> {
  const name = cleanText(params.name);
  const reservationDate = cleanText(params.reservationDate);
  if (!name) throw new Error("이름을 입력하세요.");
  if (!reservationDate) throw new Error("예약날짜를 선택하세요.");

  const { reservationPatch } = buildReservationUpdatePayload(params, staff);
  const result = await callApi("update", {
    reservationDocId,
    reservationId,
    reservationPatch,
  });
  if (!result.success) {
    throw new Error(result.message || "예약 수정에 실패했습니다.");
  }

  const canonicalPatientId = cleanText(result.patientId) || cleanText(patientId);
  invalidateReservationDerivedCaches(canonicalPatientId);
  return { success: true };
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
  const apiResult = await callApi("toggleSurgery", {
    reservationDocId,
    surgeryReserved: nextValue,
    staffDisplay: staff.displayName,
    staffUid: staff.uid,
  });

  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "수술예약 상태 변경에 실패했습니다." };
  }

  // 감사로그는 서버(/api/reservations toggleSurgery)에서 권위 있게 기록됨 → 클라 createLog 제거.
  const canonicalPatientId = cleanText(apiResult.patientId);
  if (canonicalPatientId) invalidateReservationDerivedCaches(canonicalPatientId);

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

  const apiResult = await callApi("delete", {
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
  const apiResult = await callApi("update_patient_profile", { patientId, patientPatch });
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
  const apiResult = await callApi("delete_patient", { patientId });
  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "환자 삭제에 실패했습니다." };
  }
  invalidateReservationDerivedCaches(patientId);
  return {
    success: true,
    deletedReservations: Number(apiResult.deletedReservations || 0),
  };
}
