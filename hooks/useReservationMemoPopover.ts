"use client";

import { useState } from "react";
import type { StaffUser } from "@/lib/auth";
import { getPatientFullHistoryCached, type ReservationRecord } from "@/lib/reservations";
import {
  getReservationNotes,
  addReservationNote,
  updateReservationNote,
  deleteReservationNote,
  type ReservationNote,
} from "@/lib/reservationNotes";
import { type MemoPopoverState } from "@/components/reservations/MemoPopover";
import type { PatientGroup } from "@/components/reservations/ReservationsTable";

// 예약 메모 팝오버: 대상 예약의 메모 목록 로드 + 추가/수정/삭제 + 인라인 편집 상태.
export function useReservationMemoPopover({
  currentUser,
  setPageError,
}: {
  currentUser: StaffUser | null;
  setPageError: (msg: string) => void;
}) {
  const [memoPopover, setMemoPopover] = useState<MemoPopoverState>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");

  async function openMemoPopover(item: ReservationRecord) {
    setMemoPopover({ item, notes: [], loading: true });
    setEditingNoteId(null);
    const res = await getReservationNotes(item.reservationId, item.id, item.patientId);
    // 응답 대기 중 다른 환자 팝오버를 열었으면(prev.item.id 불일치) 덮지 않는다.
    setMemoPopover((prev) => {
      if (prev?.item.id !== item.id) return prev;
      return res.success
        ? { item, notes: res.notes, loading: false }
        : { item, notes: [], loading: false, error: res.message };
    });
  }

  // mutation 성공 후 목록 새로고침. race guard(item.id)로 다른 환자 팝오버를 덮지 않으며,
  // refetch만 실패한 경우 기존 목록을 보존한 채 팝오버 내부 + 페이지에 오류만 표시한다.
  async function refetchMemoNotes(item: ReservationRecord) {
    const res = await getReservationNotes(item.reservationId, item.id, item.patientId);
    if (!res.success) {
      setMemoPopover((prev) => (prev?.item.id === item.id ? { ...prev, loading: false, error: res.message } : prev));
      setPageError(res.message);
      return;
    }
    setMemoPopover((prev) => (prev?.item.id === item.id ? { ...prev, notes: res.notes, error: undefined } : prev));
  }

  async function handleMemoUpdate(note: ReservationNote) {
    if (!currentUser || !memoPopover) return;
    const result = await updateReservationNote({
      noteId: note.id,
      reservationId: note.reservationId,
      patientId: note.patientId || memoPopover.item.patientId || "",
      memoText: editingNoteText,
      staff: currentUser,
    });
    if (!result.success) {
      setPageError(result.message || "메모 수정에 실패했습니다.");
      return;
    }
    setEditingNoteId(null);
    await refetchMemoNotes(memoPopover.item);
  }

  async function handleMemoDelete(note: ReservationNote) {
    if (!currentUser || !memoPopover) return;
    if (!confirm("메모를 삭제할까요?")) return;
    const result = await deleteReservationNote({
      noteId: note.id,
      reservationId: note.reservationId,
      patientId: note.patientId || memoPopover.item.patientId || "",
      staff: currentUser,
    });
    if (!result.success) {
      setPageError(result.message || "메모 삭제에 실패했습니다.");
      return;
    }
    await refetchMemoNotes(memoPopover.item);
  }

  async function handleMemoAdd(text: string) {
    if (!currentUser || !memoPopover) return;
    const item = memoPopover.item;
    const result = await addReservationNote({
      reservationId: item.reservationId,
      reservationDocId: item.id,
      patientId: item.patientId || "",
      memoText: text,
      staff: currentUser,
    });
    if (!result.success) {
      setPageError(result.message || "메모 등록에 실패했습니다.");
      return;
    }
    await refetchMemoNotes(item);
  }

  async function openPatientMemoPopover(group: PatientGroup) {
    let rep = group.reservations[group.reservations.length - 1];
    if (!rep) {
      // summary만 있는(45일 지난) 환자: 메모를 붙일 대표 예약을 lazy-load(최신 1건).
      try {
        const { reservations: full } = await getPatientFullHistoryCached(group.patientId);
        rep = full[0];
      } catch { /* 무시 */ }
    }
    if (!rep) { setPageError("메모를 추가할 예약이 없습니다."); return; }
    await openMemoPopover(rep);
  }

  return {
    memoPopover,
    setMemoPopover,
    editingNoteId,
    setEditingNoteId,
    editingNoteText,
    setEditingNoteText,
    handleMemoUpdate,
    handleMemoDelete,
    handleMemoAdd,
    openPatientMemoPopover,
  };
}
