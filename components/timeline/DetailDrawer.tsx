"use client";

import { useEffect, useMemo, useState } from "react";
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
} from "@/lib/reservationNotes";
import { todayString } from "@/lib/dateUtils";
import { splitComma } from "@/lib/timelineUtils";
import { DetailDrawerHeader } from "@/components/timeline/DetailDrawerHeader";
import { DetailDrawerTabs, type DetailTab } from "@/components/timeline/DetailDrawerTabs";
import { InfoTab } from "@/components/timeline/tabs/InfoTab";
import { FilesTab } from "@/components/timeline/tabs/FilesTab";
import { NotesTab } from "@/components/timeline/tabs/NotesTab";
import { LogsTab } from "@/components/timeline/tabs/LogsTab";
import { InvoiceTab } from "@/components/timeline/tabs/InvoiceTab";
import { SettlementPanel } from "@/components/settlements/SettlementPanel";
import { CreateDrawer } from "@/components/reservations/CreateDrawer";

type DetailForm = {
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

type Props = {
  open: boolean;
  reservation: ReservationRecord | null;
  currentUser: StaffUser;
  onClose: () => void;
  onRefreshLatestLog: (item: ReservationRecord) => Promise<void>;
  onRefresh?: () => void;
};

export function DetailDrawer({ open, reservation, currentUser, onClose, onRefreshLatestLog, onRefresh }: Props) {
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

  const [memoText, setMemoText] = useState("");
  const [memoError, setMemoError] = useState("");
  const [memoSuccess, setMemoSuccess] = useState("");
  const [notes, setNotes] = useState<ReservationNote[]>([]);

  useEffect(() => {
    if (!open || !reservation) return;

    setActiveTab("info");
    setDetailError("");
    setDetailMessage("");
    setMemoText("");
    setMemoError("");
    setMemoSuccess("");
    setNotes([]);
    setLogs([]);
    setLogsError("");
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
    loadLogs(reservation, mounted);
    loadNotes(reservation, mounted);
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reservation?.id]);

  const detailBirthPreview = useMemo(() => parseBirthInfo(detailForm.birthInput), [detailForm.birthInput]);
  const recentNotes = notes.slice(0, 3);

  // sinceDays>0이면 최근 N일만(상세 오픈 기본 3일), 0이면 전체("이전 로그 보기").
  async function loadLogs(item: ReservationRecord, mounted?: { current: boolean }, sinceDays: number = 3) {
    setLogsLoading(true);
    setLogsError("");
    setLogs([]);
    try {
      const list = await getLogsByReservationId(item.reservationId, item.id, item.patientId, { sinceDays });
      if (mounted && !mounted.current) return;
      setLogs(list);
      setLogsRecentOnly(sinceDays > 0);
    } catch {
      if (mounted && !mounted.current) return;
      setLogsError("로그를 불러오지 못했습니다.");
    } finally {
      if (!mounted || mounted.current) setLogsLoading(false);
    }
  }

  async function loadOlderLogs() {
    if (!selectedReservation) return;
    await loadLogs(selectedReservation, undefined, 0);
  }

  async function loadNotes(item: ReservationRecord, mounted?: { current: boolean }) {
    try {
      const list = await getReservationNotes(item.reservationId, item.id, item.patientId);
      if (mounted && !mounted.current) return;
      setNotes(list);
    } catch {
      if (!mounted || mounted.current) setNotes([]);
    }
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
      await loadLogs(updated);
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
      await loadLogs(updated);
      await onRefreshLatestLog(updated);
    } catch {
      setDetailError("수술예약 상태 변경 중 오류가 발생했습니다.");
    }
  }

  async function handleAddMemo() {
    if (!selectedReservation) return;
    const text = memoText.trim();
    setMemoError("");
    setMemoSuccess("");
    if (!text) { setMemoError("메모 내용을 입력하세요."); return; }

    try {
      const result = await addReservationNote({
        reservationId: selectedReservation.reservationId,
        reservationDocId: selectedReservation.id,
        patientId: selectedReservation.patientId || "",
        memoText: text,
        staff: currentUser,
      });

      if (!result.success) { setMemoError(result.message || "메모 저장 실패"); return; }

      setMemoText("");
      setMemoSuccess("메모가 저장되었습니다.");
      await loadNotes(selectedReservation);
      await loadLogs(selectedReservation);
      await onRefreshLatestLog(selectedReservation);
    } catch {
      setMemoError("메모 저장 중 오류가 발생했습니다.");
    }
  }

  async function handleUpdateNote(note: ReservationNote, newText: string) {
    if (!selectedReservation) return;
    const result = await updateReservationNote({
      noteId: note.id,
      reservationId: selectedReservation.reservationId,
      patientId: selectedReservation.patientId || "",
      memoText: newText,
      staff: currentUser,
    });
    if (!result.success) { setMemoError(result.message || "메모 수정 실패"); return; }
    await loadNotes(selectedReservation);
    await loadLogs(selectedReservation);
    await onRefreshLatestLog(selectedReservation);
  }

  async function handleDeleteNote(note: ReservationNote) {
    if (!selectedReservation) return;
    if (!confirm("메모를 삭제할까요?")) return;
    await deleteReservationNote({
      noteId: note.id,
      reservationId: selectedReservation.reservationId,
      patientId: selectedReservation.patientId || "",
      staff: currentUser,
    });
    await loadNotes(selectedReservation);
    await loadLogs(selectedReservation);
    await onRefreshLatestLog(selectedReservation);
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

  if (!open || !selectedReservation) return null;

  return (
    <>
      <div className="fixed inset-0 z-[998] bg-black/35" onClick={onClose} />

      <div className="fixed right-0 top-0 z-[999] flex h-screen w-[420px] max-w-[calc(100vw-12px)] flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
        <DetailDrawerHeader
          reservation={selectedReservation}
          completed={detailForm.completed}
          cancelled={detailForm.cancelled}
          onClose={onClose}
          onCompletedToggle={handleCompletedToggle}
          onCancelledToggle={handleCancelledToggle}
          onSurgeryToggle={handleSurgeryToggle}
          onAddReservation={() => setAddReservationOpen(true)}
        />

        <DetailDrawerTabs activeTab={activeTab} onTabChange={setActiveTab} />

        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === "info" && (
            <InfoTab
              detailForm={detailForm}
              birthPreview={detailBirthPreview}
              detailError={detailError}
              detailMessage={detailMessage}
              detailSaving={detailSaving}
              memoText={memoText}
              memoError={memoError}
              memoSuccess={memoSuccess}
              recentNotes={recentNotes}
              onFormChange={(updates) => setDetailForm((p) => ({ ...p, ...updates }))}
              onSave={handleSaveDetail}
              onMemoTextChange={setMemoText}
              onAddMemo={handleAddMemo}
              onUpdateNote={handleUpdateNote}
              onDeleteNote={handleDeleteNote}
              onShowAllNotes={() => setActiveTab("notes")}
            />
          )}

          {activeTab === "settlement" && selectedReservation && (
            <SettlementPanel
              patientId={selectedReservation.patientId}
              patientName={selectedReservation.name}
              currentReservation={{
                id: selectedReservation.id,
                reservationId: selectedReservation.reservationId,
                reservationDate: selectedReservation.reservationDate,
                reservationTime: selectedReservation.reservationTime,
                appointmentType: selectedReservation.appointmentType,
                hospital: selectedReservation.hospital,
                consultArea: selectedReservation.consultArea,
              }}
              onMutated={onRefresh}
            />
          )}

          {activeTab === "files" && selectedReservation && (
            <FilesTab
              reservationDocId={selectedReservation.id}
              reservationId={selectedReservation.reservationId}
              patientId={selectedReservation.patientId}
              currentUser={currentUser}
            />
          )}

          {activeTab === "notes" && (
            <NotesTab
              memoText={memoText}
              notes={notes}
              memoError={memoError}
              memoSuccess={memoSuccess}
              onMemoTextChange={setMemoText}
              onAddMemo={handleAddMemo}
              onUpdateNote={handleUpdateNote}
              onDeleteNote={handleDeleteNote}
            />
          )}

          {activeTab === "logs" && (
            <LogsTab
              logs={logs}
              loading={logsLoading}
              error={logsError}
              canLoadOlder={logsRecentOnly}
              onLoadOlder={loadOlderLogs}
            />
          )}

          {activeTab === "invoice" && selectedReservation && (
            <InvoiceTab
              reservationDocId={selectedReservation.id}
              patientId={selectedReservation.patientId}
              currentUser={currentUser}
              appointmentType={selectedReservation.appointmentType}
              coordinators={selectedReservation.coordinators}
            />
          )}
        </div>
      </div>

      <CreateDrawer
        open={addReservationOpen}
        onClose={() => setAddReservationOpen(false)}
        currentUser={currentUser}
        mode="reservation"
        initialDate={selectedReservation.reservationDate}
        initialPatient={addReservationPatient}
        onCreated={() => {
          setAddReservationOpen(false);
          onRefresh?.();
        }}
      />
    </>
  );
}
