"use client";

import { useState } from "react";
import type { StaffUser } from "@/lib/auth";
import {
  updateReservationFull,
  invalidatePatientFullHistoryCache,
  type AppointmentType,
  type ReservationRecord,
} from "@/lib/reservations";

// ReservationsTable의 InlineForm과 구조적으로 동일해야 한다(미export 타입이라 복제).
export type InlineReservationForm = {
  name: string; birthInput: string; phone: string; nationality: string;
  consultArea: string; reservationDate: string; reservationTime: string;
  coordinators: string; hospital: string;
  doctors: string;
  appointmentType: AppointmentType;
};

// 예약 행 인라인 편집: 편집 대상/폼 상태 + 저장(서버 업데이트 + 캐시 무효화 + 목록 재조회).
export function useReservationInlineEdit({
  currentUser,
  setPageError,
  reloadCurrent,
}: {
  currentUser: StaffUser | null;
  setPageError: (msg: string) => void;
  reloadCurrent: () => void;
}) {
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineForm, setInlineForm] = useState<InlineReservationForm | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);

  function startInlineEdit(item: ReservationRecord) {
    setInlineEditId(item.id);
    setInlineForm({
      name: item.name || "",
      birthInput: item.birthInput || item.birth || "",
      phone: item.phone || "",
      nationality: item.nationality || "",
      consultArea: item.consultArea || "",
      reservationDate: item.reservationDate || "",
      reservationTime: item.reservationTime || "",
      coordinators: item.coordinators.join(", "),
      hospital: item.hospital || "",
      doctors: (item.doctors || []).join(", "),
      appointmentType: item.appointmentType || "상담",
    });
  }

  function cancelInlineEdit() {
    setInlineEditId(null);
    setInlineForm(null);
  }

  async function saveInlineEdit(item: ReservationRecord) {
    if (!inlineForm || !currentUser) return;
    setInlineSaving(true);
    try {
      const result = await updateReservationFull(
        item.id,
        item.reservationId,
        item.patientId,
        {
          name: inlineForm.name,
          birthInput: inlineForm.birthInput,
          birth: inlineForm.birthInput,
          phone: inlineForm.phone,
          nationality: inlineForm.nationality,
          consultArea: inlineForm.consultArea,
          reservationDate: inlineForm.reservationDate,
          reservationTime: inlineForm.reservationTime,
          hospital: inlineForm.hospital,
          appointmentType: inlineForm.appointmentType,
          coordinators: inlineForm.coordinators.split(",").map((s) => s.trim()).filter(Boolean),
          doctors: inlineForm.doctors.split(",").map((s) => s.trim()).filter(Boolean),
        },
        currentUser
      );
      if (!result.success) {
        setPageError(result.message || "예약 수정에 실패했습니다.");
        return;
      }
      setInlineEditId(null);
      setInlineForm(null);
      invalidatePatientFullHistoryCache(item.patientId);
      reloadCurrent();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPageError(`수정 오류: ${msg}`);
      console.error("[ReservationsPage] inline save error:", (err as Error)?.message ?? "");
    } finally {
      setInlineSaving(false);
    }
  }

  return {
    inlineEditId,
    inlineForm,
    setInlineForm,
    inlineSaving,
    startInlineEdit,
    saveInlineEdit,
    cancelInlineEdit,
  };
}
