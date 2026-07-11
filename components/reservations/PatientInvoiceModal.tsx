"use client";

// 환자별 인보이스 모달 + 인보이스 수정 패널.
// ReservationsTable.tsx에서 분리(파일 길이/관심사 분리). PatientInvoiceModal만 외부로 노출하고
// InvoiceEditPanelInModal은 이 파일 내부 전용. 동작은 분리 전과 동일(prop 기반 컴포넌트 verbatim 이동).

import { useState, useEffect, useCallback, useMemo } from "react";
import type { ReservationRecord } from "@/lib/reservations";
import { getCachedPatientFullHistory, getPatientFullHistoryCached } from "@/lib/reservations";
import type { InvoiceRecord } from "@/lib/invoices";
import {
  getInvoicesByPatientId,
  getInvoicesByPatientCache,
  invalidateInvoicesByPatientCache,
} from "@/lib/invoices";
import { calcCommissionBase, calcCommission } from "@/lib/commissionUtils";
import {
  PatientInvoiceCard,
  PatientInvoiceCreatePanel,
  PatientInvoiceDetailModal,
} from "./PatientInvoiceViews";

type PatientInvoiceModalProps = {
  patientId: string;
  patientName: string;
  onClose: () => void;
  onCountLoaded: (patientId: string, count: number) => void;
};

export function PatientInvoiceModal({ patientId, patientName, onClose, onCountLoaded }: PatientInvoiceModalProps) {
  const cached = getInvoicesByPatientCache(patientId);
  const cachedHistory = getCachedPatientFullHistory(patientId);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  // 고객관리가 summary 구조로 바뀌면서 patientGroup.reservations가 비어 있으므로,
  // 모달 내부에서 전체 이력을 lazy-load(getPatientFullHistoryCached는 세션 캐시가 있어
  // 금액 팝오버 등과 중복 호출해도 추가 read가 거의 없다).
  const [reservations, setReservations] = useState<ReservationRecord[]>(cachedHistory?.reservations ?? []);
  const [reservationsLoaded, setReservationsLoaded] = useState(Boolean(cachedHistory));
  const [reservationsLoading, setReservationsLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRecord | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<InvoiceRecord | null>(null);
  const [error, setError] = useState("");
  const [showCreatePanel, setShowCreatePanel] = useState(false);

  const load = useCallback(async () => {
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
      const { reservations: full } = await getPatientFullHistoryCached(patientId);
      setReservations(full);
      setReservationsLoaded(true);
    } catch {
      setReservations([]);
      setReservationsLoaded(true);
    } finally {
      setReservationsLoading(false);
    }
  }, [patientId, reservationsLoaded, reservationsLoading]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(inv: InvoiceRecord) {
    if (!confirm(`인보이스를 삭제할까요?`)) return;
    setError("");
    try {
      const { auth } = await import("@/lib/firebase");
      const { deleteInvoice } = await import("@/lib/invoices");
      const { getStaffByUid } = await import("@/lib/auth");
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
      const staff = await getStaffByUid();
      if (!staff) { setError("직원 정보를 찾을 수 없습니다."); return; }
      const result = await deleteInvoice(inv.id, staff);
      if (result.success) {
        invalidateInvoicesByPatientCache(patientId);
        setInvoices((prev) => {
          const next = prev.filter((i) => i.id !== inv.id);
          onCountLoaded(patientId, next.length);
          return next;
        });
        if (editingInvoice?.id === inv.id) setEditingInvoice(null);
      } else setError(result.message || "삭제 실패");
    } catch {
      setError("삭제 중 오류가 발생했습니다.");
    }
  }

  async function handleCreate(reservationDocId: string) {
    setCreating(reservationDocId);
    setError("");
    try {
      const { auth } = await import("@/lib/firebase");
      const { getOrCreateInvoiceDraft } = await import("@/lib/invoices");
      const { getStaffByUid } = await import("@/lib/auth");
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
      const staff = await getStaffByUid();
      if (!staff) { setError("직원 정보를 찾을 수 없습니다."); return; }
      const reservation = reservations.find((r) => r.id === reservationDocId);
      const isCoordinator = staff.role === "admin" ||
        (Array.isArray(reservation?.coordinators) && (reservation.coordinators as string[]).includes(staff.displayName));
      if (!isCoordinator) { setError("담당 코디네이터만 인보이스를 생성할 수 있습니다."); return; }
      const result = await getOrCreateInvoiceDraft(reservationDocId, staff);
      if (!result.success || !result.invoice) { setError(result.message || "생성 실패"); return; }
      await load();
      setEditingInvoice(result.invoice);
    } catch {
      setError("생성 중 오류가 발생했습니다.");
    } finally {
      setCreating(null);
    }
  }

  // 읽기 전용 보기 패널
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

  // inline edit panel
  if (editingInvoice) {
    return (
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40" onClick={onClose}>
        <div
          className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl mx-4 max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 shrink-0">
            <button onClick={() => setEditingInvoice(null)} className="text-xs text-gray-500 hover:underline">← 목록</button>
            <span className="text-sm font-bold">{patientName} — 인보이스 수정</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <InvoiceEditPanelInModal
              invoice={editingInvoice}
              onSaved={(updated) => {
                setInvoices((prev) => prev.map((i) => i.id === updated.id ? updated : i));
                setEditingInvoice(null);
              }}
              onDeleted={() => {
                setInvoices((prev) => {
                  const next = prev.filter((i) => i.id !== editingInvoice.id);
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

  const invoiceByReservation = new Map<string, InvoiceRecord>(invoices.map((inv) => [inv.reservationDocId, inv]));
  const surgeryReservationsWithoutInvoice = reservations.filter(
    (r) => (r.appointmentType === "수술" || r.appointmentType === "시술") && !invoiceByReservation.has(r.id)
  );

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 shrink-0">
          <div>
            <div className="text-base font-bold">{patientName} — 인보이스</div>
            <div className="text-xs text-gray-400 mt-0.5">전체 {invoices.length}건</div>
          </div>
          <button onClick={onClose} className="text-xl text-gray-400 hover:text-gray-700">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">로딩 중...</div>
          ) : (
            <>
              {reservations.map((reservation) => {
                const invoice = invoiceByReservation.get(reservation.id);
                return invoice ? (
                  <PatientInvoiceCard
                    key={reservation.id}
                    invoice={invoice}
                    reservation={reservation}
                    onView={() => setViewingInvoice(invoice)}
                    onEdit={() => setEditingInvoice(invoice)}
                    onDelete={() => handleDelete(invoice)}
                  />
                ) : null;
              })}
              {invoices
                .filter((invoice) => !reservations.some((reservation) => reservation.id === invoice.reservationDocId))
                .map((invoice) => (
                  <PatientInvoiceCard
                    key={invoice.id}
                    invoice={invoice}
                    onView={() => setViewingInvoice(invoice)}
                    onEdit={() => setEditingInvoice(invoice)}
                    onDelete={() => handleDelete(invoice)}
                  />
                ))}
              <div className="mt-1">
                <button
                  onClick={() => {
                    if (!showCreatePanel) void loadReservations();
                    setShowCreatePanel((v) => !v);
                  }}
                  className="w-full rounded-xl border border-[#1d9e75] px-3 py-2 text-sm font-medium text-[#1d9e75] hover:bg-emerald-50"
                >
                  {showCreatePanel ? "닫기" : "+ 인보이스 생성"}
                </button>
                {showCreatePanel && (
                  <div className="mt-2">
                    <PatientInvoiceCreatePanel
                      reservations={surgeryReservationsWithoutInvoice}
                      loading={reservationsLoading}
                      creatingId={creating}
                      onCreate={(reservationId) => {
                        void handleCreate(reservationId);
                        setShowCreatePanel(false);
                      }}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InvoiceEditPanelInModal({
  invoice,
  onSaved,
  onDeleted,
  onCancel,
}: {
  invoice: InvoiceRecord;
  onSaved: (inv: InvoiceRecord) => void;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<{
    hospitalName: string;
    surgeryDate: string;
    surgeryItems: string;
    totalAmount: number;
    doctors: string[];
    memo: string;
    status: "draft" | "confirmed" | "void";
    paymentMethod?: "card" | "cash" | "mixed";
    cardAmount?: number;
    cashAmount?: number;
    commissionStaffUid?: string;
    commissionStaffName?: string;
    commissionRate?: number;
  }>({
    hospitalName: invoice.hospitalName || "",
    surgeryDate: invoice.surgeryDate || "",
    surgeryItems: invoice.surgeryItems || "",
    totalAmount: invoice.totalAmount || 0,
    doctors: invoice.doctors || [],
    memo: invoice.memo || "",
    status: invoice.status || "draft",
    paymentMethod: invoice.paymentMethod,
    cardAmount: invoice.cardAmount,
    cashAmount: invoice.cashAmount,
    commissionStaffUid: invoice.commissionStaffUid,
    commissionStaffName: invoice.commissionStaffName,
    commissionRate: invoice.commissionRate,
  });
  const [staffList, setStaffList] = useState<Array<{ uid: string; displayName: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    import("@/lib/settings").then(({ getStaffListForSettings }) => {
      getStaffListForSettings()
        .then((list) => setStaffList(list.filter((s) => s.active && (s.role === "admin" || s.role === "coordinator"))))
        .catch(() => {});
    });
  }, []);

  // 폼 키 입력마다 재계산되던 커미션 파생값을 메모이즈(관련 필드 변경 시에만 재계산).
  const { computedBase, computedCommission } = useMemo(() => {
    const base = form.paymentMethod && form.totalAmount
      ? calcCommissionBase(form.totalAmount, form.paymentMethod, form.cardAmount, form.cashAmount)
      : undefined;
    const commission = base !== undefined && form.commissionRate
      ? calcCommission(base, form.commissionRate)
      : undefined;
    return { computedBase: base, computedCommission: commission };
  }, [form.paymentMethod, form.totalAmount, form.cardAmount, form.cashAmount, form.commissionRate]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const { auth } = await import("@/lib/firebase");
      const { updateInvoice } = await import("@/lib/invoices");
      const { getStaffByUid } = await import("@/lib/auth");
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
      const staff = await getStaffByUid();
      if (!staff) { setError("직원 정보를 찾을 수 없습니다."); return; }
      const result = await updateInvoice(invoice.id, {
        ...form,
        commissionBase: computedBase,
        commissionAmount: computedCommission,
      }, staff);
      if (!result.success || !result.invoice) { setError(result.message || "저장 실패"); return; }
      onSaved(result.invoice);
    } catch { setError("저장 중 오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm("인보이스를 삭제할까요?")) return;
    setDeleting(true);
    setError("");
    try {
      const { auth } = await import("@/lib/firebase");
      const { deleteInvoice } = await import("@/lib/invoices");
      const { getStaffByUid } = await import("@/lib/auth");
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
      const staff = await getStaffByUid();
      if (!staff) { setError("직원 정보를 찾을 수 없습니다."); return; }
      const result = await deleteInvoice(invoice.id, staff);
      if (!result.success) { setError(result.message || "삭제 실패"); return; }
      onDeleted();
    } catch { setError("삭제 중 오류가 발생했습니다."); }
    finally { setDeleting(false); }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">병원명</label>
        <input value={form.hospitalName} onChange={(e) => setForm((p) => ({ ...p, hospitalName: e.target.value }))}
          className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">수술날짜</label>
        <input
          type="date"
          value={form.surgeryDate}
          onChange={(e) => setForm((p) => ({ ...p, surgeryDate: e.target.value }))}
          className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">담당 원장</label>
          <input
            value={form.doctors.join(", ")}
            onChange={(e) => setForm((p) => ({ ...p, doctors: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))}
            placeholder="쉼표로 구분"
            className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">담당자</label>
          <div className="rounded-xl border border-[#dfe3e8] bg-gray-50 px-3 py-2 text-sm text-gray-600">
            {invoice.coordinators?.length ? invoice.coordinators.join(", ") : "-"}
          </div>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">수술/시술명</label>
        <textarea value={form.surgeryItems} onChange={(e) => setForm((p) => ({ ...p, surgeryItems: e.target.value }))}
          rows={2} className="w-full resize-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">수술비 (KRW)</label>
        <input type="number" value={form.totalAmount || ""} onChange={(e) => setForm((p) => ({ ...p, totalAmount: Number(e.target.value) || 0 }))}
          className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">상태</label>
        <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as "draft" | "confirmed" | "void" }))}
          className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none">
          <option value="draft">임시저장</option>
          <option value="confirmed">확정</option>
          <option value="void">취소</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">메모</label>
        <textarea value={form.memo} onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))}
          rows={2} className="w-full resize-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
      </div>

      {/* 커미션 섹션 */}
      <div className="rounded-xl border border-[#edf0f3] bg-gray-50 p-3 space-y-2">
        <div className="text-xs font-semibold text-gray-600">커미션</div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">결제방법</label>
          <select
            value={form.paymentMethod || ""}
            onChange={(e) => setForm((p) => ({ ...p, paymentMethod: (e.target.value as "card" | "cash" | "mixed") || undefined }))}
            className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
          >
            <option value="">선택</option>
            <option value="card">카드</option>
            <option value="cash">현금</option>
            <option value="mixed">혼합</option>
          </select>
        </div>
        {form.paymentMethod === "mixed" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-gray-500">카드금액</label>
              <input type="number" value={form.cardAmount || ""} onChange={(e) => setForm((p) => ({ ...p, cardAmount: Number(e.target.value) || 0 }))}
                className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">현금금액</label>
              <input type="number" value={form.cashAmount || ""} onChange={(e) => setForm((p) => ({ ...p, cashAmount: Number(e.target.value) || 0 }))}
                className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
            </div>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-gray-500">커미션 담당자</label>
          <select
            value={form.commissionStaffUid || ""}
            onChange={(e) => {
              const uid = e.target.value;
              const s = staffList.find((x) => x.uid === uid);
              setForm((p) => ({ ...p, commissionStaffUid: uid || undefined, commissionStaffName: s?.displayName || undefined }));
            }}
            className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
          >
            <option value="">담당자 선택</option>
            {staffList.map((s) => <option key={s.uid} value={s.uid}>{s.displayName}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">커미션율 (%)</label>
          <input type="number" value={form.commissionRate ?? ""} onChange={(e) => setForm((p) => ({ ...p, commissionRate: e.target.value ? Number(e.target.value) : undefined }))}
            className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
        </div>
        {computedBase !== undefined && (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-2.5 text-xs">
            <div><div className="text-gray-400">커미션 기준액</div><div className="font-semibold">{computedBase.toLocaleString()} KRW</div></div>
            <div><div className="text-gray-400">커미션액</div><div className="font-semibold text-[#1d9e75]">{computedCommission !== undefined ? computedCommission.toLocaleString() : "-"} KRW</div></div>
          </div>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 rounded-xl bg-[#1d9e75] py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? "저장 중..." : "저장"}
        </button>
        <button onClick={handleDelete} disabled={deleting}
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 disabled:opacity-50">
          {deleting ? "삭제 중..." : "삭제"}
        </button>
        <button onClick={onCancel} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-500">취소</button>
      </div>
    </div>
  );
}
