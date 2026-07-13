"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DetailDrawer } from "@/components/timeline/DetailDrawer";
import {
  deleteReservation,
  invalidatePatientFullHistoryCache,
  searchPatients,
  listPatientsSummary,
  type ReservationRecord,
  type PatientRecord,
} from "@/lib/reservations";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePatientSummary } from "@/components/PatientSummaryProvider";
import { CreateDrawer } from "@/components/reservations/CreateDrawer";
import { ImportDrawer } from "@/components/reservations/ImportDrawer";
import { MemoPopover } from "@/components/reservations/MemoPopover";
import { ReservationsTable, type PatientGroup } from "@/components/reservations/ReservationsTable";
import { ReservationsToolbar } from "@/components/reservations/ReservationsToolbar";
import { PatientHistoryModal } from "@/components/reservations/PatientHistoryModal";
import { useReservationsCsvExport } from "@/hooks/useReservationsCsvExport";
import { useReservationMemoPopover } from "@/hooks/useReservationMemoPopover";
import { useReservationInlineEdit } from "@/hooks/useReservationInlineEdit";
import { usePatientProfileEdit } from "@/hooks/usePatientProfileEdit";
import { usePatientHistoryModal } from "@/hooks/usePatientHistoryModal";

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

  const [pageError, setPageError] = useState("");

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

  const csv = useReservationsCsvExport({ setPageError });
  const memo = useReservationMemoPopover({ currentUser, setPageError });
  const inline = useReservationInlineEdit({ currentUser, setPageError, reloadCurrent });
  const profile = usePatientProfileEdit({ currentUser, setPageError, reloadCurrent });
  const history = usePatientHistoryModal({ currentUser });

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
        memoPopover={memo.memoPopover}
        editingNoteId={memo.editingNoteId}
        editingNoteText={memo.editingNoteText}
        onClose={() => memo.setMemoPopover(null)}
        onEditStart={(id, text) => { memo.setEditingNoteId(id); memo.setEditingNoteText(text); }}
        onEditCancel={() => memo.setEditingNoteId(null)}
        onEditTextChange={memo.setEditingNoteText}
        onUpdate={memo.handleMemoUpdate}
        onDelete={memo.handleMemoDelete}
        onAdd={memo.handleMemoAdd}
      />

      {pageError && (
        <div className="mb-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600" onClick={() => setPageError("")}>
          {pageError} <span className="ml-2 cursor-pointer text-red-400">✕</span>
        </div>
      )}

      <ReservationsToolbar
        search={search}
        onSearchChange={setSearch}
        onAddCustomer={() => { setAddPatient(undefined); setDrawerOpen(true); }}
        onImport={() => setImportDrawerOpen(true)}
        downloadOpen={csv.downloadOpen}
        onToggleDownload={() => csv.setDownloadOpen((v) => !v)}
        onCloseDownload={() => csv.setDownloadOpen(false)}
        dlStart={csv.dlStart}
        dlEnd={csv.dlEnd}
        onDlStartChange={csv.setDlStart}
        onDlEndChange={csv.setDlEnd}
        downloading={csv.downloading}
        onDownload={csv.handleDownload}
      />

      <div className="px-5 pb-3 flex items-center gap-2 text-sm text-gray-500">
        <span>환자 {patientGroups.length}명</span>
        {tableRefreshing && (
          <span className="text-xs text-gray-400">새로고침 중...</span>
        )}
      </div>

      {/* 환자 전체 이력 모달 */}
      {history.historyPatientId && (
        <PatientHistoryModal
          patientName={history.historyPatientName}
          list={history.historyList}
          capped={history.historyCapped}
          loading={history.historyLoading}
          error={history.historyError}
          page={history.historyPage}
          hasNext={history.historyHasNext}
          onClose={history.closeHistory}
          onEdit={history.setHistoryEditTarget}
          onDelete={history.handleHistoryDelete}
          onPrevPage={() => history.goHistoryPage(history.historyPage - 1)}
          onNextPage={() => history.goHistoryPage(history.historyPage + 1)}
        />
      )}

      {currentUser && (
        <DetailDrawer
          open={!!history.historyEditTarget}
          reservation={history.historyEditTarget}
          currentUser={currentUser}
          onClose={() => history.setHistoryEditTarget(null)}
          onRefreshLatestLog={async () => {}}
          onRefresh={() => {
            if (history.historyPatientId) {
              history.refreshHistoryAfterEdit();
              reloadCurrent(); // 이력 편집 후 summary 배지 갱신
            }
          }}
        />
      )}

      <ReservationsTable
        patientGroups={pagedGroups}
        loading={tableLoading}
        inlineEditId={inline.inlineEditId}
        inlineForm={inline.inlineForm}
        inlineSaving={inline.inlineSaving}
        onFormChange={inline.setInlineForm}
        onStartEdit={inline.startInlineEdit}
        onSaveEdit={inline.saveInlineEdit}
        onCancelEdit={inline.cancelInlineEdit}
        onDelete={handleDelete}
        onAddReservation={handleAddReservation}
        patientEditId={profile.patientEditId}
        patientEditForm={profile.patientEditForm}
        patientEditSaving={profile.patientEditSaving}
        onPatientFormChange={profile.setPatientEditForm}
        onStartPatientEdit={profile.startPatientEdit}
        onSavePatientEdit={profile.savePatientEdit}
        onCancelPatientEdit={profile.cancelPatientEdit}
        onDeletePatient={profile.handleDeletePatient}
        onOpenPatientMemo={memo.openPatientMemoPopover}
        onOpenPatientHistory={history.openPatientHistory}
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
