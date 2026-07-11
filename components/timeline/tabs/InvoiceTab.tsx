"use client";

import { useEffect, useState } from "react";
import type { StaffUser } from "@/lib/auth";
import {
  deleteInvoice,
  getInvoicesByPatientId,
  getOrCreateInvoiceDraft,
  type InvoiceRecord,
} from "@/lib/invoices";
import { InvoiceEditorForm } from "@/components/invoices/InvoiceEditorForm";
import { InvoiceDetailView } from "./InvoiceDetailView";
import { InvoiceList } from "./InvoiceList";

type Props = {
  reservationDocId: string;
  patientId?: string;
  currentUser: StaffUser;
  appointmentType?: string;
  coordinators?: string[];
};

export function InvoiceTab({ reservationDocId, patientId, currentUser, appointmentType, coordinators }: Props) {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRecord | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<InvoiceRecord | null>(null);

  useEffect(() => {
    if (!reservationDocId) return;
    void loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationDocId, patientId]);

  async function loadInvoices() {
    setLoading(true);
    setError("");
    try {
      if (patientId) {
        setInvoices(await getInvoicesByPatientId(patientId));
      } else {
        const { getInvoiceByReservationDocId } = await import("@/lib/invoices");
        const invoice = await getInvoiceByReservationDocId(reservationDocId);
        setInvoices(invoice ? [invoice] : []);
      }
    } catch (loadError) {
      console.error("[InvoiceTab] load error:", (loadError as Error)?.message ?? "");
      setError("인보이스를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(invoice: InvoiceRecord) {
    if (!confirm("인보이스를 삭제할까요?")) return;
    setError("");
    try {
      const result = await deleteInvoice(invoice.id, currentUser);
      if (!result.success) {
        setError(result.message || "삭제 실패");
        return;
      }
      setInvoices((current) => current.filter((item) => item.id !== invoice.id));
    } catch {
      setError("삭제 중 오류가 발생했습니다.");
    }
  }

  async function handleCreate() {
    setCreating(true);
    setError("");
    try {
      const result = await getOrCreateInvoiceDraft(reservationDocId, currentUser);
      if (!result.success || !result.invoice) {
        setError(result.message || "인보이스 생성 실패");
        return;
      }
      await loadInvoices();
      setEditingInvoice(result.invoice);
    } catch (createError) {
      console.error("[InvoiceTab] create error:", (createError as Error)?.message ?? "");
      setError("인보이스 생성 중 오류가 발생했습니다.");
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-gray-400">불러오는 중...</div>;

  if (viewingInvoice) {
    return (
      <InvoiceDetailView
        invoice={viewingInvoice}
        onEdit={() => { setEditingInvoice(viewingInvoice); setViewingInvoice(null); }}
        onBack={() => setViewingInvoice(null)}
      />
    );
  }

  if (editingInvoice) {
    return (
      <InvoiceEditorForm
        invoice={editingInvoice}
        currentUser={currentUser}
        onSaved={(updated) => {
          setInvoices((current) => current.map((invoice) => invoice.id === updated.id ? updated : invoice));
          setEditingInvoice(null);
        }}
        onDeleted={() => {
          setInvoices((current) => current.filter((invoice) => invoice.id !== editingInvoice.id));
          setEditingInvoice(null);
        }}
        onCancel={() => setEditingInvoice(null)}
      />
    );
  }

  return (
    <InvoiceList
      invoices={invoices}
      reservationDocId={reservationDocId}
      appointmentType={appointmentType}
      coordinators={coordinators}
      currentUser={currentUser}
      creating={creating}
      error={error}
      onCreate={handleCreate}
      onView={setViewingInvoice}
      onEdit={setEditingInvoice}
      onDelete={handleDelete}
    />
  );
}
