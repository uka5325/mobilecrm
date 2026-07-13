"use client";

import { useState } from "react";
import { DetailDrawer } from "@/components/timeline/DetailDrawer";
import {
  deleteReservation,
  invalidatePatientFullHistoryCache,
  type ReservationRecord,
} from "@/lib/reservations";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { CreateDrawer } from "@/components/reservations/CreateDrawer";
import { ImportDrawer } from "@/components/reservations/ImportDrawer";
import { MemoPopover } from "@/components/reservations/MemoPopover";
import { ReservationsTable, type PatientGroup } from "@/components/reservations/ReservationsTable";
import { ReservationsToolbar } from "@/components/reservations/ReservationsToolbar";
import { PatientHistoryModal } from "@/components/reservations/PatientHistoryModal";
import { useReservationsList } from "@/hooks/useReservationsList";
import { useReservationsCsvExport } from "@/hooks/useReservationsCsvExport";
import { useReservationMemoPopover } from "@/hooks/useReservationMemoPopover";
import { useReservationInlineEdit } from "@/hooks/useReservationInlineEdit";
import { usePatientProfileEdit } from "@/hooks/usePatientProfileEdit";
import { usePatientHistoryModal } from "@/hooks/usePatientHistoryModal";

export default function ReservationsPage() {
  const { currentUser, authReady } = useCurrentUser();
  const uid = currentUser?.uid;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);
  const [addPatient, setAddPatient] = useState<{ name: string; birthInput: string; phone: string; nationality: string; patientId: string } | undefined>();
  const [pageError, setPageError] = useState("");

  const list = useReservationsList({ uid, authReady });
  const { search, patientGroups, pagedGroups, groupPage, totalPages, patientsNextCursor, loadingMore, reloadCurrent } = list;

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
        onSearchChange={list.setSearch}
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
        {list.tableRefreshing && (
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
        loading={list.tableLoading}
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
        listError={list.tableError}
        onRetry={reloadCurrent}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-4 text-sm">
          <button
            onClick={() => list.setGroupPage((p) => Math.max(1, p - 1))}
            disabled={groupPage === 1}
            className="rounded-xl border border-[#dfe3e8] bg-white px-4 py-2 text-gray-600 transition hover:bg-gray-50 disabled:opacity-30"
          >← 이전</button>
          <span className="text-gray-400">{groupPage} / {totalPages}</span>
          <button
            onClick={() => list.setGroupPage((p) => Math.min(totalPages, p + 1))}
            disabled={groupPage === totalPages}
            className="rounded-xl border border-[#dfe3e8] bg-white px-4 py-2 text-gray-600 transition hover:bg-gray-50 disabled:opacity-30"
          >다음 →</button>
        </div>
      )}

      {!search.trim() && patientsNextCursor && (
        <div className="flex justify-center pb-4">
          <button
            onClick={list.loadMorePatients}
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
