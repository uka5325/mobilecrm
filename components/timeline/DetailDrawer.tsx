"use client";

import type { ReservationRecord } from "@/features/reservations/domain/reservationModels";
import type { StaffUser } from "@/lib/auth";
import { DetailDrawerHeader } from "@/components/timeline/DetailDrawerHeader";
import { DetailDrawerTabs } from "@/components/timeline/DetailDrawerTabs";
import { InfoTab } from "@/components/timeline/tabs/InfoTab";
import { FilesTab } from "@/components/timeline/tabs/FilesTab";
import { NotesTab } from "@/components/timeline/tabs/NotesTab";
import { LogsTab } from "@/components/timeline/tabs/LogsTab";
import { InvoiceTab } from "@/components/timeline/tabs/InvoiceTab";
import { SettlementPanel } from "@/components/settlements/SettlementPanel";
import { CreateDrawer } from "@/components/reservations/CreateDrawer";
import { useDetailDrawerController } from "@/hooks/useDetailDrawerController";

type Props = {
  open: boolean;
  reservation: ReservationRecord | null;
  currentUser: StaffUser;
  onClose: () => void;
  onRefreshLatestLog: (item: ReservationRecord) => Promise<void>;
  onRefresh?: () => void;
};

export function DetailDrawer({ open, reservation, currentUser, onClose, onRefreshLatestLog, onRefresh }: Props) {
  const d = useDetailDrawerController({ open, reservation, currentUser, onRefreshLatestLog, onRefresh });
  const { activeTab, selectedReservation } = d;

  if (!open || !selectedReservation) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[998] flex items-end justify-center bg-black/35 px-3 pb-3 pt-10 backdrop-blur-[2px] sm:items-center sm:p-6"
        onClick={onClose}
      >
        <div
          className="flex max-h-[calc(100vh-24px)] w-full max-w-[720px] flex-col overflow-hidden rounded-t-[30px] bg-[#f6f7f5] shadow-[0_28px_90px_rgba(15,23,42,0.26)] sm:max-h-[min(820px,calc(100vh-48px))] sm:rounded-[30px]"
          onClick={(e) => e.stopPropagation()}
        >
        <DetailDrawerHeader
          reservation={selectedReservation}
          completed={d.detailForm.completed}
          cancelled={d.detailForm.cancelled}
          onClose={onClose}
          onCompletedToggle={d.handleCompletedToggle}
          onCancelledToggle={d.handleCancelledToggle}
          onSurgeryToggle={d.handleSurgeryToggle}
          onAddReservation={() => d.setAddReservationOpen(true)}
        />

        <DetailDrawerTabs activeTab={activeTab} onTabChange={d.setActiveTab} />

        <div className="flex-1 overflow-y-auto px-4 pb-5 pt-4 sm:px-5">
          {activeTab === "info" && (
            <InfoTab
              detailForm={d.detailForm}
              birthPreview={d.detailBirthPreview}
              detailError={d.detailError}
              detailMessage={d.detailMessage}
              detailSaving={d.detailSaving}
              memoText={d.memoText}
              memoError={d.memoError}
              memoSuccess={d.memoSuccess}
              notesLoading={d.notesLoading}
              notesError={d.notesError}
              recentNotes={d.recentNotes}
              onFormChange={d.updateForm}
              onSave={d.handleSaveDetail}
              onMemoTextChange={d.setMemoText}
              onAddMemo={d.handleAddMemo}
              onUpdateNote={d.handleUpdateNote}
              onDeleteNote={d.handleDeleteNote}
              onShowAllNotes={() => d.setActiveTab("notes")}
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
              memoText={d.memoText}
              notes={d.notes}
              notesLoading={d.notesLoading}
              notesError={d.notesError}
              memoError={d.memoError}
              memoSuccess={d.memoSuccess}
              onMemoTextChange={d.setMemoText}
              onAddMemo={d.handleAddMemo}
              onUpdateNote={d.handleUpdateNote}
              onDeleteNote={d.handleDeleteNote}
            />
          )}

          {activeTab === "logs" && (
            <LogsTab
              logs={d.logs}
              loading={d.logsLoading}
              error={d.logsError}
              canLoadOlder={d.logsRecentOnly}
              onLoadOlder={d.loadOlderLogs}
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
      </div>

      <CreateDrawer
        open={d.addReservationOpen}
        onClose={() => d.setAddReservationOpen(false)}
        currentUser={currentUser}
        mode="reservation"
        initialDate={selectedReservation.reservationDate}
        initialPatient={d.addReservationPatient}
        onCreated={() => {
          d.setAddReservationOpen(false);
          onRefresh?.();
        }}
      />
    </>
  );
}
