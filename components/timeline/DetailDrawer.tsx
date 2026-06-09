"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  toggleSurgeryReserved,
  updateDoctorStatus,
  updateReservationFull,
  updateReservationStatus,
  type DoctorOption,
  type ReservationRecord,
  type ReservationStatus,
} from "@/lib/reservations";
import type { StaffUser } from "@/lib/auth";
import { parseBirthInfo } from "@/lib/reservationUtils";
import { createLog, getLogsByReservationId, type LogRecord } from "@/lib/logs";
import { db } from "@/lib/firebase";
import { type VisitStatusColorMap } from "@/lib/settings";
import {
  addReservationNote,
  deleteReservationNote,
  getReservationNotes,
  updateReservationNote,
  type ReservationNote,
} from "@/lib/reservationNotes";
import { todayString } from "@/lib/dateUtils";
import { getBirthGenderNationalityText, splitComma } from "@/lib/timelineUtils";
import { getReadableTextColor, getStatusColor } from "@/lib/colorUtils";
import { InfoTab } from "@/components/timeline/tabs/InfoTab";
import { FilesTab } from "@/components/timeline/tabs/FilesTab";
import { NotesTab } from "@/components/timeline/tabs/NotesTab";
import { LogsTab } from "@/components/timeline/tabs/LogsTab";
import { InvoiceTab } from "@/components/timeline/tabs/InvoiceTab";

const DETAIL_STATUS_LIST: ReservationStatus[] = ["대기", "원상중", "후상중", "귀가", "부도"];

type DetailTab = "info" | "files" | "notes" | "logs" | "invoice";

type DetailForm = {
  name: string;
  birthInput: string;
  phone: string;
  nationality: string;
  consultArea: string;
  reservationDate: string;
  reservationTime: string;
  coordinators: string;
  depositAmount: string;
};

type Props = {
  open: boolean;
  reservation: ReservationRecord | null;
  doctors: DoctorOption[];
  currentUser: StaffUser;
  statusColors: VisitStatusColorMap;
  clickedDoctorName?: string;
  onClose: () => void;
  onRefreshLatestLog: (item: ReservationRecord) => Promise<void>;
};

export function DetailDrawer({ open, reservation, doctors, currentUser, statusColors, clickedDoctorName, onClose, onRefreshLatestLog }: Props) {
  const [activeTab, setActiveTab] = useState<DetailTab>("info");
  const [selectedReservation, setSelectedReservation] = useState<ReservationRecord | null>(null);

  const [detailDoctors, setDetailDoctors] = useState<string[]>([]);
  const [detailError, setDetailError] = useState("");
  const [detailMessage, setDetailMessage] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);

  const [detailForm, setDetailForm] = useState<DetailForm>({
    name: "", birthInput: "", phone: "", nationality: "",
    consultArea: "", reservationDate: todayString(),
    reservationTime: "", coordinators: "", depositAmount: "",
  });

  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");

  const [memoText, setMemoText] = useState("");
  const [notes, setNotes] = useState<ReservationNote[]>([]);

  useEffect(() => {
    if (!open || !reservation) return;

    setActiveTab("info");
    setDetailError("");
    setDetailMessage("");
    setMemoText("");
    setNotes([]);
    setLogs([]);
    setLogsError("");
    setSelectedReservation(reservation);
    setDetailDoctors(reservation.doctors || []);
    setDetailForm({
      name: reservation.name || "",
      birthInput: reservation.birthInput || reservation.birth || "",
      phone: reservation.phone || "",
      nationality: reservation.nationality || "",
      consultArea: reservation.consultArea || "",
      reservationDate: reservation.reservationDate || todayString(),
      reservationTime: reservation.reservationTime || "",
      coordinators: (reservation.coordinators || []).join(", "),
      depositAmount: reservation.depositAmount || "",
    });

    const mounted = { current: true };
    loadLogs(reservation, mounted);
    loadNotes(reservation, mounted);
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reservation?.id]);

  const detailBirthPreview = useMemo(() => parseBirthInfo(detailForm.birthInput), [detailForm.birthInput]);
  const selectedStatus = selectedReservation?.operationStatus || "내원전";
  const recentNotes = notes.slice(0, 3);

  async function loadLogs(item: ReservationRecord, mounted?: { current: boolean }) {
    setLogsLoading(true);
    setLogsError("");
    setLogs([]);
    try {
      const list = await getLogsByReservationId(item.reservationId, item.id);
      if (mounted && !mounted.current) return;
      setLogs(list);
    } catch {
      if (mounted && !mounted.current) return;
      setLogsError("로그를 불러오지 못했습니다.");
    } finally {
      if (!mounted || mounted.current) setLogsLoading(false);
    }
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

  function toggleDetailDoctor(name: string) {
    setDetailDoctors((prev) => prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]);
  }

  async function handleSaveDetail() {
    if (!selectedReservation) return;
    if (!detailForm.name.trim()) { setDetailError("이름을 입력하세요."); return; }
    if (!detailForm.reservationDate) { setDetailError("예약날짜를 선택하세요."); return; }
    if (!detailDoctors.length) { setDetailError("지정원장을 선택하세요."); return; }

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
          doctors: detailDoctors,
          coordinators: splitComma(detailForm.coordinators),
          depositAmount: detailForm.depositAmount,
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
        doctors: detailDoctors,
        coordinators: splitComma(detailForm.coordinators),
        depositAmount: detailForm.depositAmount,
      };

      setSelectedReservation(updated);
      setDetailMessage("수정 저장 완료");
      await loadLogs(updated);
      await onRefreshLatestLog(updated);
    } catch {
      setDetailError("예약 수정 중 오류가 발생했습니다.");
    } finally {
      setDetailSaving(false);
    }
  }

  async function handleStatusChange(status: ReservationStatus) {
    if (!selectedReservation) return;

    // 원상중은 클릭한 doctor column에만 반영
    if (status === "원상중" && clickedDoctorName) {
      await updateDoctorStatus(
        selectedReservation.id,
        selectedReservation.reservationId,
        clickedDoctorName,
        "원상중",
        currentUser,
        { previousOperationStatus: selectedReservation.operationStatus }
      );
      const updated = {
        ...selectedReservation,
        operationStatus: "원상중" as ReservationStatus,
        preConsStatus: selectedReservation.operationStatus,
        doctorStatusMap: { ...selectedReservation.doctorStatusMap, [clickedDoctorName]: "원상중" },
      };
      setSelectedReservation(updated);
      await loadLogs(updated);
      await onRefreshLatestLog(updated);
      return;
    }

    const nextStatus = status === "대기" && selectedReservation.operationStatus === "대기" ? "내원전" : status;

    await updateReservationStatus(
      selectedReservation.id,
      selectedReservation.reservationId,
      nextStatus,
      currentUser
    );

    // 원상중이 남아있는 모든 doctor의 per-doctor status를 초기화 (두 카드 동시 반영)
    const doctorStatusMap = selectedReservation.doctorStatusMap || {};
    const doctorsWithConsStatus = Object.entries(doctorStatusMap)
      .filter(([, s]) => s === "원상중")
      .map(([d]) => d);

    await Promise.all(
      doctorsWithConsStatus.map((doctorName) =>
        updateDoctorStatus(
          selectedReservation.id,
          selectedReservation.reservationId,
          doctorName,
          nextStatus,
          currentUser
        )
      )
    );

    const newDoctorStatusMap = { ...doctorStatusMap };
    doctorsWithConsStatus.forEach((d) => { newDoctorStatusMap[d] = nextStatus; });

    const updated = {
      ...selectedReservation,
      operationStatus: nextStatus,
      doctorStatusMap: newDoctorStatusMap,
    };
    setSelectedReservation(updated);
    await loadLogs(updated);
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
    if (!text) { alert("메모 내용을 입력하세요."); return; }

    try {
      const result = await addReservationNote({
        reservationId: selectedReservation.reservationId,
        reservationDocId: selectedReservation.id,
        patientId: selectedReservation.patientId || "",
        memoText: text,
        staff: currentUser,
      });

      if (!result.success) { alert(result.message || "메모 저장 실패"); return; }

      setMemoText("");
      await loadNotes(selectedReservation);
      await loadLogs(selectedReservation);
      await onRefreshLatestLog(selectedReservation);
      alert("메모 저장 완료");
    } catch {
      alert("메모 저장 중 오류가 발생했습니다.");
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
    if (!result.success) { alert(result.message || "메모 수정 실패"); return; }
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

  async function handleDeleteInvoice() {
    if (!selectedReservation) return;
    if (!selectedReservation.invoiceId) { alert("삭제할 인보이스가 없습니다."); return; }
    if (!confirm("연결된 인보이스를 삭제할까요?\n삭제 후 다시 생성할 수 있습니다.")) return;

    try {
      const invoiceDocId = selectedReservation.invoiceDocId || selectedReservation.invoiceId;

      await updateDoc(doc(db, "invoices", invoiceDocId), {
        status: "void",
        isDeleted: true,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.displayName,
        updatedByUid: currentUser.uid,
      });

      await updateDoc(doc(db, "reservations", selectedReservation.id), {
        invoiceId: "",
        invoiceDocId: "",
        invoiceStatus: "",
        invoiceUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.displayName,
        updatedByUid: currentUser.uid,
      });

      await createLog({
        action: "invoice_delete",
        targetType: "invoice",
        targetId: invoiceDocId,
        staff: currentUser,
        message: `${selectedReservation.name || "고객"} 인보이스를 삭제 처리했습니다.`,
        patientId: selectedReservation.patientId || "",
        reservationId: selectedReservation.reservationId || "",
        invoiceId: selectedReservation.invoiceId || invoiceDocId,
        before: {
          invoiceId: selectedReservation.invoiceId || "",
          invoiceDocId: selectedReservation.invoiceDocId || "",
          invoiceStatus: selectedReservation.invoiceStatus || "",
        },
        after: { invoiceId: "", invoiceDocId: "", invoiceStatus: "void", isDeleted: true },
      });

      const updated: ReservationRecord = { ...selectedReservation, invoiceId: "", invoiceDocId: "", invoiceStatus: "" };
      setSelectedReservation(updated);
      await loadLogs(updated);
      await onRefreshLatestLog(updated);
      alert("인보이스가 삭제 처리되었습니다.");
    } catch {
      alert("인보이스 삭제 중 오류가 발생했습니다.");
    }
  }

  if (!open || !selectedReservation) return null;

  return (
    <>
      <div className="fixed inset-0 z-[998] bg-black/35" onClick={onClose} />

      <div className="fixed right-0 top-0 z-[999] flex h-screen w-[420px] max-w-[calc(100vw-12px)] flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
        <div className="shrink-0 border-b border-[#edf0f3] px-5 py-4">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <div className="text-xl font-bold">{selectedReservation.name}</div>
              <div className="mt-0.5 text-sm text-gray-500">
                {getBirthGenderNationalityText(selectedReservation)}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-2xl leading-none text-gray-400 transition hover:scale-110 hover:text-gray-700 active:scale-95"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-6 gap-1.5">
            {DETAIL_STATUS_LIST.map((status) => {
              const active = selectedStatus === status;
              const label = status === "대기" ? "내원" : status;
              const color = getStatusColor(status, statusColors);
              const textColor = getReadableTextColor(color);
              return (
                <button
                  key={status}
                  onClick={() => handleStatusChange(status)}
                  className="min-w-0 rounded-lg border px-1.5 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
                  style={{
                    borderColor: color,
                    backgroundColor: active ? color : "#ffffff",
                    color: active ? textColor : color,
                  }}
                >
                  {label}
                </button>
              );
            })}

            <button
              onClick={handleSurgeryToggle}
              className={`min-w-0 rounded-lg border px-1.5 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
                selectedReservation.surgeryReserved
                  ? "border-purple-600 bg-purple-600 text-white"
                  : "border-purple-400 bg-white text-purple-700"
              }`}
            >
              예약
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
              detailDoctors={detailDoctors}
              doctors={doctors}
              detailError={detailError}
              detailMessage={detailMessage}
              detailSaving={detailSaving}
              memoText={memoText}
              recentNotes={recentNotes}
              onFormChange={(updates) => setDetailForm((p) => ({ ...p, ...updates }))}
              onToggleDoctor={toggleDetailDoctor}
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
              onMemoTextChange={setMemoText}
              onAddMemo={handleAddMemo}
              onUpdateNote={handleUpdateNote}
              onDeleteNote={handleDeleteNote}
            />
          )}

          {activeTab === "logs" && (
            <LogsTab logs={logs} loading={logsLoading} error={logsError} />
          )}

          {activeTab === "invoice" && (
            <InvoiceTab
              reservationDocId={selectedReservation.id}
              invoiceId={selectedReservation.invoiceId || ""}
              onDelete={handleDeleteInvoice}
            />
          )}
        </div>
      </div>
    </>
  );
}
