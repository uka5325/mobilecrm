"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReservationRecord } from "@/features/reservations/domain/reservationModels";
import { getCachedPatientFullHistory, getPatientFullHistoryCached } from "@/features/reservations/data/client";
import type { InvoiceRecord } from "@/features/invoices/data/client/invoices";
import {
  getInvoicesByPatientId,
  getInvoicesByPatientCache,
  invalidateInvoicesByPatientCache,
} from "@/features/invoices/data/client/invoices";
import { InvoiceEditorForm } from "@/components/invoices/InvoiceEditorForm";
import {
  PatientInvoiceCard,
  PatientInvoiceCreatePanel,
  PatientInvoiceDetailModal,
} from "./PatientInvoiceViews";

type Props = {
  patientId: string;
  patientName: string;
  onClose: () => void;
  onCountLoaded: (patientId: string, count: number) => void;
};

export function PatientInvoiceModal({ patientId, patientName, onClose, onCountLoaded }: Props) {
  const cachedInvoices = getInvoicesByPatientCache(patientId);
  const cachedHistory = getCachedPatientFullHistory(patientId);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(cachedInvoices ?? []);
  const [loading, setLoading] = useState(!cachedInvoices);
  const [reservations, setReservations] = useState<ReservationRecord[]>(cachedHistory?.reservations ?? []);
  const [reservationsLoaded, setReservationsLoaded] = useState(Boolean(cachedHistory));
  const [reservationsLoading, setReservationsLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRecord | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<InvoiceRecord | null>(null);
  const [error, setError] = useState("");
  const [showCreatePanel, setShowCreatePanel] = useState(false);

  const loadInvoices = useCallback(async () => {
    if (!getInvoicesByPatientCache(patientId)) setLoading(true);
    try {
      const data = await getInvoicesByPatientId(patientId);
      setInvoices(data);
      onCountLoaded(patientId, data.length);
    } finally {
      setLoading(false);
    }
  }, [patientId, onCountLoaded]);

  const loadReservations = useCallback(async () => {
    if (reservationsLoaded || reservationsLoading) return;
    if (!getCachedPatientFullHistory(patientId)) setReservationsLoading(true);
    try {
      const history = await getPatientFullHistoryCached(patientId);
      setReservations(history.reservations);
      setReservationsLoaded(true);
    } catch {
      setReservations([]);
      setReservationsLoaded(true);
    } finally {
      setReservationsLoading(false);
    }
  }, [patientId, reservationsLoaded, reservationsLoading]);

  useEffect(() => { void loadInvoices(); }, [loadInvoices]);

  async function handleDelete(invoice: InvoiceRecord) {
    if (!confirm("인보이스를 삭제할까요?")) return;
    setError("");
    try {
      const [{ auth }, { deleteInvoice }, { getStaffByUid }] = await Promise.all([
        import("@/lib/firebase"),
        import("@/features/invoices/data/client/invoices"),
        import("@/lib/auth"),
      ]);
      if (!auth.currentUser) {
        setError("로그인 정보를 확인할 수 없습니다.");
        return;
      }
      const staff = await getStaffByUid();
      if (!staff) {
        setError("직원 정보를 찾을 수 없습니다.");
        return;
      }
      const result = await deleteInvoice(invoice.id, staff);
      if (!result.success) {
        setError(result.message || "삭제 실패");
        return;
      }
      invalidateInvoicesByPatientCache(patientId);
      setInvoices((current) => {
        const next = current.filter((item) => item.id !== invoice.id);
        onCountLoaded(patientId, next.length);
        return next;
      });
      if (editingInvoice?.id === invoice.id) setEditingInvoice(null);
    } catch {
      setError("삭제 중 오류가 발생했습니다.");
    }
  }

  async function handleCreate(reservationDocId: string) {
    setCreating(reservationDocId);
    setError("");
    try {
      const [{ auth }, { getOrCreateInvoiceDraft }, { getStaffByUid }] = await Promise.all([
        import("@/lib/firebase"),
        import("@/features/invoices/data/client/invoices"),
        import("@/lib/auth"),
      ]);
      if (!auth.currentUser) {
        setError("로그인 정보를 확인할 수 없습니다.");
        return;
      }
      const staff = await getStaffByUid();
      if (!staff) {
        setError("직원 정보를 찾을 수 없습니다.");
        return;
      }
      const reservation = reservations.find((item) => item.id === reservationDocId);
      const isCoordinator = staff.role === "admin" ||
        (Array.isArray(reservation?.coordinators) && reservation.coordinators.includes(staff.displayName));
      if (!isCoordinator) {
        setError("담당 코디네이터만 인보이스를 생성할 수 있습니다.");
        return;
      }
      const result = await getOrCreateInvoiceDraft(reservationDocId, staff);
      if (!result.success || !result.invoice) {
        setError(result.message || "생성 실패");
        return;
      }
      await loadInvoices();
      setEditingInvoice(result.invoice);
    } catch {
      setError("생성 중 오류가 발생했습니다.");
    } finally {
      setCreating(null);
    }
  }

  if (viewingInvoice) {
    return (
      <PatientInvoiceDetailModal
        invoice={viewingInvoice}
        patientName={patientName}
        onEdit={() => { setEditingInvoice(viewingInvoice); setViewingInvoice(null); }}
        onClose={onClose}
      />
    );
  }

  if (editingInvoice) {
    return (
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/35 px-3 py-8 backdrop-blur-[2px]" onClick={onClose}>
        <div className="relative mx-0 flex max-h-[calc(100dvh-64px)] w-full max-w-xl flex-col overflow-hidden rounded-[30px] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.26)]" onClick={(event) => event.stopPropagation()}>
          <div className="flex shrink-0 items-center justify-between bg-white px-5 pb-3 pt-5">
            <button onClick={() => setEditingInvoice(null)} className="text-xs text-gray-500 hover:underline">← 목록</button>
            <span className="text-sm font-bold">{patientName} — 인보이스 수정</span>
            <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f6f7f5] text-[#667085]">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <InvoiceEditorForm
              invoice={editingInvoice}
              showHeader={false}
              onSaved={(updated) => {
                setInvoices((current) => current.map((invoice) => invoice.id === updated.id ? updated : invoice));
                setEditingInvoice(null);
              }}
              onDeleted={() => {
                setInvoices((current) => {
                  const next = current.filter((invoice) => invoice.id !== editingInvoice.id);
                  onCountLoaded(patientId, next.length);
                  return next;
                });
                setEditingInvoice(null);
              }}
              onCancel={() => setEditingInvoice(null)}
            />
          </div>
        </div>
      </div>
    );
  }

  const invoiceByReservation = new Map<string, InvoiceRecord>();
  for (const invoice of invoices) {
    const linkedReservationIds = invoice.reservationDocIds?.length
      ? invoice.reservationDocIds
      : [invoice.reservationDocId];
    linkedReservationIds.forEach((id) => invoiceByReservation.set(id, invoice));
  }
  const availableReservations = reservations.filter(
    (reservation) => (reservation.appointmentType === "수술" || reservation.appointmentType === "시술") && !invoiceByReservation.has(reservation.id)
  );

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/35 px-3 py-8 backdrop-blur-[2px]" onClick={onClose}>
      <div className="relative mx-0 flex max-h-[calc(100dvh-64px)] w-full max-w-xl flex-col overflow-hidden rounded-[30px] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.26)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between bg-white px-5 pb-3 pt-5">
          <div><div className="text-base font-bold">{patientName} — 인보이스</div><div className="mt-0.5 text-xs text-gray-400">전체 {invoices.length}건</div></div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f6f7f5] text-xl text-[#667085]">✕</button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
          {loading ? <div className="py-12 text-center text-sm text-gray-400">로딩 중...</div> : (
            <>
              {invoices.map((invoice) => {
                const linkedIds = invoice.reservationDocIds?.length
                  ? invoice.reservationDocIds
                  : [invoice.reservationDocId];
                const reservation = reservations.find((item) => item.id === invoice.reservationDocId)
                  || reservations.find((item) => linkedIds.includes(item.id));
                return (
                  <PatientInvoiceCard
                    key={invoice.id}
                    invoice={invoice}
                    reservation={reservation}
                    onView={() => setViewingInvoice(invoice)}
                    onEdit={() => setEditingInvoice(invoice)}
                    onDelete={() => void handleDelete(invoice)}
                  />
                );
              })}
              <div className="mt-1">
                <button onClick={() => { if (!showCreatePanel) void loadReservations(); setShowCreatePanel((current) => !current); }} className="w-full rounded-[18px] bg-[#e3f2ee] px-3 py-2 text-sm font-semibold text-[#0f9b8e] transition active:scale-95">
                  {showCreatePanel ? "닫기" : "+ 인보이스 생성"}
                </button>
                {showCreatePanel && <div className="mt-2"><PatientInvoiceCreatePanel reservations={availableReservations} loading={reservationsLoading} creatingId={creating} onCreate={(reservationId) => { void handleCreate(reservationId); setShowCreatePanel(false); }} /></div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
