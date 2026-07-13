"use client";

import { useState } from "react";
import type { StaffUser } from "@/lib/auth";
import { updatePatientProfile, deletePatient, invalidatePatientFullHistoryCache } from "@/lib/reservations";
import type { PatientGroup, PatientEditForm } from "@/components/reservations/ReservationsTable";

// 환자 헤더 편집: patients 마스터 정보 수정(서버 1회 배치) + 고객 목록 삭제(soft delete).
export function usePatientProfileEdit({
  currentUser,
  setPageError,
  reloadCurrent,
}: {
  currentUser: StaffUser | null;
  setPageError: (msg: string) => void;
  reloadCurrent: () => void;
}) {
  const [patientEditId, setPatientEditId] = useState<string | null>(null);
  const [patientEditForm, setPatientEditForm] = useState<PatientEditForm | null>(null);
  const [patientEditSaving, setPatientEditSaving] = useState(false);

  function startPatientEdit(group: PatientGroup) {
    setPatientEditId(group.patientKey);
    setPatientEditForm({
      name: group.name || "",
      birthInput: group.birthInput || group.birth || "",
      phone: group.phone || "",
      nationality: group.nationality || "",
      gender: group.gender || "",
    });
  }

  function cancelPatientEdit() {
    setPatientEditId(null);
    setPatientEditForm(null);
  }

  async function savePatientEdit(group: PatientGroup) {
    if (!patientEditForm || !currentUser) return;
    setPatientEditSaving(true);
    try {
      // 서버 1회 배치: patients 마스터 + 해당 환자의 모든 예약 역정규화 필드 갱신
      const result = await updatePatientProfile(group.patientId, {
        name: patientEditForm.name,
        birthInput: patientEditForm.birthInput,
        phone: patientEditForm.phone,
        nationality: patientEditForm.nationality,
        gender: patientEditForm.gender,
      });
      if (!result.success) {
        setPageError(result.message || "환자정보 수정에 실패했습니다.");
        return;
      }
      setPatientEditId(null);
      setPatientEditForm(null);
      invalidatePatientFullHistoryCache(group.patientId);
      reloadCurrent();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPageError(`환자정보 수정 오류: ${msg}`);
    } finally {
      setPatientEditSaving(false);
    }
  }

  async function handleDeletePatient(group: PatientGroup) {
    if (!currentUser) return;
    // 삭제 정책: 환자/예약은 soft delete(목록에서 숨김), reservationLocks만 hard delete.
    // 인보이스·메모·사진·Storage 원본은 보존한다. "영구/전체 삭제"로 표현하지 않는다.
    const ok = confirm(
      `${group.name} 님을 고객 목록에서 삭제할까요?\n\n` +
      "이 작업은 환자와 관련 예약을 일반 고객 목록에서 숨깁니다.\n" +
      "의료기록, 인보이스, 사진, 메모 등 보존이 필요한 자료는 유지될 수 있습니다.\n\n" +
      "계속하시겠습니까?"
    );
    if (!ok) return;

    // 서버에서 patientId 기준 전체 예약 + 환자 문서를 일괄 soft-delete (45일 윈도우 밖 포함)
    const result = await deletePatient(group.patientId, currentUser);
    if (!result.success) {
      setPageError(result.message || "삭제 권한이 없습니다.");
      reloadCurrent();
      return;
    }
    invalidatePatientFullHistoryCache(group.patientId);
    reloadCurrent();
  }

  return {
    patientEditId,
    patientEditForm,
    setPatientEditForm,
    patientEditSaving,
    startPatientEdit,
    savePatientEdit,
    cancelPatientEdit,
    handleDeletePatient,
  };
}
