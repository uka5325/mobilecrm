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
import { getBirthGenderText, splitComma } from "@/lib/timelineUtils";
import { InfoTab } from "@/components/timeline/tabs/InfoTab";
import { FilesTab } from "@/components/timeline/tabs/FilesTab";
import { NotesTab } from "@/components/timeline/tabs/NotesTab";
import { LogsTab } from "@/components/timeline/tabs/LogsTab";
import { InvoiceTab } from "@/components/timeline/tabs/InvoiceTab";
import { CreateDrawer } from "@/components/reservations/CreateDrawer";

type DetailTab = "info" | "files" | "notes" | "logs" | "invoice";

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
  depositAmount: string;
  surgeryCost: string;
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
    coordinators: "", depositAmount: "", surgeryCost: "", doctors: "", completed: false, cancelled: false,
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
      depositAmount: reservation.depositAmount || "",
      surgeryCost: reservation.surgeryCost || "",
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
          depositAmount: detailForm.depositAmount,
          surgeryCost: detailForm.surgeryCost,
          doctors: splitComma(detailForm.doctors),
          completed: detailForm.completed,
          currentDoctorStatusMap: selectedReservation.doctorStatusMap,
          currentDoctorStatusMetaMap: selectedReservation.doctorStatusMetaMap,
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
        depositAmount: detailForm.depositAmount,
        surgeryCost: detailForm.surgeryCost,
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
    const next = !detailForm.completed;
    setDetailForm((p) => ({ ...p, completed: next }));
    await updateReservationFull(
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
        depositAmount: detailForm.depositAmount,
        surgeryCost: detailForm.surgeryCost,
        completed: next,
        currentDoctorStatusMap: selectedReservation.doctorStatusMap,
        currentDoctorStatusMetaMap: selectedReservation.doctorStatusMetaMap,
      },
      currentUser
    );
    const updated = { ...selectedReservation, completed: next };
    setSelectedReservation(updated);
    onRefresh?.();
    await onRefreshLatestLog(updated);
  }

  async function handleCancelledToggle() {
    if (!selectedReservation) return;
    const next = !detailForm.cancelled;
    setDetailForm((p) => ({ ...p, cancelled: next }));
    await updateReservationFull(
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
        depositAmount: detailForm.depositAmount,
        surgeryCost: detailForm.surgeryCost,
        completed: detailForm.completed,
        cancelled: next,
        currentDoctorStatusMap: selectedReservation.doctorStatusMap,
        currentDoctorStatusMetaMap: selectedReservation.doctorStatusMetaMap,
      },
      currentUser
    );
    const updated = { ...selectedReservation, cancelled: next };
    setSelectedReservation(updated);
    onRefresh?.();
    await onRefreshLatestLog(updated);
  }

  async function handleSurgeryToggle() {
    if (!selectedReservation) return;
    const next = !selectedReservation.surgeryReserved;
    await toggleSurgeryReserved(selectedReservation.id, selectedReservation.reservationId, next, currentUser);
    const updated = { ...selectedReservation, surgeryReserved: next };
    setSelectedReservation(updated);
    await loadLogs(updated);
    await onRefreshLatestLog(updated);
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
    depositAmount: selectedReservation.depositAmount,
    surgeryCost: selectedReservation.surgeryCost,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReservation?.id]);

  if (!open || !selectedReservation) return null;

  const birthGenderText = getBirthGenderText(selectedReservation);

  return (
    <>
      <div className="fixed inset-0 z-[998] bg-black/35" onClick={onClose} />

      <div className="fixed right-0 top-0 z-[999] flex h-screen w-[420px] max-w-[calc(100vw-12px)] flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
        <div className="shrink-0 border-b border-[#edf0f3] px-5 py-4">
          <div className="mb-3 flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-xl font-bold">{selectedReservation.name}</div>
              {birthGenderText && (
                <div className="mt-0.5 text-sm text-gray-500">{birthGenderText}</div>
              )}
              {(selectedReservation.hospital || selectedReservation.reservationTime || (selectedReservation.doctors && selectedReservation.doctors.length > 0)) && (
                <div className="mt-0.5 text-sm text-gray-500">
                  {[
                    selectedReservation.hospital,
                    selectedReservation.doctors?.length ? selectedReservation.doctors.join(", ") : null,
                    selectedReservation.reservationTime,
                  ].filter(Boolean).join(" · ")}
                </div>
              )}
              {selectedReservation.consultArea && (
                <div className="mt-0.5 text-xs text-gray-400">
                  {selectedReservation.appointmentType === "상담" ? "상담부위" : "수술항목"}: {selectedReservation.consultArea}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="ml-3 shrink-0 text-2xl leading-none text-gray-400 transition hover:scale-110 hover:text-gray-700 active:scale-95"
            >
              ×
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleCompletedToggle}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
                detailForm.completed
                  ? "border-gray-500 bg-gray-500 text-white"
                  : "border-gray-300 bg-white text-gray-600"
              }`}
            >
              완료 {detailForm.completed ? "✓" : "—"}
            </button>
            <button
              onClick={handleCancelledToggle}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
                detailForm.cancelled
                  ? "border-yellow-400 bg-yellow-100 text-yellow-800"
                  : "border-gray-300 bg-white text-gray-600"
              }`}
            >
              취소 {detailForm.cancelled ? "✓" : "—"}
            </button>
            {selectedReservation.appointmentType === "상담" && (
              <button
                onClick={handleSurgeryToggle}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
                  selectedReservation.surgeryReserved
                    ? "border-purple-600 bg-purple-600 text-white"
                    : "border-purple-400 bg-white text-purple-700"
                }`}
              >
                수술예약 {selectedReservation.surgeryReserved ? "✓" : "—"}
              </button>
            )}
            <button
              onClick={() => setAddReservationOpen(true)}
              className="rounded-lg border border-emerald-500 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
            >
              + 추가 예약
            </button>
          </div>
        </div>

        <div className="flex shrink-0 border-b border-[#edf0f3]">
          {(["info", "files", "notes", "logs", "invoice"] as const).map((key) => {
            const label = { info: "기본정보", files: "파일", notes: "메모", logs: "로그", invoice: "인보이스" }[key];
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex-1 border-b-2 py-2 text-center text-xs transition hover:bg-gray-50 active:scale-[0.98] ${
                  activeTab === key
                    ? "border-[#1d9e75] font-semibold text-[#1d9e75]"
                    : "border-transparent text-gray-500"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

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
