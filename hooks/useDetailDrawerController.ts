"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  toggleSurgeryReserved,
  updateReservationFull,
  type AppointmentType,
  type ReservationRecord,
} from "@/lib/reservations";
import type { StaffUser } from "@/lib/auth";
import { parseBirthInfo } from "@/lib/reservationUtils";
import { getLogsByReservationId, type LogRecord } from "@/lib/logs";
import {
  addReservationNote,
  deleteReservationNote,
  getReservationNotes,
  updateReservationNote,
  type ReservationNote,
  type MutationResult,
} from "@/lib/reservationNotes";
import { todayString } from "@/lib/dateUtils";
import { splitComma } from "@/lib/timelineUtils";
import type { DetailTab } from "@/components/timeline/DetailDrawerTabs";

export type DetailForm = {
  name: string;
  birthInput: string;
  phone: string;
  nationality: string;
  consultArea: string;
  reservationDate: string;
  reservationTime: string;
  hospital: string;
  appointmentType: AppointmentType;
  coordinators: string;
  doctors: string;
  completed: boolean;
  cancelled: boolean;
};

type ControllerArgs = {
  open: boolean;
  reservation: ReservationRecord | null;
  currentUser: StaffUser;
  onRefreshLatestLog: (item: ReservationRecord) => Promise<void>;
  onRefresh?: () => void;
};

// 예약 상세 드로어의 상태·로딩·저장/토글/메모/로그 흐름을 한곳에서 소유하는 컨트롤러.
// 컴포넌트(DetailDrawer)는 props를 넘기고 JSX 배선만 담당한다.
export function useDetailDrawerController({
  open,
  reservation,
  currentUser,
  onRefreshLatestLog,
  onRefresh,
}: ControllerArgs) {
  const [activeTab, setActiveTab] = useState<DetailTab>("info");
  const [selectedReservation, setSelectedReservation] = useState<ReservationRecord | null>(null);

  const [detailError, setDetailError] = useState("");
  const [detailMessage, setDetailMessage] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);

  const [addReservationOpen, setAddReservationOpen] = useState(false);

  const [detailForm, setDetailForm] = useState<DetailForm>({
    name: "", birthInput: "", phone: "", nationality: "",
    consultArea: "", reservationDate: todayString(),
    reservationTime: "", hospital: "", appointmentType: "상담",
    coordinators: "", doctors: "", completed: false, cancelled: false,
  });

  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [logsRecentOnly, setLogsRecentOnly] = useState(true);
  const logsLoadedReservationRef = useRef<string | null>(null);
  const logsLoadSeqRef = useRef(0);

  const [memoText, setMemoText] = useState("");
  const [memoError, setMemoError] = useState("");
  const [memoSuccess, setMemoSuccess] = useState("");
  const [notes, setNotes] = useState<ReservationNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState("");
  const fullNotesLoadedReservationRef = useRef<string | null>(null);
  const notesLoadSeqRef = useRef(0);

  useEffect(() => {
    if (!open || !reservation) return;

    setActiveTab("info");
    setDetailError("");
    setDetailMessage("");
    setMemoText("");
    setMemoError("");
    setMemoSuccess("");
    setNotes([]);
    setNotesError("");
    fullNotesLoadedReservationRef.current = null;
    notesLoadSeqRef.current += 1;
    setLogs([]);
    setLogsError("");
    setLogsRecentOnly(true);
    logsLoadedReservationRef.current = null;
    logsLoadSeqRef.current += 1;
    setSelectedReservation(reservation);
    setDetailForm({
      name: reservation.name || "",
      birthInput: reservation.birthInput || reservation.birth || "",
      phone: reservation.phone || "",
      nationality: reservation.nationality || "",
      consultArea: reservation.consultArea || "",
      reservationDate: reservation.reservationDate || todayString(),
      reservationTime: reservation.reservationTime || "",
      hospital: reservation.hospital || "",
      appointmentType: reservation.appointmentType || "상담",
      coordinators: (reservation.coordinators || []).join(", "),
      doctors: (reservation.doctors || []).join(", "),
      completed: reservation.completed === true,
      cancelled: (reservation as unknown as Record<string, unknown>).cancelled === true,
    });

    const mounted = { current: true };
    loadNotes(reservation, mounted, 3);
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reservation?.id]);

  useEffect(() => {
    if (!open || activeTab !== "logs" || !selectedReservation || selectedReservation.id !== reservation?.id) return;
    if (logsLoadedReservationRef.current === selectedReservation.id) return;
    logsLoadedReservationRef.current = selectedReservation.id;
    void loadLogs(selectedReservation);
    // loadLogs는 컴포넌트 스코프 함수이며 예약 ID/ref가 중복 로드를 막는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab, selectedReservation?.id, reservation?.id]);

  useEffect(() => {
    if (!open || activeTab !== "notes" || !selectedReservation || selectedReservation.id !== reservation?.id) return;
    if (fullNotesLoadedReservationRef.current === selectedReservation.id) return;
    void loadNotes(selectedReservation);
    // loadNotes는 request sequence와 예약 ID/ref로 중복·stale 응답을 막는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab, selectedReservation?.id, reservation?.id]);

  const detailBirthPreview = useMemo(() => parseBirthInfo(detailForm.birthInput), [detailForm.birthInput]);
  const recentNotes = notes.slice(0, 3);

  // sinceDays>0이면 최근 N일만(상세 오픈 기본 3일), 0이면 전체("이전 로그 보기").
  async function loadLogs(item: ReservationRecord, mounted?: { current: boolean }, sinceDays: number = 3) {
    // notes와 동일한 request sequence guard: 같은 예약에서 recent(3일)/older(전체) 로드가
    // 겹칠 때 늦게 도착한 응답이 최신 응답을 덮어쓰지 않도록 한다.
    const seq = ++logsLoadSeqRef.current;
    setLogsLoading(true);
    setLogsError("");
    setLogs([]);
    try {
      const list = await getLogsByReservationId(item.reservationId, item.id, item.patientId, { sinceDays });
      if ((mounted && !mounted.current) || logsLoadSeqRef.current !== seq) return;
      setLogs(list);
      setLogsRecentOnly(sinceDays > 0);
    } catch {
      if ((mounted && !mounted.current) || logsLoadSeqRef.current !== seq) return;
      logsLoadedReservationRef.current = null;
      setLogsError("로그를 불러오지 못했습니다.");
    } finally {
      if ((!mounted || mounted.current) && logsLoadSeqRef.current === seq) setLogsLoading(false);
    }
  }

  async function loadOlderLogs() {
    if (!selectedReservation) return;
    await loadLogs(selectedReservation, undefined, 0);
  }

  async function loadNotes(
    item: ReservationRecord,
    mounted?: { current: boolean },
    limit?: number
  ) {
    const seq = ++notesLoadSeqRef.current;
    if (limit == null) fullNotesLoadedReservationRef.current = item.id;
    setNotesLoading(true);
    setNotesError("");
    // getReservationNotes는 throw하지 않고 판별 결과를 돌려준다. seq/mounted 가드로 stale 응답만 무시.
    const res = await getReservationNotes(
      item.reservationId,
      item.id,
      item.patientId,
      limit == null ? {} : { limit }
    );
    if ((mounted && !mounted.current) || notesLoadSeqRef.current !== seq) return;
    if (!res.success) {
      // 전체 로드 실패 시 ref를 비워 다음 진입에서 재시도 가능하게 한다.
      if (limit == null && fullNotesLoadedReservationRef.current === item.id) {
        fullNotesLoadedReservationRef.current = null;
      }
      setNotes([]);
      setNotesError(res.message);
    } else {
      setNotes(res.notes);
    }
    setNotesLoading(false);
  }

  async function refreshLoadedNotes(item: ReservationRecord) {
    const limit = fullNotesLoadedReservationRef.current === item.id ? undefined : 3;
    await loadNotes(item, undefined, limit);
  }

  function updateForm(updates: Partial<DetailForm>) {
    setDetailForm((p) => ({ ...p, ...updates }));
  }

  async function handleSaveDetail() {
    if (!selectedReservation) return;
    if (!detailForm.name.trim()) { setDetailError("이름을 입력하세요."); return; }
    if (!detailForm.reservationDate) { setDetailError("예약날짜를 선택하세요."); return; }

    setDetailSaving(true);
    setDetailError("");
    setDetailMessage("");

    try {
      const result = await updateReservationFull(
        selectedReservation.id,
        selectedReservation.reservationId,
        selectedReservation.patientId,
        {
          name: detailForm.name,
          birthInput: detailForm.birthInput,
          birth: detailForm.birthInput,
          phone: detailForm.phone,
          nationality: detailForm.nationality,
          consultArea: detailForm.consultArea,
          reservationDate: detailForm.reservationDate,
          reservationTime: detailForm.reservationTime,
          hospital: detailForm.hospital,
          appointmentType: detailForm.appointmentType,
          coordinators: splitComma(detailForm.coordinators),
          doctors: splitComma(detailForm.doctors),
          completed: detailForm.completed,
        },
        currentUser
      );

      if (!result.success) { setDetailError(result.message || "예약 수정에 실패했습니다."); return; }

      const updated: ReservationRecord = {
        ...selectedReservation,
        name: detailForm.name,
        patientName: detailForm.name,
        birthInput: detailForm.birthInput,
        birth: detailForm.birthInput,
        phone: detailForm.phone,
        nationality: detailForm.nationality,
        consultArea: detailForm.consultArea,
        reservationDate: detailForm.reservationDate,
        reservationTime: detailForm.reservationTime,
        hospital: detailForm.hospital,
        appointmentType: detailForm.appointmentType,
        coordinators: splitComma(detailForm.coordinators),
        doctors: splitComma(detailForm.doctors),
        completed: detailForm.completed,
      };

      setSelectedReservation(updated);
      setDetailMessage("수정 저장 완료");
      // 부모(전체 이력 모달/리스트)에 저장 사실을 알려 stale 목록을 갱신한다.
      // (형제 핸들러 handleCompletedToggle/handleCancelledToggle과 동일 패턴)
      onRefresh?.();
      if (logsLoadedReservationRef.current === updated.id) await loadLogs(updated);
      await onRefreshLatestLog(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDetailError(`저장 오류: ${msg}`);
      console.error("[DetailDrawer] save error:", (err as Error)?.message ?? "");
    } finally {
      setDetailSaving(false);
    }
  }

  async function handleCompletedToggle() {
    if (!selectedReservation) return;
    const prev = detailForm.completed;
    const next = !prev;
    setDetailForm((p) => ({ ...p, completed: next }));
    try {
      const result = await updateReservationFull(
        selectedReservation.id,
        selectedReservation.reservationId,
        selectedReservation.patientId,
        // 상태 토글은 마지막으로 저장된 예약값(selectedReservation)만 재전송하고 완료 플래그만
        // 바꾼다. detailForm에 있는 미저장 편집을 토글 한 번에 조용히 커밋하지 않도록 한다.
        {
          name: selectedReservation.name,
          birthInput: selectedReservation.birthInput || selectedReservation.birth,
          birth: selectedReservation.birthInput || selectedReservation.birth,
          phone: selectedReservation.phone,
          nationality: selectedReservation.nationality,
          consultArea: selectedReservation.consultArea,
          reservationDate: selectedReservation.reservationDate,
          reservationTime: selectedReservation.reservationTime,
          hospital: selectedReservation.hospital,
          appointmentType: selectedReservation.appointmentType,
          coordinators: selectedReservation.coordinators || [],
          doctors: selectedReservation.doctors || [],
          completed: next,
        },
        currentUser
      );
      if (!result.success) {
        setDetailForm((p) => ({ ...p, completed: prev }));
        setDetailError(result.message || "완료 상태 변경에 실패했습니다.");
        return;
      }
      const updated = { ...selectedReservation, completed: next };
      setSelectedReservation(updated);
      onRefresh?.();
      await onRefreshLatestLog(updated);
    } catch {
      setDetailForm((p) => ({ ...p, completed: prev }));
      setDetailError("완료 상태 변경 중 오류가 발생했습니다.");
    }
  }

  async function handleCancelledToggle() {
    if (!selectedReservation) return;
    const prev = detailForm.cancelled;
    const next = !prev;
    setDetailForm((p) => ({ ...p, cancelled: next }));
    try {
      const result = await updateReservationFull(
        selectedReservation.id,
        selectedReservation.reservationId,
        selectedReservation.patientId,
        // 상태 토글은 마지막으로 저장된 예약값(selectedReservation)만 재전송하고 취소 플래그만
        // 바꾼다. detailForm에 있는 미저장 편집을 토글 한 번에 조용히 커밋하지 않도록 한다.
        {
          name: selectedReservation.name,
          birthInput: selectedReservation.birthInput || selectedReservation.birth,
          birth: selectedReservation.birthInput || selectedReservation.birth,
          phone: selectedReservation.phone,
          nationality: selectedReservation.nationality,
          consultArea: selectedReservation.consultArea,
          reservationDate: selectedReservation.reservationDate,
          reservationTime: selectedReservation.reservationTime,
          hospital: selectedReservation.hospital,
          appointmentType: selectedReservation.appointmentType,
          coordinators: selectedReservation.coordinators || [],
          doctors: selectedReservation.doctors || [],
          completed: selectedReservation.completed,
          cancelled: next,
        },
        currentUser
      );
      if (!result.success) {
        setDetailForm((p) => ({ ...p, cancelled: prev }));
        setDetailError(result.message || "취소 상태 변경에 실패했습니다.");
        return;
      }
      const updated = { ...selectedReservation, cancelled: next };
      setSelectedReservation(updated);
      onRefresh?.();
      await onRefreshLatestLog(updated);
    } catch {
      setDetailForm((p) => ({ ...p, cancelled: prev }));
      setDetailError("취소 상태 변경 중 오류가 발생했습니다.");
    }
  }

  async function handleSurgeryToggle() {
    if (!selectedReservation) return;
    const next = !selectedReservation.surgeryReserved;
    try {
      const result = await toggleSurgeryReserved(selectedReservation.id, selectedReservation.reservationId, next, currentUser);
      if (!result.success) {
        setDetailError(result.message || "수술예약 상태 변경에 실패했습니다.");
        return;
      }
      const updated = { ...selectedReservation, surgeryReserved: next };
      setSelectedReservation(updated);
      if (logsLoadedReservationRef.current === updated.id) await loadLogs(updated);
      await onRefreshLatestLog(updated);
    } catch {
      setDetailError("수술예약 상태 변경 중 오류가 발생했습니다.");
    }
  }

  // 저장은 성공했는데 후속 새로고침만 실패한 경우 mutation 성공을 뒤집지 않는다(best-effort).
  async function refreshAfterMutation() {
    if (!selectedReservation) return;
    try {
      await refreshLoadedNotes(selectedReservation);
      if (logsLoadedReservationRef.current === selectedReservation.id) await loadLogs(selectedReservation);
      await onRefreshLatestLog(selectedReservation);
    } catch { /* mutation은 성공, 새로고침 실패는 무시 */ }
  }

  async function handleAddMemo(): Promise<MutationResult> {
    if (!selectedReservation) return { success: false, message: "예약이 선택되지 않았습니다." };
    const text = memoText.trim();
    setMemoError("");
    setMemoSuccess("");
    if (!text) {
      const message = "메모 내용을 입력하세요.";
      setMemoError(message);
      return { success: false, message };
    }

    const result = await addReservationNote({
      reservationId: selectedReservation.reservationId,
      reservationDocId: selectedReservation.id,
      patientId: selectedReservation.patientId || "",
      memoText: text,
      staff: currentUser,
    });
    if (!result.success) { setMemoError(result.message); return result; }

    setMemoText("");
    setMemoSuccess("메모가 저장되었습니다.");
    await refreshAfterMutation();
    return { success: true };
  }

  async function handleUpdateNote(note: ReservationNote, newText: string): Promise<MutationResult> {
    if (!selectedReservation) return { success: false, message: "예약이 선택되지 않았습니다." };
    const result = await updateReservationNote({
      noteId: note.id,
      reservationId: selectedReservation.reservationId,
      patientId: selectedReservation.patientId || "",
      memoText: newText,
      staff: currentUser,
    });
    if (!result.success) return result;
    await refreshAfterMutation();
    return { success: true };
  }

  async function handleDeleteNote(note: ReservationNote): Promise<MutationResult> {
    if (!selectedReservation) return { success: false, message: "예약이 선택되지 않았습니다." };
    if (!confirm("메모를 삭제할까요?")) return { success: true }; // 취소 = 무동작
    const result = await deleteReservationNote({
      noteId: note.id,
      reservationId: selectedReservation.reservationId,
      patientId: selectedReservation.patientId || "",
      staff: currentUser,
    });
    if (!result.success) return result;
    await refreshAfterMutation();
    return { success: true };
  }

  // Stable reference — only changes when reservation ID changes, prevents form reset on parent re-render
  const addReservationPatient = useMemo(() => !selectedReservation ? undefined : {
    name: selectedReservation.name,
    birthInput: selectedReservation.birthInput || selectedReservation.birth,
    phone: selectedReservation.phone,
    nationality: selectedReservation.nationality,
    patientId: selectedReservation.patientId,
    hospital: selectedReservation.hospital,
    consultArea: selectedReservation.consultArea,
    appointmentType: selectedReservation.appointmentType,
    coordinators: (selectedReservation.coordinators || []).join(", "),
    doctors: (selectedReservation.doctors || []).join(", "),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReservation?.id]);

  return {
    activeTab,
    setActiveTab,
    selectedReservation,
    detailForm,
    updateForm,
    detailError,
    detailMessage,
    detailSaving,
    detailBirthPreview,
    memoText,
    setMemoText,
    memoError,
    memoSuccess,
    notes,
    notesLoading,
    notesError,
    recentNotes,
    logs,
    logsLoading,
    logsError,
    logsRecentOnly,
    loadOlderLogs,
    addReservationOpen,
    setAddReservationOpen,
    addReservationPatient,
    handleSaveDetail,
    handleCompletedToggle,
    handleCancelledToggle,
    handleSurgeryToggle,
    handleAddMemo,
    handleUpdateNote,
    handleDeleteNote,
  };
}
