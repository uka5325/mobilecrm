"use client";

import { useMemo, useState } from "react";
import {
  deleteReservation,
  updateReservationFull,
  searchReservationsByDateRange,
  getPatientReservationHistory,
  type ReservationRecord,
  type AppointmentType,
} from "@/lib/reservations";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useReservationData } from "@/hooks/useReservationData";
import { getReservationBirthInfo } from "@/lib/reservationUtils";
import { todayString } from "@/lib/dateUtils";
import { CreateDrawer } from "@/components/reservations/CreateDrawer";
import { ImportDrawer } from "@/components/reservations/ImportDrawer";
import { MemoPopover, type MemoPopoverState } from "@/components/reservations/MemoPopover";
import { ReservationsTable, type PatientGroup, type PatientEditForm } from "@/components/reservations/ReservationsTable";
import { getReservationNotes, addReservationNote, updateReservationNote, deleteReservationNote, type ReservationNote } from "@/lib/reservationNotes";
import { toDate } from "@/lib/settingsUtils";


export default function ReservationsPage() {
  const { currentUser, authReady } = useCurrentUser();
  const { reservations, loading, refresh } = useReservationData(
    currentUser,
    authReady
  );

  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);

  const [addPatient, setAddPatient] = useState<{ name: string; birthInput: string; phone: string; nationality: string; patientId: string; hospital?: string; consultArea?: string; appointmentType?: import("@/lib/reservations").AppointmentType; coordinators?: string; doctors?: string; depositAmount?: string; surgeryCost?: string } | undefined>();

  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineForm, setInlineForm] = useState<{
    name: string; birthInput: string; phone: string; nationality: string;
    consultArea: string; reservationDate: string; reservationTime: string;
    coordinators: string; depositAmount: string; surgeryCost: string; hospital: string;
    doctors: string;
    appointmentType: AppointmentType;
  } | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);

  const [patientEditId, setPatientEditId] = useState<string | null>(null);
  const [patientEditForm, setPatientEditForm] = useState<PatientEditForm | null>(null);
  const [patientEditSaving, setPatientEditSaving] = useState(false);

  const [memoPopover, setMemoPopover] = useState<MemoPopoverState>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");

  const [downloadOpen, setDownloadOpen] = useState(false);
  const [dlStart, setDlStart] = useState(() => todayString().slice(0, 7) + "-01");
  const [dlEnd, setDlEnd] = useState(todayString);
  const [downloading, setDownloading] = useState(false);
  const [pageError, setPageError] = useState("");

  // 기간 검색
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [rangeResults, setRangeResults] = useState<ReservationRecord[] | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState("");

  // 환자 전체 이력
  const [historyPatientId, setHistoryPatientId] = useState<string | null>(null);
  const [historyPatientName, setHistoryPatientName] = useState("");
  const [historyList, setHistoryList] = useState<ReservationRecord[]>([]);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  async function handleRangeSearch() {
    if (!rangeFrom || !rangeTo) { setRangeError("시작일과 종료일을 모두 입력하세요."); return; }
    if (rangeFrom > rangeTo) { setRangeError("시작일이 종료일보다 늦을 수 없습니다."); return; }
    setRangeLoading(true);
    setRangeError("");
    try {
      const results = await searchReservationsByDateRange(rangeFrom, rangeTo);
      setRangeResults(results);
    } catch (e) {
      setRangeError(e instanceof Error ? e.message : "검색 중 오류가 발생했습니다.");
    } finally {
      setRangeLoading(false);
    }
  }

  async function openPatientHistory(patientId: string, name: string) {
    setHistoryPatientId(patientId);
    setHistoryPatientName(name);
    setHistoryList([]);
    setHistoryNextCursor(null);
    setHistoryHasMore(false);
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const result = await getPatientReservationHistory(patientId);
      setHistoryList(result.reservations);
      setHistoryNextCursor(result.nextCursor);
      setHistoryHasMore(result.hasMore);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "이력 조회 중 오류가 발생했습니다.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadMoreHistory() {
    if (!historyPatientId || !historyNextCursor) return;
    setHistoryLoading(true);
    try {
      const result = await getPatientReservationHistory(historyPatientId, historyNextCursor);
      setHistoryList((prev) => [...prev, ...result.reservations]);
      setHistoryNextCursor(result.nextCursor);
      setHistoryHasMore(result.hasMore);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "추가 로드 중 오류가 발생했습니다.");
    } finally {
      setHistoryLoading(false);
    }
  }

  const filteredReservations = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return reservations.filter((item) => {
      if (filterDate && item.reservationDate !== filterDate) return false;

      if (!keyword) return true;

      const birthInfo = getReservationBirthInfo(item);

      const target = [
        item.name,
        birthInfo.birthDisplay,
        birthInfo.ageText,
        birthInfo.gender,
        item.phone,
        item.nationality,
        item.consultArea,
        item.hospital,
        item.appointmentType,
        item.reservationDate,
        item.reservationTime,
        item.operationStatus,
        item.depositAmount,
        item.surgeryCost,
        item.coordinators.join(", "),
      ]
        .join(" ")
        .toLowerCase();

      return target.includes(keyword);
    });
  }, [reservations, search, filterDate]);


  const patientGroups = useMemo<PatientGroup[]>(() => {
    const map = new Map<string, PatientGroup>();
    for (const r of filteredReservations) {
      const key = r.patientId || `${r.name}_${r.birth}`;
      if (!map.has(key)) {
        map.set(key, {
          patientKey: key,
          patientId: r.patientId || key,
          name: r.name,
          birth: r.birth,
          birthInput: r.birthInput || r.birth || "",
          gender: r.gender,
          phone: r.phone,
          nationality: r.nationality,
          reservations: [],
        });
      }
      map.get(key)!.reservations.push(r);
    }
    for (const g of map.values()) {
      g.reservations.sort((a, b) =>
        (a.reservationDate + a.reservationTime).localeCompare(
          b.reservationDate + b.reservationTime
        )
      );
    }
    return [...map.values()].sort((a, b) => {
      const latestA = a.reservations[a.reservations.length - 1]?.reservationDate || "";
      const latestB = b.reservations[b.reservations.length - 1]?.reservationDate || "";
      return latestB.localeCompare(latestA);
    });
  }, [filteredReservations]);

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
      depositAmount: item.depositAmount || "",
      surgeryCost: item.surgeryCost || "",
      hospital: item.hospital || "",
      doctors: (item.doctors || []).join(", "),
      appointmentType: item.appointmentType || "상담",
    });
  }

  async function saveInlineEdit(item: ReservationRecord) {
    if (!inlineForm || !currentUser) return;
    setInlineSaving(true);
    try {
      await updateReservationFull(
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
          depositAmount: inlineForm.depositAmount,
          surgeryCost: inlineForm.surgeryCost,
          currentDoctorStatusMap: item.doctorStatusMap,
          currentDoctorStatusMetaMap: item.doctorStatusMetaMap,
        },
        currentUser
      );
      setInlineEditId(null);
      setInlineForm(null);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPageError(`수정 오류: ${msg}`);
      console.error("[ReservationsPage] inline save error:", (err as Error)?.message ?? "");
    } finally {
      setInlineSaving(false);
    }
  }

  async function openMemoPopover(item: ReservationRecord) {
    setMemoPopover({ item, notes: [], loading: true });
    setEditingNoteId(null);
    try {
      const notes = await getReservationNotes(item.reservationId, item.id, item.patientId);
      setMemoPopover((prev) => (prev?.item.id === item.id ? { item, notes, loading: false } : prev));
    } catch {
      setMemoPopover((prev) => (prev?.item.id === item.id ? { item, notes: [], loading: false } : prev));
    }
  }

  async function handleMemoUpdate(note: ReservationNote) {
    if (!currentUser || !memoPopover) return;
    await updateReservationNote({
      noteId: note.id,
      reservationId: note.reservationId,
      patientId: note.patientId || memoPopover.item.patientId || "",
      memoText: editingNoteText,
      staff: currentUser,
    });
    setEditingNoteId(null);
    const notes = await getReservationNotes(memoPopover.item.reservationId, memoPopover.item.id, memoPopover.item.patientId);
    setMemoPopover((prev) => prev ? { ...prev, notes } : prev);
  }

  async function handleMemoDelete(note: ReservationNote) {
    if (!currentUser || !memoPopover) return;
    if (!confirm("메모를 삭제할까요?")) return;
    await deleteReservationNote({
      noteId: note.id,
      reservationId: note.reservationId,
      patientId: note.patientId || memoPopover.item.patientId || "",
      staff: currentUser,
    });
    const notes = await getReservationNotes(memoPopover.item.reservationId, memoPopover.item.id, memoPopover.item.patientId);
    setMemoPopover((prev) => prev ? { ...prev, notes } : prev);
  }

  async function handleMemoAdd(text: string) {
    if (!currentUser || !memoPopover) return;
    const item = memoPopover.item;
    await addReservationNote({
      reservationId: item.reservationId,
      reservationDocId: item.id,
      patientId: item.patientId || "",
      memoText: text,
      staff: currentUser,
    });
    const notes = await getReservationNotes(item.reservationId, item.id, item.patientId);
    setMemoPopover((prev) => prev ? { ...prev, notes } : prev);
  }

  function escapeCsv(value: string): string {
    const s = String(value ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toDateStr(value: unknown): string {
    const d = toDate(value);
    if (!d) return "";
    return (
      d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0") + " " +
      String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const inRange = reservations.filter((r) => {
        const d = r.reservationDate || "";
        return d >= dlStart && d <= dlEnd;
      });

      const notesPerReservation = await Promise.all(
        inRange.map((r) =>
          getReservationNotes(r.reservationId, r.id, r.patientId).catch(() => [] as ReservationNote[])
        )
      );

      const header = [
        "예약일", "예약시간", "환자명", "생년월일", "성별", "연락처",
        "병원명", "예약유형", "상담부위", "담당자", "수술결정여부",
        "예약금", "수술비용", "현재상태", "전체메모", "등록일", "최종수정일",
      ];

      const rows = inRange.map((r, i) => {
        const birthInfo = getReservationBirthInfo(r);
        const notes = notesPerReservation[i];
        const allMemo = notes.map((n) => `[${n.createdBy || ""}] ${n.memoText}`).join(" | ");

        return [
          r.reservationDate || "",
          r.reservationTime || "",
          r.name || "",
          birthInfo.birthDisplay || "",
          birthInfo.gender || "",
          r.phone || "",
          r.hospital || "",
          r.appointmentType || "상담",
          r.consultArea || "",
          r.coordinators.join(", "),
          r.surgeryReserved ? "예" : "아니오",
          r.depositAmount || "",
          r.surgeryCost || "",
          r.operationStatus || "",
          allMemo,
          toDateStr(r.createdAt),
          toDateStr(r.updatedAt),
        ].map(escapeCsv).join(",");
      });

      const bom = "﻿";
      const csv = bom + [header.map(escapeCsv).join(","), ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `예약목록_${dlStart}_${dlEnd}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloadOpen(false);
    } finally {
      setDownloading(false);
    }
  }

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

  async function savePatientEdit(group: PatientGroup) {
    if (!patientEditForm || !currentUser) return;
    setPatientEditSaving(true);
    try {
      for (const r of group.reservations) {
        await updateReservationFull(
          r.id,
          r.reservationId,
          r.patientId,
          {
            name: patientEditForm.name,
            birthInput: patientEditForm.birthInput,
            birth: patientEditForm.birthInput,
            phone: patientEditForm.phone,
            nationality: patientEditForm.nationality,
            gender: patientEditForm.gender,
            reservationDate: r.reservationDate,
            reservationTime: r.reservationTime,
            consultArea: r.consultArea,
            hospital: r.hospital,
            appointmentType: r.appointmentType,
            coordinators: r.coordinators,
            depositAmount: r.depositAmount,
            surgeryCost: r.surgeryCost,
            currentDoctorStatusMap: r.doctorStatusMap,
            currentDoctorStatusMetaMap: r.doctorStatusMetaMap,
          },
          currentUser
        );
      }
      setPatientEditId(null);
      setPatientEditForm(null);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPageError(`환자정보 수정 오류: ${msg}`);
    } finally {
      setPatientEditSaving(false);
    }
  }

  async function handleDeletePatient(group: PatientGroup) {
    if (!currentUser) return;
    const ok = confirm(`${group.name} 님의 예약 ${group.reservations.length}건을 모두 삭제할까요?`);
    if (!ok) return;

    for (const r of group.reservations) {
      const result = await deleteReservation(r.id, r.reservationId, currentUser);
      if (!result.success) {
        setPageError(result.message || "삭제 권한이 없습니다.");
        await refresh();
        return;
      }
    }
    await refresh();
  }

  async function openPatientMemoPopover(group: PatientGroup) {
    const rep = group.reservations[group.reservations.length - 1];
    await openMemoPopover(rep);
  }

  async function handleSaveAmount(reservationId: string, field: "depositAmount" | "surgeryCost", value: string) {
    if (!currentUser) return;
    const item = reservations.find((r) => r.id === reservationId);
    if (!item) return;
    await updateReservationFull(
      item.id,
      item.reservationId,
      item.patientId,
      {
        name: item.name,
        birthInput: item.birthInput || item.birth || "",
        birth: item.birthInput || item.birth || "",
        phone: item.phone,
        nationality: item.nationality,
        consultArea: item.consultArea,
        reservationDate: item.reservationDate,
        reservationTime: item.reservationTime,
        hospital: item.hospital,
        appointmentType: item.appointmentType,
        coordinators: item.coordinators,
        doctors: item.doctors || [],
        depositAmount: field === "depositAmount" ? value : item.depositAmount,
        surgeryCost: field === "surgeryCost" ? value : item.surgeryCost,
        currentDoctorStatusMap: item.doctorStatusMap,
        currentDoctorStatusMetaMap: item.doctorStatusMetaMap,
      },
      currentUser
    );
    await refresh();
  }

  async function handleDelete(item: ReservationRecord) {
    if (!currentUser) return;

    const ok = confirm(`${item.name} 님 예약을 삭제 처리할까요?`);
    if (!ok) return;

    const result = await deleteReservation(item.id, item.reservationId, currentUser);

    if (!result.success) {
      setPageError(result.message || "예약 삭제 권한이 없습니다.");
      return;
    }
    await refresh();
  }

  function handleAddReservation(item: ReservationRecord) {
    setAddPatient({
      name: item.name,
      birthInput: item.birthInput || item.birth || "",
      phone: item.phone || "",
      nationality: item.nationality || "",
      patientId: item.patientId,
      hospital: item.hospital || "",
      consultArea: item.consultArea || "",
      appointmentType: item.appointmentType,
      coordinators: (item.coordinators || []).join(", "),
      doctors: (item.doctors || []).join(", "),
      depositAmount: item.depositAmount || "",
      surgeryCost: item.surgeryCost || "",
    });
    setDrawerOpen(true);
  }

  return (
    <>
      <MemoPopover
        memoPopover={memoPopover}
        editingNoteId={editingNoteId}
        editingNoteText={editingNoteText}
        onClose={() => setMemoPopover(null)}
        onEditStart={(id, text) => { setEditingNoteId(id); setEditingNoteText(text); }}
        onEditCancel={() => setEditingNoteId(null)}
        onEditTextChange={setEditingNoteText}
        onUpdate={handleMemoUpdate}
        onDelete={handleMemoDelete}
        onAdd={handleMemoAdd}
      />

      {pageError && (
        <div className="mb-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600" onClick={() => setPageError("")}>
          {pageError} <span className="ml-2 cursor-pointer text-red-400">✕</span>
        </div>
      )}

      <div className="-mx-6 mb-4 rounded-t-2xl border border-[#edf0f3] bg-[#ecfdf5] px-4 py-4 lg:-mx-8 lg:px-8">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름, 상담부위, 원장 검색..."
            className="h-10 min-w-0 flex-1 rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm outline-none focus:border-[#1d9e75]"
          />

          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="h-10 w-[100px] shrink-0 appearance-none rounded-xl border border-[#dfe3e8] bg-white px-2 text-sm outline-none focus:border-[#1d9e75]"
          />

          <button
            onClick={() => setFilterDate("")}
            className="h-10 shrink-0 whitespace-nowrap rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm text-gray-700 transition hover:-translate-y-0.5 hover:bg-gray-50 active:scale-95"
          >
            날짜 초기화
          </button>
        </div>

        {/* 기간 검색 */}
        <div className="mt-2 flex items-center gap-2">
          <input
            type="date"
            value={rangeFrom}
            onChange={(e) => setRangeFrom(e.target.value)}
            className="h-10 w-[110px] shrink-0 appearance-none rounded-xl border border-[#dfe3e8] bg-white px-2 text-sm outline-none focus:border-[#1d9e75]"
          />
          <span className="shrink-0 text-xs text-gray-400">~</span>
          <input
            type="date"
            value={rangeTo}
            onChange={(e) => setRangeTo(e.target.value)}
            className="h-10 w-[110px] shrink-0 appearance-none rounded-xl border border-[#dfe3e8] bg-white px-2 text-sm outline-none focus:border-[#1d9e75]"
          />
          <button
            onClick={handleRangeSearch}
            disabled={rangeLoading}
            className="h-10 shrink-0 rounded-xl bg-[#1d9e75] px-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
          >
            {rangeLoading ? "검색 중..." : "기간 검색"}
          </button>
          {rangeResults !== null && (
            <button
              onClick={() => { setRangeResults(null); setRangeError(""); }}
              className="h-10 shrink-0 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm text-gray-600 transition hover:bg-gray-50 active:scale-95"
            >
              초기화
            </button>
          )}
        </div>
        {rangeError && <div className="mt-1 text-xs text-red-500">{rangeError}</div>}
        {rangeResults !== null && (
          <div className="mt-1 text-xs text-gray-500">
            기간 검색 결과: <span className="font-semibold text-emerald-700">{rangeResults.length}건</span>
            {" "}({rangeFrom} ~ {rangeTo})
          </div>
        )}

        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => { setAddPatient(undefined); setDrawerOpen(true); }}
            className="h-10 flex-1 whitespace-nowrap rounded-xl bg-black px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
          >
            + 고객 등록
          </button>
          <button
            onClick={() => setImportDrawerOpen(true)}
            className="h-10 flex-1 whitespace-nowrap rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm text-gray-700 transition hover:-translate-y-0.5 hover:bg-gray-50 active:scale-95"
          >
            🔗 외부 링크 가져오기
          </button>

          <div className="relative flex-1">
            <button
              onClick={() => setDownloadOpen((v) => !v)}
              className="h-10 w-full whitespace-nowrap rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm text-gray-700 transition hover:-translate-y-0.5 hover:bg-gray-50 active:scale-95"
            >
              📥 다운로드
            </button>

          {downloadOpen && (
            <>
              <div className="fixed inset-0 z-[9990]" onClick={() => setDownloadOpen(false)} />
              <div className="absolute right-0 top-full z-[9991] mt-2 w-[280px] rounded-2xl border border-[#edf0f3] bg-white p-4 shadow-xl">
                <div className="mb-3 text-sm font-bold text-gray-700">예약 데이터 다운로드</div>
                <div className="mb-2 text-xs text-gray-400">선택한 기간의 예약을 CSV로 내보냅니다.</div>
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-500">시작일</label>
                    <input
                      type="date"
                      value={dlStart}
                      onChange={(e) => setDlStart(e.target.value)}
                      className="w-full min-w-0 appearance-none rounded-xl border border-[#dfe3e8] px-2 py-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-500">종료일</label>
                    <input
                      type="date"
                      value={dlEnd}
                      onChange={(e) => setDlEnd(e.target.value)}
                      className="w-full min-w-0 appearance-none rounded-xl border border-[#dfe3e8] px-2 py-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                    />
                  </div>
                </div>
                <div className="mb-3 text-xs text-gray-400">
                  해당 기간 예약: {reservations.filter((r) => {
                    const d = r.reservationDate || "";
                    return d >= dlStart && d <= dlEnd;
                  }).length}건
                </div>
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="w-full rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {downloading ? "생성 중..." : "CSV 다운로드"}
                </button>
              </div>
            </>
          )}
          </div>
        </div>
      </div>

      <div className="px-5 pb-3 text-sm text-gray-500">
        전체 {reservations.length}건 / 표시 {filteredReservations.length}건
      </div>

      {/* 기간 검색 결과 */}
      {rangeResults !== null && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold text-emerald-800">기간 검색 결과 ({rangeFrom} ~ {rangeTo})</span>
            <button onClick={() => { setRangeResults(null); setRangeError(""); }} className="text-xs text-gray-400 hover:text-gray-700">✕ 닫기</button>
          </div>
          {rangeResults.length === 0 ? (
            <div className="py-4 text-center text-sm text-gray-400">해당 기간에 예약이 없습니다.</div>
          ) : (
            <div className="divide-y divide-emerald-100 rounded-xl bg-white overflow-hidden">
              {rangeResults.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-24 shrink-0 text-gray-400">{r.reservationDate}</span>
                  <span className="font-semibold text-gray-800">{r.name}</span>
                  <span className="text-gray-500">{r.hospital}</span>
                  <span className="text-gray-400">{r.appointmentType}</span>
                  <span className="ml-auto text-xs text-gray-400">{r.operationStatus}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 환자 전체 이력 모달 */}
      {historyPatientId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setHistoryPatientId(null)}>
          <div className="mx-4 w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-base font-bold text-gray-800">{historyPatientName} — 전체 예약 이력</span>
              <button onClick={() => setHistoryPatientId(null)} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
            </div>
            {historyError && <div className="mb-2 text-sm text-red-500">{historyError}</div>}
            {historyLoading && historyList.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">로딩 중...</div>
            ) : historyList.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">예약 이력이 없습니다.</div>
            ) : (
              <div className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-100">
                {historyList.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-24 shrink-0 text-gray-400">{r.reservationDate}</span>
                    <span className="text-gray-700">{r.hospital}</span>
                    <span className="text-gray-500">{r.appointmentType}</span>
                    <span className="ml-auto text-xs text-gray-400">{r.operationStatus}</span>
                  </div>
                ))}
              </div>
            )}
            {historyHasMore && (
              <button
                onClick={loadMoreHistory}
                disabled={historyLoading}
                className="mt-3 w-full rounded-xl border border-[#dfe3e8] py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
              >
                {historyLoading ? "로딩 중..." : "다음 페이지 →"}
              </button>
            )}
          </div>
        </div>
      )}

      <ReservationsTable
        patientGroups={patientGroups}
        loading={loading}
        inlineEditId={inlineEditId}
        inlineForm={inlineForm}
        inlineSaving={inlineSaving}
        onFormChange={setInlineForm}
        onStartEdit={startInlineEdit}
        onSaveEdit={saveInlineEdit}
        onCancelEdit={() => { setInlineEditId(null); setInlineForm(null); }}
        onDelete={handleDelete}
        onAddReservation={handleAddReservation}
        patientEditId={patientEditId}
        patientEditForm={patientEditForm}
        patientEditSaving={patientEditSaving}
        onPatientFormChange={setPatientEditForm}
        onStartPatientEdit={startPatientEdit}
        onSavePatientEdit={savePatientEdit}
        onCancelPatientEdit={() => { setPatientEditId(null); setPatientEditForm(null); }}
        onDeletePatient={handleDeletePatient}
        onOpenPatientMemo={openPatientMemoPopover}
        onOpenPatientHistory={openPatientHistory}
        onSaveAmount={handleSaveAmount}
      />

      {currentUser && (
        <CreateDrawer
          open={drawerOpen}
          onClose={() => { setDrawerOpen(false); setAddPatient(undefined); }}
          currentUser={currentUser}
          initialDate={filterDate || undefined}
          initialPatient={addPatient}
          onCreated={refresh}
        />
      )}

      {currentUser && (
        <ImportDrawer
          open={importDrawerOpen}
          onClose={() => setImportDrawerOpen(false)}
          currentUser={currentUser}
        />
      )}

    </>
  );
}
