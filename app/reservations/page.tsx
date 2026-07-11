"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DetailDrawer } from "@/components/timeline/DetailDrawer";
import {
  deleteReservation,
  deletePatient,
  updatePatientProfile,
  fetchReservationsForExport,
  updateReservationFull,
  getPatientFullHistoryPage,
  getPatientFullHistoryCached,
  invalidatePatientFullHistoryCache,
  searchPatients,
  listPatientsSummary,
  type ReservationRecord,
  type AppointmentType,
  type PatientRecord,
} from "@/lib/reservations";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePatientSummary } from "@/components/PatientSummaryProvider";
import { getCardStatus } from "@/lib/timelineUtils";
import { getReservationBirthInfo } from "@/lib/reservationUtils";
import { todayString } from "@/lib/dateUtils";
import { buildCsvContent } from "@/lib/csv";
import { CreateDrawer } from "@/components/reservations/CreateDrawer";
import { ImportDrawer } from "@/components/reservations/ImportDrawer";
import { MemoPopover, type MemoPopoverState } from "@/components/reservations/MemoPopover";
import { ReservationsTable, type PatientGroup, type PatientEditForm } from "@/components/reservations/ReservationsTable";
import { getReservationNotes, addReservationNote, updateReservationNote, deleteReservationNote, type ReservationNote } from "@/lib/reservationNotes";
import { toDate } from "@/lib/settingsUtils";

export default function ReservationsPage() {
  const { currentUser, authReady } = useCurrentUser();
  const uid = currentUser?.uid;
  const {
    patients: summaryPatients,
    nextCursor: summaryNextCursor,
    loading: summaryLoading,
    refreshing: summaryRefreshing,
    error: summaryError,
    start: startPatientSummary,
    refresh: refreshPatientSummary,
  } = usePatientSummary();

  const [initialLoading, setInitialLoading] = useState(
    () => summaryLoading && summaryPatients.length === 0
  );
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const searchSeqRef = useRef(0);
  const extraPatientsRef = useRef<PatientRecord[]>([]);

  const [search, setSearch] = useState("");
  const [groupPage, setGroupPage] = useState(1);
  const PAGE_SIZE = 10;
  const [patients, setPatients] = useState<PatientRecord[]>(() => summaryPatients);
  const [patientsNextCursor, setPatientsNextCursor] = useState<string | null>(
    () => summaryNextCursor
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);

  const [addPatient, setAddPatient] = useState<{ name: string; birthInput: string; phone: string; nationality: string; patientId: string } | undefined>();

  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineForm, setInlineForm] = useState<{
    name: string; birthInput: string; phone: string; nationality: string;
    consultArea: string; reservationDate: string; reservationTime: string;
    coordinators: string; hospital: string;
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

  // 환자 전체 이력 (라이브 윈도우와 무관, 온디맨드 + 세션 캐시 — lib/reservations.ts 공유 캐시)
  const [historyPatientId, setHistoryPatientId] = useState<string | null>(null);
  const [historyPatientName, setHistoryPatientName] = useState("");
  const [historyList, setHistoryList] = useState<ReservationRecord[]>([]);
  const [historyCapped, setHistoryCapped] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyEditTarget, setHistoryEditTarget] = useState<ReservationRecord | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyCursors, setHistoryCursors] = useState<(string | null)[]>([null]);
  const [historyHasNext, setHistoryHasNext] = useState(false);
  const historySeqRef = useRef(0);
  const HISTORY_PAGE_SIZE = 10;

  async function handleHistoryDelete(r: ReservationRecord) {
    if (!currentUser) return;
    if (!confirm(`${r.reservationDate} 예약을 삭제할까요?`)) return;
    const result = await deleteReservation(r.id, r.reservationId, currentUser);
    if (result.success) {
      setHistoryList((prev) => prev.filter((x) => x.id !== r.id));
      if (historyPatientId) {
        invalidatePatientFullHistoryCache(historyPatientId);
      }
    } else {
      alert(result.message || "삭제 실패");
    }
  }

  async function openPatientHistory(patientId: string, name: string, page = 1, cursors: (string | null)[] = [null]) {
    const seq = ++historySeqRef.current;
    setHistoryPatientId(patientId);
    setHistoryPatientName(name);
    setHistoryError("");
    setHistoryPage(page);

    setHistoryList([]);
    setHistoryCapped(false);
    setHistoryHasNext(false);
    setHistoryLoading(true);
    try {
      const result = await getPatientFullHistoryPage(patientId, {
        cursor: cursors[page - 1] || null,
        limit: HISTORY_PAGE_SIZE,
      });
      if (seq !== historySeqRef.current) return;
      setHistoryList(result.reservations);
      setHistoryCapped(result.capped);
      setHistoryHasNext(result.hasMore);
      setHistoryCursors((prev) => {
        const next = page === 1 ? [null] : [...prev];
        if (result.nextCursor) next[page] = result.nextCursor;
        return next;
      });
    } catch (e) {
      if (seq !== historySeqRef.current) return;
      setHistoryError(e instanceof Error ? e.message : "이력 조회 중 오류가 발생했습니다.");
    } finally {
      if (seq === historySeqRef.current) setHistoryLoading(false);
    }
  }

  function goHistoryPage(nextPage: number) {
    if (!historyPatientId || nextPage < 1) return;
    void openPatientHistory(historyPatientId, historyPatientName, nextPage, historyCursors);
  }

  const isSearchMode = useMemo(() => {
    const term = search.trim();
    if (!term) return false;
    const digitsOnly = /^[0-9]+$/.test(term);
    return digitsOnly ? term.length >= 4 : term.length >= 2;
  }, [search]);

  // 기본 목록은 Provider 값을 직접 사용한다. 페이지 로컬 patients는 검색 결과와
  // 더보기 갱신 트리거에만 사용해 mount 직후 빈 배열/로딩 화면을 거치지 않는다.
  const visiblePatients = useMemo(() => {
    if (isSearchMode) return patients;

    const byId = new Map<string, PatientRecord>();
    for (const patient of summaryPatients) byId.set(patient.patientId, patient);
    for (const patient of extraPatientsRef.current) {
      if (!byId.has(patient.patientId)) byId.set(patient.patientId, patient);
    }
    return [...byId.values()];
  }, [isSearchMode, patients, summaryPatients]);

  const patientGroups = useMemo<PatientGroup[]>(() => {
    // patients 요약을 단일 소스로 그룹 구성(예약 구독 없음 — 상세는 클릭 시 lazy-load).
    // NOTE: 검색 시에는 서버 검색 결과를, 기본 목록에서는 Provider 데이터를 직접 사용한다.
    const groups: PatientGroup[] = [];
    for (const p of visiblePatients) {
      if (!p.patientId) continue;
      groups.push({
        patientKey: p.patientId,
        patientId: p.patientId,
        name: p.name,
        birth: p.birth || "",
        birthInput: p.birthInput || p.birth || "",
        gender: p.gender || "",
        phone: p.phone || "",
        nationality: p.nationality || "",
        reservations: [],
        reservationCount: p.reservationCount,
        reservationCountCapped: p.reservationCountCapped,
        settlementCount: p.settlementCount,
        netSettlementAmount: p.netSettlementAmount,
        invoiceCount: p.invoiceCount,
        memoCount: p.memoCount,
        lastReservationDate: p.lastReservationDate || "",
      });
    }
    return groups.sort((a, b) =>
      (b.lastReservationDate || "").localeCompare(a.lastReservationDate || "")
    );
  }, [visiblePatients]);

  const tableLoading = isSearchMode
    ? initialLoading
    : summaryLoading && visiblePatients.length === 0;
  const tableRefreshing = isSearchMode ? refreshing : summaryRefreshing;
  const tableError = isSearchMode ? listError : summaryError;

  useEffect(() => { setGroupPage(1); }, [search]);

  // 기본 목록의 cursor/추가 페이지 상태만 동기화한다. 화면 데이터 자체는 Provider를 직접 표시한다.
  useEffect(() => {
    if (isSearchMode) return;

    const baseIds = new Set(summaryPatients.map((patient) => patient.patientId));
    extraPatientsRef.current = extraPatientsRef.current.filter(
      (patient) => !baseIds.has(patient.patientId)
    );
    if (extraPatientsRef.current.length === 0) {
      setPatientsNextCursor(summaryNextCursor);
    }
  }, [isSearchMode, summaryPatients, summaryNextCursor]);

  const reloadPatients = useCallback(({ force = false }: { force?: boolean } = {}) => {
    if (!uid) return;
    if (force) {
      void refreshPatientSummary();
      return;
    }
    startPatientSummary();
  }, [uid, refreshPatientSummary, startPatientSummary]);

  const reloadCurrent = useCallback(() => {
    const term = search.trim();
    const digitsOnly = term.length > 0 && /^[0-9]+$/.test(term);
    const longEnough = digitsOnly ? term.length >= 4 : term.length >= 2;

    if (term && longEnough) {
      if (patients.length > 0) setRefreshing(true); else setInitialLoading(true);
      setListError(null);
      searchPatients(term)
        .then((list) => {
          setPatientsNextCursor(null);
          setPatients(list);
          setListError(null);
        })
        .catch((e) => { setListError(e instanceof Error ? e.message : "데이터를 불러오지 못했습니다."); })
        .finally(() => { setInitialLoading(false); setRefreshing(false); });
      return;
    }

    extraPatientsRef.current = [];
    setPatients(summaryPatients);
    setPatientsNextCursor(summaryNextCursor);
    void refreshPatientSummary();
  }, [search, patients.length, summaryPatients, summaryNextCursor, refreshPatientSummary]);

  // 서버 커서로 다음 페이지를 이어붙인다("더보기") — 검색 중에는 사용하지 않음.
  const loadMorePatients = useCallback(async () => {
    if (!patientsNextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await listPatientsSummary(30, patientsNextCursor);
      const byId = new Map<string, PatientRecord>();
      for (const patient of extraPatientsRef.current) byId.set(patient.patientId, patient);
      for (const patient of r.patients) byId.set(patient.patientId, patient);
      const baseIds = new Set(summaryPatients.map((patient) => patient.patientId));
      extraPatientsRef.current = [...byId.values()].filter(
        (patient) => !baseIds.has(patient.patientId)
      );
      // visiblePatients가 재계산되도록 로컬 state도 같은 병합 결과로 갱신한다.
      setPatients([...summaryPatients, ...extraPatientsRef.current]);
      setPatientsNextCursor(r.nextCursor);
    } catch {
      /* 무시 — 다음 클릭 시 재시도 */
    } finally {
      setLoadingMore(false);
    }
  }, [patientsNextCursor, loadingMore, summaryPatients]);

  useEffect(() => {
    if (!authReady || !uid) return;
    const term = search.trim();
    const digitsOnly = term.length > 0 && /^[0-9]+$/.test(term);
    const longEnough = digitsOnly ? term.length >= 4 : term.length >= 2;
    if (!term || !longEnough) {
      searchSeqRef.current += 1;
      reloadPatients();
      return;
    }
    const seq = ++searchSeqRef.current;
    const handle = setTimeout(() => {
      if (patients.length > 0) setRefreshing(true); else setInitialLoading(true);
      setPatientsNextCursor(null);
      setListError(null);
      searchPatients(term)
        .then((list) => { if (searchSeqRef.current === seq) { setPatients(list); setListError(null); } })
        .catch((e) => { if (searchSeqRef.current === seq) { setListError(e instanceof Error ? e.message : "검색에 실패했습니다."); } })
        .finally(() => { if (searchSeqRef.current === seq) { setInitialLoading(false); setRefreshing(false); } });
    }, 300);
    return () => clearTimeout(handle);
  }, [authReady, uid, search, reloadPatients, patients.length]);

  const pagedGroups = useMemo(() => {
    const start = (groupPage - 1) * PAGE_SIZE;
    return patientGroups.slice(start, start + PAGE_SIZE);
  }, [patientGroups, groupPage, PAGE_SIZE]);

  const totalPages = Math.max(1, Math.ceil(patientGroups.length / PAGE_SIZE));

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
    const notes = await getReservationNotes(memoPopover.item.reservationId, memoPopover.item.id, memoPopover.item.patientId);
    setMemoPopover((prev) => prev ? { ...prev, notes } : prev);
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
    const notes = await getReservationNotes(memoPopover.item.reservationId, memoPopover.item.id, memoPopover.item.patientId);
    setMemoPopover((prev) => prev ? { ...prev, notes } : prev);
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
    const notes = await getReservationNotes(item.reservationId, item.id, item.patientId);
    setMemoPopover((prev) => prev ? { ...prev, notes } : prev);
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
      // 서버에서 지정 기간 전체를 정확히 읽고, 메모는 배치로 묶어서 받는다(누락/과금 방지).
      const { reservations: rows, notesByDoc, capped } = await fetchReservationsForExport(dlStart, dlEnd, true);

      const header = [
        "예약일", "예약시간", "환자명", "생년월일", "성별", "연락처",
        "병원명", "예약유형", "상담부위", "담당자", "수술결정여부",
        "현재상태", "전체메모", "등록일", "최종수정일",
      ];

      const csvRows = rows.map((r) => {
        const birthInfo = getReservationBirthInfo(r);
        const notes = notesByDoc[r.id] || [];
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
          getCardStatus(r),
          allMemo,
          toDateStr(r.createdAt),
          toDateStr(r.updatedAt),
        ];
      });

      // formula injection 방어 + 안전한 quoting/BOM은 공통 유틸에서 처리.
      const csv = buildCsvContent([header, ...csvRows]);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `예약목록_${dlStart}_${dlEnd}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloadOpen(false);
      if (capped) setPageError("내보낼 데이터가 많아 최대치(5000건)까지만 포함되었습니다.");
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "CSV 내보내기 중 오류가 발생했습니다.");
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

  async function handleDelete(item: ReservationRecord) {
    if (!currentUser) return;

    const ok = confirm(`${item.name} 님 예약을 삭제 처리할까요?`);
    if (!ok) return;

    const result = await deleteReservation(item.id, item.reservationId, currentUser);

    if (!result.success) {
      setPageError(result.message || "예약 삭제 권한이 없습니다.");
      return;
    }
    invalidatePatientFullHistoryCache(item.patientId);
    reloadCurrent();
  }
  function handleAddReservation(group: PatientGroup) {
    setAddPatient({
      name: group.name,
      birthInput: group.birthInput || group.birth || "",
      phone: group.phone || "",
      nationality: group.nationality || "",
      patientId: group.patientId,
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
            placeholder="한글 이름 / 영문 성·이름 검색"
            className="h-10 min-w-0 flex-1 rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm outline-none focus:border-[#1d9e75]"
          />
        </div>

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
                  선택한 기간의 예약을 서버에서 조회해 내보냅니다.
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

      <div className="px-5 pb-3 flex items-center gap-2 text-sm text-gray-500">
        <span>환자 {patientGroups.length}명</span>
        {tableRefreshing && (
          <span className="text-xs text-gray-400">새로고침 중...</span>
        )}
      </div>

      {/* 환자 전체 이력 모달 */}
      {historyPatientId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setHistoryPatientId(null)}>
          <div className="mx-4 w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-base font-bold text-gray-800">{historyPatientName} — 전체 예약 이력</span>
              <button onClick={() => setHistoryPatientId(null)} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
            </div>
            {historyError && <div className="mb-2 text-sm text-red-500">{historyError}</div>}
            {historyCapped && (
              <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                이력이 300건을 초과하여 최신 300건만 표시됩니다. 더 보시려면 지원팀에 문의해주세요.
              </div>
            )}
            {historyLoading && historyList.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">로딩 중...</div>
            ) : historyList.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">예약 이력이 없습니다.</div>
            ) : (
              <>
                <div className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-100">
                  {historyList.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                      <span className="w-20 shrink-0 text-xs text-gray-400">{r.reservationDate}</span>
                      {r.reservationTime && <span className="shrink-0 text-xs text-gray-400">{r.reservationTime}</span>}
                      <span className="shrink-0 text-gray-700">{r.appointmentType}</span>
                      {r.consultArea && <span className="shrink-0 text-xs text-gray-500">{r.consultArea}</span>}
                      <span className="shrink-0 text-xs text-gray-400">{r.hospital}</span>
                      <span className="shrink-0 text-xs text-gray-400">
                        {getCardStatus(r)}
                      </span>
                      <div className="ml-auto flex shrink-0 gap-1.5">
                        <button
                          onClick={() => setHistoryEditTarget(r)}
                          className="rounded border border-blue-200 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
                        >수정</button>
                        <button
                          onClick={() => handleHistoryDelete(r)}
                          className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
                        >삭제</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-center gap-3 text-sm">
                  <button
                    onClick={() => goHistoryPage(historyPage - 1)}
                    disabled={historyPage <= 1 || historyLoading}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-500 disabled:opacity-40"
                  >
                    ← 이전
                  </button>
                  <span className="text-xs text-gray-500">{historyPage}</span>
                  <button
                    onClick={() => goHistoryPage(historyPage + 1)}
                    disabled={!historyHasNext || historyLoading}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 disabled:opacity-40"
                  >
                    다음 →
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {currentUser && (
        <DetailDrawer
          open={!!historyEditTarget}
          reservation={historyEditTarget}
          currentUser={currentUser}
          onClose={() => setHistoryEditTarget(null)}
          onRefreshLatestLog={async () => {}}
          onRefresh={() => {
            if (historyPatientId) {
              invalidatePatientFullHistoryCache(historyPatientId);
              openPatientHistory(historyPatientId, historyPatientName, historyPage, historyCursors);
              reloadCurrent(); // 이력 편집 후 summary 배지 갱신
            }
          }}
        />
      )}

      <ReservationsTable
        patientGroups={pagedGroups}
        loading={tableLoading}
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
        onPatientMutated={(patientId) => { invalidatePatientFullHistoryCache(patientId); reloadCurrent(); }}
        listError={tableError}
        onRetry={reloadCurrent}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-4 text-sm">
          <button
            onClick={() => setGroupPage((p) => Math.max(1, p - 1))}
            disabled={groupPage === 1}
            className="rounded-xl border border-[#dfe3e8] bg-white px-4 py-2 text-gray-600 transition hover:bg-gray-50 disabled:opacity-30"
          >← 이전</button>
          <span className="text-gray-400">{groupPage} / {totalPages}</span>
          <button
            onClick={() => setGroupPage((p) => Math.min(totalPages, p + 1))}
            disabled={groupPage === totalPages}
            className="rounded-xl border border-[#dfe3e8] bg-white px-4 py-2 text-gray-600 transition hover:bg-gray-50 disabled:opacity-30"
          >다음 →</button>
        </div>
      )}

      {!search.trim() && patientsNextCursor && (
        <div className="flex justify-center pb-4">
          <button
            onClick={loadMorePatients}
            disabled={loadingMore}
            className="rounded-xl border border-[#dfe3e8] bg-white px-5 py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingMore ? "불러오는 중..." : "더보기"}
          </button>
        </div>
      )}

      {currentUser && (
        <CreateDrawer
          open={drawerOpen}
          onClose={() => { setDrawerOpen(false); setAddPatient(undefined); }}
          currentUser={currentUser}
          initialDate={undefined}
          initialPatient={addPatient}
          mode={addPatient ? "reservation" : "register"}
          onCreated={addPatient
            ? () => { invalidatePatientFullHistoryCache(addPatient.patientId); reloadCurrent(); }
            : () => { reloadCurrent(); }
          }
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
