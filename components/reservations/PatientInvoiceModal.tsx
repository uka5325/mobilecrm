"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReservationRecord } from "@/lib/reservations";
import { getCachedPatientFullHistory, getPatientFullHistoryCached } from "@/lib/reservations";
import type { InvoiceRecord } from "@/lib/invoices";
import {
  getInvoicesByPatientId,
  getInvoicesByPatientCache,
  invalidateInvoicesByPatientCache,
} from "@/lib/invoices";
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
        import("@/lib/invoices"),
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
        import("@/lib/invoices"),
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
        onBack={() => setViewingInvoice(null)}
        onEdit={() => { setEditingInvoice(viewingInvoice); setViewingInvoice(null); }}
        onClose={onClose}
      />
    );
  }

  if (editingInvoice) {
    return (
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40" onClick={onClose}>
        <div className="relative mx-4 flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
            <button onClick={() => setEditingInvoice(null)} className="text-xs text-gray-500 hover:underline">← 목록</button>
            <span className="text-sm font-bold">{patientName} — 인보이스 수정</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
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

  const invoiceByReservation = new Map(invoices.map((invoice) => [invoice.reservationDocId, invoice]));
  const availableReservations = reservations.filter(
    (reservation) => (reservation.appointmentType === "수술" || reservation.appointmentType === "시술") && !invoiceByReservation.has(reservation.id)
  );

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="relative mx-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
          <div><div className="text-base font-bold">{patientName} — 인보이스</div><div className="mt-0.5 text-xs text-gray-400">전체 {invoices.length}건</div></div>
          <button onClick={onClose} className="text-xl text-gray-400 hover:text-gray-700">✕</button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
          {loading ? <div className="py-12 text-center text-sm text-gray-400">로딩 중...</div> : (
            <>
              {reservations.map((reservation) => {
                const invoice = invoiceByReservation.get(reservation.id);
                return invoice ? <PatientInvoiceCard key={reservation.id} invoice={invoice} reservation={reservation} onView={() => setViewingInvoice(invoice)} onEdit={() => setEditingInvoice(invoice)} onDelete={() => void handleDelete(invoice)} /> : null;
              })}
              {invoices.filter((invoice) => !reservations.some((reservation) => reservation.id === invoice.reservationDocId)).map((invoice) => (
                <PatientInvoiceCard key={invoice.id} invoice={invoice} onView={() => setViewingInvoice(invoice)} onEdit={() => setEditingInvoice(invoice)} onDelete={() => void handleDelete(invoice)} />
              ))}
              <div className="mt-1">
                <button onClick={() => { if (!showCreatePanel) void loadReservations(); setShowCreatePanel((current) => !current); }} className="w-full rounded-xl border border-[#1d9e75] px-3 py-2 text-sm font-medium text-[#1d9e75] hover:bg-emerald-50">
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
