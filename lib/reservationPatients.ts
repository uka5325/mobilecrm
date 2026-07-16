import type { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";
import { parseBirthInfo } from "./reservationUtils";
import { callReservationsApi } from "./reservationClientApi";
import {
  buildReservationUpdatePayload,
  mapPatientRecord,
  mapReservationDoc,
  type AppointmentType,
  type CreateReservationParams,
  type PatientRecord,
  type UpdateReservationParams,
} from "./reservationModels";
import { invalidatePatientFullHistoryCache } from "./reservationHistory";

export {
  getPatientSummaryCache,
  setPatientSummaryCache,
  invalidatePatientSummaryCache,
  isPatientSummaryCacheFresh,
} from "./patientSummaryClientCache";

import { invalidatePatientSummaryCache as _invalidatePatientSummaryCache } from "./patientSummaryClientCache";
// Backward-compatible export name retained for existing callsites.
export const invalidatePatientsSummaryCache = _invalidatePatientSummaryCache;

function makeDateBasedId(prefix: "P" | "R") {
  const now = new Date();

  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const random = Math.floor(100000 + Math.random() * 900000);

  return `${prefix}-${y}${m}${d}-${random}`;
}

// 예약 mutation 뒤 두 화면이 동일한 원본을 다시 읽도록 관련 세션 캐시를 한 번에 비운다.
export function invalidateReservationDerivedCaches(patientId: string) {
  const id = cleanText(patientId);
  if (!id) return;
  invalidatePatientsSummaryCache();
  invalidatePatientFullHistoryCache(id);
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
  if (result.success) invalidatePatientsSummaryCache();
  return result.success
    ? { success: true, patientDocId: String(result.patientDocId || "") }
    : { success: false, message: cleanText(result.message) || "등록 실패" };
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
  const canonicalPatientId = cleanText(apiResult.patientId);
  if (canonicalPatientId) invalidateReservationDerivedCaches(canonicalPatientId);

  return { success: true };
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

  const canonicalPatientId = cleanText(apiResult.patientId) || cleanText(patientId);
  invalidateReservationDerivedCaches(canonicalPatientId);
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
