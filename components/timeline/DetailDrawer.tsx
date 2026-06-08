"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  toggleSurgeryReserved,
  updateReservationFull,
  updateReservationStatus,
  type DoctorOption,
  type ReservationRecord,
  type ReservationStatus,
} from "@/lib/reservations";
import type { StaffUser } from "@/lib/auth";
import { parseBirthInfo } from "@/lib/reservationUtils";
import {
  createLog,
  getLogsByReservationId,
  type LogRecord,
} from "@/lib/logs";
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
import {
  formatLogDate,
  getBirthGenderNationalityText,
  getLogBadgeClass,
  splitComma,
} from "@/lib/timelineUtils";
import { getReadableTextColor, getStatusColor } from "@/lib/colorUtils";
import { EditField } from "@/components/timeline/EditField";
import { NoteCard } from "@/components/timeline/NoteCard";

const DETAIL_STATUS_LIST: ReservationStatus[] = [
  "대기",
  "원상중",
  "후상중",
  "귀가",
  "부도",
];

type DetailTab = "info" | "notes" | "logs" | "invoice";

type Props = {
  open: boolean;
  reservation: ReservationRecord | null;
  doctors: DoctorOption[];
  currentUser: StaffUser;
  statusColors: VisitStatusColorMap;
  onClose: () => void;
  onRefreshLatestLog: (item: ReservationRecord) => Promise<void>;
};

export function DetailDrawer({
  open,
  reservation,
  doctors,
  currentUser,
  statusColors,
  onClose,
  onRefreshLatestLog,
}: Props) {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<DetailTab>("info");
  const [selectedReservation, setSelectedReservation] =
    useState<ReservationRecord | null>(null);

  const [detailDoctors, setDetailDoctors] = useState<string[]>([]);
  const [detailError, setDetailError] = useState("");
  const [detailMessage, setDetailMessage] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);

  const [detailForm, setDetailForm] = useState({
    name: "",
    birthInput: "",
    phone: "",
    nationality: "",
    consultArea: "",
    reservationDate: todayString(),
    reservationTime: "",
    coordinators: "",
    depositAmount: "",
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
      coordinators: reservation.coordinators.join(", "),
      depositAmount: reservation.depositAmount || "",
    });

    loadLogs(reservation);
    loadNotes(reservation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reservation?.id]);

  const detailBirthPreview = useMemo(
    () => parseBirthInfo(detailForm.birthInput),
    [detailForm.birthInput]
  );

  const selectedStatus = selectedReservation?.operationStatus || "내원전";
  const recentNotes = notes.slice(0, 3);

  async function loadLogs(item: ReservationRecord) {
    setLogsLoading(true);
    setLogsError("");
    setLogs([]);
    try {
      const list = await getLogsByReservationId(item.reservationId, item.id);
      setLogs(list);
    } catch {
      setLogsError("로그를 불러오지 못했습니다.");
    } finally {
      setLogsLoading(false);
    }
  }

  async function loadNotes(item: ReservationRecord) {
    try {
      const list = await getReservationNotes(
        item.reservationId,
        item.id,
        item.patientId
      );
      setNotes(list);
    } catch {
      setNotes([]);
    }
  }

  function toggleDetailDoctor(name: string) {
    setDetailDoctors((prev) =>
      prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]
    );
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

      if (!result.success) {
        setDetailError(result.message || "예약 수정에 실패했습니다.");
        return;
      }

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

    const nextStatus =
      status === "대기" && selectedReservation.operationStatus === "대기"
        ? "내원전"
        : status;

    await updateReservationStatus(
      selectedReservation.id,
      selectedReservation.reservationId,
      nextStatus,
      currentUser
    );

    const updated: ReservationRecord = {
      ...selectedReservation,
      operationStatus: nextStatus,
    };

    setSelectedReservation(updated);
    await loadLogs(updated);
    await onRefreshLatestLog(updated);
  }

  async function handleSurgeryToggle() {
    if (!selectedReservation) return;

    const next = !selectedReservation.surgeryReserved;

    await toggleSurgeryReserved(
      selectedReservation.id,
      selectedReservation.reservationId,
      next,
      currentUser
    );

    const updated: ReservationRecord = {
      ...selectedReservation,
      surgeryReserved: next,
    };

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

  async function handleDeleteInvoiceFromDetail() {
    if (!selectedReservation) return;
    if (!selectedReservation.invoiceId) { alert("삭제할 인보이스가 없습니다."); return; }
    if (!confirm("연결된 인보이스를 삭제할까요?\n삭제 후 다시 생성할 수 있습니다.")) return;

    try {
      const invoiceDocId =
        (selectedReservation as any).invoiceDocId || selectedReservation.invoiceId;

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
          invoiceDocId: (selectedReservation as any).invoiceDocId || "",
          invoiceStatus: (selectedReservation as any).invoiceStatus || "",
        },
        after: { invoiceId: "", invoiceDocId: "", invoiceStatus: "void", isDeleted: true },
      });

      const updated = {
        ...selectedReservation,
        invoiceId: "",
        invoiceDocId: "",
        invoiceStatus: "",
      } as ReservationRecord;

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
        {/* Header */}
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

          {/* Status buttons */}
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

        {/* Tabs */}
        <div className="flex shrink-0 border-b border-[#edf0f3]">
          {[
            { key: "info", label: "기본정보" },
            { key: "notes", label: "메모" },
            { key: "logs", label: "로그" },
            { key: "invoice", label: "인보이스" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as DetailTab)}
              className={`flex-1 border-b-2 py-2.5 text-center text-sm transition hover:bg-gray-50 active:scale-[0.98] ${
                activeTab === tab.key
                  ? "border-[#1d9e75] font-semibold text-[#1d9e75]"
                  : "border-transparent text-gray-500"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Info tab */}
          {activeTab === "info" && (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <EditField
                  label="이름"
                  value={detailForm.name}
                  onChange={(value) => setDetailForm((p) => ({ ...p, name: value }))}
                />

                <div>
                  <label className="text-xs text-gray-500">생년월일</label>
                  <input
                    value={detailForm.birthInput}
                    onChange={(e) =>
                      setDetailForm((p) => ({ ...p, birthInput: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                    placeholder="891210-1 / 19891210-1"
                  />
                  {detailForm.birthInput && (
                    <div className="mt-1 text-xs text-gray-500">
                      {detailBirthPreview.birthDisplay}
                      {detailBirthPreview.ageText ? ` · ${detailBirthPreview.ageText}` : ""}
                      {detailBirthPreview.gender ? ` · ${detailBirthPreview.gender}` : ""}
                    </div>
                  )}
                </div>

                <EditField
                  label="연락처"
                  value={detailForm.phone}
                  onChange={(value) => setDetailForm((p) => ({ ...p, phone: value }))}
                />

                <EditField
                  label="국적"
                  value={detailForm.nationality}
                  onChange={(value) => setDetailForm((p) => ({ ...p, nationality: value }))}
                />
              </div>

              <div className="mt-3">
                <EditField
                  label="상담부위"
                  value={detailForm.consultArea}
                  onChange={(value) => setDetailForm((p) => ({ ...p, consultArea: value }))}
                />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs text-gray-500">예약날짜</label>
                  <input
                    type="date"
                    value={detailForm.reservationDate}
                    onChange={(e) =>
                      setDetailForm((p) => ({ ...p, reservationDate: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500">예약시간</label>
                  <input
                    type="time"
                    step={1800}
                    value={detailForm.reservationTime}
                    onChange={(e) =>
                      setDetailForm((p) => ({ ...p, reservationTime: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="text-xs text-gray-500">지정원장</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {doctors.map((doctor) => {
                    const on = detailDoctors.includes(doctor.displayName);
                    return (
                      <button
                        key={doctor.uid}
                        onClick={() => toggleDetailDoctor(doctor.displayName)}
                        className={`rounded-xl border px-3 py-2 text-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
                          on
                            ? "border-black bg-black text-white"
                            : "border-[#dfe3e8] bg-white text-gray-700"
                        }`}
                      >
                        {doctor.displayName}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <EditField
                  label="담당 실장"
                  value={detailForm.coordinators}
                  onChange={(value) => setDetailForm((p) => ({ ...p, coordinators: value }))}
                />
                <EditField
                  label="예약금"
                  value={detailForm.depositAmount}
                  onChange={(value) => setDetailForm((p) => ({ ...p, depositAmount: value }))}
                />
              </div>

              {detailError && (
                <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
                  {detailError}
                </div>
              )}
              {detailMessage && (
                <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {detailMessage}
                </div>
              )}

              <button
                onClick={handleSaveDetail}
                disabled={detailSaving}
                className="mt-4 w-full rounded-xl bg-black py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
              >
                {detailSaving ? "저장 중..." : "수정 저장"}
              </button>

              <div className="mt-5 border-t border-[#edf0f3] pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-semibold text-gray-500">최근 메모</label>
                  <button
                    onClick={() => setActiveTab("notes")}
                    className="text-xs text-emerald-600 transition hover:underline active:scale-95"
                  >
                    전체보기
                  </button>
                </div>

                <textarea
                  rows={2}
                  value={memoText}
                  onChange={(e) => setMemoText(e.target.value)}
                  className="w-full resize-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-emerald-500 focus:outline-none"
                  placeholder="기본정보에서 바로 메모 입력"
                />

                <button
                  onClick={handleAddMemo}
                  className="mt-2 w-full rounded-xl bg-emerald-600 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
                >
                  메모 추가
                </button>

                <div className="mt-3 space-y-2">
                  {recentNotes.length === 0 ? (
                    <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-400">
                      등록된 메모가 없습니다.
                    </div>
                  ) : (
                    recentNotes.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        compact
                        onUpdate={handleUpdateNote}
                        onDelete={handleDeleteNote}
                      />
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          {/* Notes tab */}
          {activeTab === "notes" && (
            <div>
              <textarea
                rows={3}
                value={memoText}
                onChange={(e) => setMemoText(e.target.value)}
                className="w-full resize-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-emerald-500 focus:outline-none"
                placeholder="메모를 입력하세요..."
              />
              <button
                onClick={handleAddMemo}
                className="mt-2 w-full rounded-xl bg-emerald-600 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
              >
                메모 추가
              </button>
              <div className="mt-4 space-y-3">
                {notes.length === 0 ? (
                  <div className="rounded-xl border border-[#edf0f3] bg-white p-4 text-sm text-gray-400">
                    등록된 메모가 없습니다.
                  </div>
                ) : (
                  notes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onUpdate={handleUpdateNote}
                      onDelete={handleDeleteNote}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          {/* Logs tab */}
          {activeTab === "logs" && (
            <div className="space-y-2">
              {logsLoading ? (
                <div className="rounded-xl border border-[#edf0f3] bg-white p-4 text-sm text-gray-400">
                  로그를 불러오는 중...
                </div>
              ) : logsError ? (
                <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-500">
                  {logsError}
                </div>
              ) : logs.length === 0 ? (
                <div className="rounded-xl border border-[#edf0f3] bg-white p-4 text-sm text-gray-400">
                  등록된 로그가 없습니다.
                </div>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl border border-[#edf0f3] bg-white p-3 text-sm"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold ${getLogBadgeClass(
                          String(log.action || "")
                        )}`}
                      >
                        {log.action || "LOG"}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {formatLogDate(log.createdAt)}
                      </span>
                    </div>
                    <div className="text-sm leading-6 text-gray-700">
                      {log.message || "로그 내용 없음"}
                    </div>
                    {log.staffName && (
                      <div className="mt-1 text-[11px] text-gray-400">
                        처리자: {log.staffName}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Invoice tab */}
          {activeTab === "invoice" && (
            <div className="space-y-3">
              <div className="rounded-2xl border-2 border-dashed border-[#dfe3e8] p-6 text-center">
                <div className="text-sm text-gray-400">
                  이 고객의 인보이스를 생성하거나 확인할 수 있습니다.
                </div>
                <button
                  onClick={() => router.push(`/invoices/${selectedReservation.id}`)}
                  className="mt-4 w-full rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
                >
                  {selectedReservation.invoiceId ? "인보이스 열기" : "인보이스 생성"}
                </button>
              </div>

              {selectedReservation.invoiceId && (
                <button
                  onClick={handleDeleteInvoiceFromDetail}
                  className="w-full rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-medium text-red-600 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
                >
                  인보이스 삭제
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
