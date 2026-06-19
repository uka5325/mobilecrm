"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import type { ReservationRecord, AppointmentType } from "@/lib/reservations";
import { APPOINTMENT_TYPES } from "@/lib/reservations";
import { getReservationBirthInfo } from "@/lib/reservationUtils";
import type { InvoiceRecord } from "@/lib/invoices";
import { getInvoicesByPatientId } from "@/lib/invoices";

export type PatientGroup = {
  patientKey: string;
  patientId: string;
  name: string;
  birth: string;
  birthInput: string;
  gender: string;
  phone: string;
  nationality: string;
  reservations: ReservationRecord[];
};

export type PatientEditForm = {
  name: string;
  birthInput: string;
  phone: string;
  nationality: string;
  gender: string;
};

const APPT_TYPE_COLORS: Record<AppointmentType, string> = {
  상담: "#2563eb",
  수술: "#ef4444",
  치료: "#16a34a",
  경과: "#f59e0b",
};

type InlineForm = {
  name: string; birthInput: string; phone: string; nationality: string;
  consultArea: string; reservationDate: string; reservationTime: string;
  coordinators: string; depositAmount: string; surgeryCost: string; hospital: string;
  doctors: string;
  appointmentType: AppointmentType;
} | null;

type Props = {
  patientGroups: PatientGroup[];
  loading: boolean;
  inlineEditId: string | null;
  inlineForm: InlineForm;
  inlineSaving: boolean;
  onFormChange: (updater: (prev: InlineForm) => InlineForm) => void;
  onStartEdit: (item: ReservationRecord) => void;
  onSaveEdit: (item: ReservationRecord) => void;
  onCancelEdit: () => void;
  onDelete: (item: ReservationRecord) => void;
  onAddReservation: (item: ReservationRecord) => void;
  // 환자 헤더 편집
  patientEditId: string | null;
  patientEditForm: PatientEditForm | null;
  patientEditSaving: boolean;
  onPatientFormChange: (updater: (prev: PatientEditForm | null) => PatientEditForm | null) => void;
  onStartPatientEdit: (group: PatientGroup) => void;
  onSavePatientEdit: (group: PatientGroup) => void;
  onCancelPatientEdit: () => void;
  onDeletePatient: (group: PatientGroup) => void;
  onOpenPatientMemo: (group: PatientGroup) => void;
  onSaveAmount: (reservationId: string, field: "depositAmount" | "surgeryCost", value: string) => Promise<void>;
};

function getConsultAreas(reservations: ReservationRecord[], type: AppointmentType): string {
  const areas = reservations
    .filter((r) => r.appointmentType === type && r.consultArea)
    .map((r) => r.consultArea);
  return [...new Set(areas)].join(", ") || "—";
}

function sumAmounts(amounts: string[]): string {
  let total = 0;
  const nonNumeric: string[] = [];
  for (const a of amounts) {
    const n = parseFloat(a.replace(/[^0-9.]/g, ""));
    if (a.trim() && !isNaN(n) && n > 0) total += n;
    else if (a.trim()) nonNumeric.push(a.trim());
  }
  const parts: string[] = [];
  if (total > 0) parts.push(total.toLocaleString());
  parts.push(...nonNumeric);
  return parts.join(" + ") || "—";
}

type AmountPopoverProps = {
  label: string;
  rows: { id: string; date: string; hospital: string; amount: string }[];
  onClose: () => void;
  onSave: (reservationId: string, newAmount: string) => Promise<void>;
};

function AmountPopover({ label, rows, onClose, onSave }: AmountPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  async function handleSave(id: string) {
    setSaving(true);
    try {
      await onSave(id, editValue);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={ref}
      className="absolute z-50 mt-1 min-w-[300px] rounded-xl border border-gray-200 bg-white shadow-xl"
    >
      <div className="border-b border-gray-100 px-4 py-2.5 text-xs font-bold text-gray-700">{label} 내역</div>
      <div className="max-h-60 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-4 py-3 text-xs text-gray-400">내역 없음</div>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2 border-b border-gray-50 px-3 py-2 last:border-0">
              <span className="text-xs text-gray-500 w-[70px] shrink-0">{row.date || "—"}</span>
              <span className="text-xs text-gray-500 truncate flex-1">{row.hospital || "—"}</span>
              {editingId === row.id ? (
                <>
                  <input
                    autoFocus
                    className="w-[90px] rounded-lg border border-[#dfe3e8] px-2 py-0.5 text-xs focus:border-[#1d9e75] focus:outline-none"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                  />
                  <button
                    disabled={saving}
                    onClick={() => handleSave(row.id)}
                    className="rounded-lg bg-emerald-600 px-2 py-0.5 text-xs text-white disabled:opacity-50"
                  >
                    {saving ? "…" : "저장"}
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-600">
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs font-medium text-gray-800 w-[80px] text-right">{row.amount || "—"}</span>
                  <button
                    onClick={() => { setEditingId(row.id); setEditValue(row.amount); }}
                    className="text-xs text-blue-500 hover:underline shrink-0"
                  >
                    {row.amount ? "수정" : "입력"}
                  </button>
                  {row.amount && (
                    <button
                      onClick={async () => { setSaving(true); try { await onSave(row.id, ""); setEditingId(null); } finally { setSaving(false); } }}
                      className="text-xs text-red-400 hover:underline shrink-0"
                    >
                      삭제
                    </button>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: "임시저장", confirmed: "확정", void: "취소",
};
const STATUS_CLASS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-500", confirmed: "bg-emerald-50 text-emerald-700", void: "bg-red-50 text-red-500",
};

function formatMoney(v: number) { return v.toLocaleString("ko-KR"); }

type PatientInvoiceModalProps = {
  patientId: string;
  patientName: string;
  reservations: ReservationRecord[];
  onClose: () => void;
  onCountLoaded: (patientId: string, count: number) => void;
};

function PatientInvoiceModal({ patientId, patientName, reservations, onClose, onCountLoaded }: PatientInvoiceModalProps) {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRecord | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getInvoicesByPatientId(patientId);
      setInvoices(data);
      onCountLoaded(patientId, data.length);
    } finally {
      setLoading(false);
    }
  }, [patientId, onCountLoaded]);

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
      const staff = await getStaffByUid(firebaseUser.uid);
      if (!staff) { setError("직원 정보를 찾을 수 없습니다."); return; }
      const result = await deleteInvoice(inv.id, staff);
      if (result.success) {
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
      const staff = await getStaffByUid(firebaseUser.uid);
      if (!staff) { setError("직원 정보를 찾을 수 없습니다."); return; }
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
              {reservations.map((res) => {
                const inv = invoiceByReservation.get(res.id);
                if (inv) {
                  return (
                    <div key={res.id} className="rounded-xl border border-[#edf0f3] bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold truncate">{inv.hospitalName || "병원명 미입력"}</span>
                            {inv.doctors?.length > 0 && (
                              <span className="text-xs text-gray-500">{inv.doctors.join(", ")}</span>
                            )}
                            <span className="rounded-full bg-[#1d9e75] px-1.5 py-0.5 text-[10px] font-bold text-white">이 예약</span>
                          </div>
                          <div className="mt-0.5 text-xs text-gray-400">{res.reservationDate} {res.reservationTime}</div>
                          {inv.surgeryItems && (
                            <div className="mt-0.5 text-xs text-gray-500 truncate">{inv.surgeryItems}</div>
                          )}
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[inv.status] || "bg-gray-100 text-gray-500"}`}>
                              {STATUS_LABEL[inv.status] || inv.status}
                            </span>
                            {inv.totalAmount > 0 && (
                              <span className="text-xs text-gray-600">₩{formatMoney(inv.totalAmount)}</span>
                            )}
                            {inv.commissionAmount ? (
                              <span className="text-xs text-[#1d9e75]">커미션 ₩{formatMoney(inv.commissionAmount)}</span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-[10px] text-gray-400">{inv.invoiceId}</div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={() => setEditingInvoice(inv)}
                            className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDelete(inv)}
                            className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={res.id} className="rounded-xl border-2 border-dashed border-[#dfe3e8] p-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-gray-700">{res.reservationDate} {res.reservationTime}</div>
                      <div className="text-xs text-gray-500">{res.hospital || "병원명 없음"} · {res.appointmentType}</div>
                    </div>
                    <button
                      onClick={() => handleCreate(res.id)}
                      disabled={creating === res.id}
                      className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {creating === res.id ? "생성 중..." : "인보이스 생성"}
                    </button>
                  </div>
                );
              })}
              {invoices.filter((inv) => !reservations.find((r) => r.id === inv.reservationDocId)).map((inv) => (
                <div key={inv.id} className="rounded-xl border border-[#edf0f3] bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold truncate">{inv.hospitalName || "병원명 미입력"}</span>
                        {inv.doctors?.length > 0 && (
                          <span className="text-xs text-gray-500">{inv.doctors.join(", ")}</span>
                        )}
                      </div>
                      {inv.surgeryItems && <div className="mt-0.5 text-xs text-gray-500 truncate">{inv.surgeryItems}</div>}
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[inv.status] || "bg-gray-100 text-gray-500"}`}>
                          {STATUS_LABEL[inv.status] || inv.status}
                        </span>
                        {inv.totalAmount > 0 && <span className="text-xs text-gray-600">₩{formatMoney(inv.totalAmount)}</span>}
                        {inv.commissionAmount ? <span className="text-xs text-[#1d9e75]">커미션 ₩{formatMoney(inv.commissionAmount)}</span> : null}
                      </div>
                      <div className="mt-0.5 text-[10px] text-gray-400">{inv.invoiceId}</div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => setEditingInvoice(inv)} className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200">수정</button>
                      <button onClick={() => handleDelete(inv)} className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100">삭제</button>
                    </div>
                  </div>
                </div>
              ))}
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

  const computedBase = (() => {
    if (!form.paymentMethod || !form.totalAmount) return undefined;
    if (form.paymentMethod === "card") return Math.round(form.totalAmount * 0.97);
    if (form.paymentMethod === "cash") return form.totalAmount;
    if (form.paymentMethod === "mixed") {
      const cash = form.cashAmount || 0;
      const card = form.cardAmount || 0;
      return cash + Math.round(card * 0.97);
    }
    return undefined;
  })();
  const computedCommission = computedBase !== undefined && form.commissionRate
    ? Math.round(computedBase * form.commissionRate / 100)
    : undefined;

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const { auth } = await import("@/lib/firebase");
      const { updateInvoice } = await import("@/lib/invoices");
      const { getStaffByUid } = await import("@/lib/auth");
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
      const staff = await getStaffByUid(firebaseUser.uid);
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
      const staff = await getStaffByUid(firebaseUser.uid);
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

export function ReservationsTable({
  patientGroups,
  loading,
  inlineEditId,
  inlineForm,
  inlineSaving,
  onFormChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onAddReservation,
  patientEditId,
  patientEditForm,
  patientEditSaving,
  onPatientFormChange,
  onStartPatientEdit,
  onSavePatientEdit,
  onCancelPatientEdit,
  onDeletePatient,
  onOpenPatientMemo,
  onSaveAmount,
}: Props) {
  const cellCls = "border-b border-gray-100 px-2 py-2";
  const inputCls = "w-full rounded-lg border border-[#dfe3e8] px-2 py-1 text-xs focus:border-[#1d9e75] focus:outline-none";

  type PopoverState = { groupKey: string; type: "deposit" | "surgery" } | null;
  const [amountPopover, setAmountPopover] = useState<PopoverState>(null);
  const [invoiceModal, setInvoiceModal] = useState<{ patientId: string; patientName: string; reservations: ReservationRecord[] } | null>(null);
  const [invoiceCounts, setInvoiceCounts] = useState<Record<string, number>>({});

  const handleCountLoaded = useCallback((pid: string, count: number) => {
    setInvoiceCounts((prev) => ({ ...prev, [pid]: count }));
  }, []);

  useEffect(() => {
    if (!patientGroups.length) return;
    patientGroups.forEach((g) => {
      const pid = g.patientId || g.patientKey;
      if (!pid) return;
      getInvoicesByPatientId(pid)
        .then((invs) => setInvoiceCounts((prev) => ({ ...prev, [pid]: invs.length })))
        .catch(() => {});
    });
  }, [patientGroups]);

  function toggleAmountPopover(groupKey: string, type: "deposit" | "surgery") {
    setAmountPopover((prev) =>
      prev?.groupKey === groupKey && prev.type === type ? null : { groupKey, type }
    );
  }

  function renderReservationRow(item: ReservationRecord) {
    const apptType = item.appointmentType || "상담";
    const isEditing = inlineEditId === item.id;
    const f = inlineForm;

    return (
      <tr key={item.id} className={isEditing ? "bg-emerald-50" : "hover:bg-gray-50"}>
        {/* 예약일 */}
        <td className={cellCls}>
          {isEditing ? (
            <input type="date" className={inputCls} value={f!.reservationDate} onChange={(e) => onFormChange((p) => p && ({ ...p, reservationDate: e.target.value }))} />
          ) : (
            <span className="text-gray-700">{item.reservationDate || "—"}</span>
          )}
        </td>

        {/* 예약시간 */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.reservationTime} onChange={(e) => onFormChange((p) => p && ({ ...p, reservationTime: e.target.value }))} placeholder="HH:MM" />
          ) : (
            <span className="text-gray-700">{item.reservationTime || "—"}</span>
          )}
        </td>

        {/* 병원명 */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.hospital} onChange={(e) => onFormChange((p) => p && ({ ...p, hospital: e.target.value }))} placeholder="병원명" />
          ) : (
            <span className="font-medium text-gray-700">{item.hospital || "-"}</span>
          )}
        </td>

        {/* 담당 원장 */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.doctors} onChange={(e) => onFormChange((p) => p && ({ ...p, doctors: e.target.value }))} placeholder="쉼표 구분" />
          ) : (
            <span className="text-gray-500 text-xs">{(item.doctors || []).join(", ") || "—"}</span>
          )}
        </td>

        {/* 예약 유형 */}
        <td className={cellCls}>
          {isEditing ? (
            <select
              className={inputCls}
              value={f!.appointmentType}
              onChange={(e) => onFormChange((p) => p && ({ ...p, appointmentType: e.target.value as AppointmentType }))}
            >
              {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: APPT_TYPE_COLORS[apptType] || "#6b7280" }}
            >
              {apptType}
            </span>
          )}
        </td>

        {/* 상담부위/수술항목 (편집 모드에서만 표시) */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.consultArea} onChange={(e) => onFormChange((p) => p && ({ ...p, consultArea: e.target.value }))} />
          ) : (
            <span className="text-gray-500 text-xs">{item.consultArea || "—"}</span>
          )}
        </td>

        {/* 담당자 */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.coordinators} onChange={(e) => onFormChange((p) => p && ({ ...p, coordinators: e.target.value }))} placeholder="쉼표 구분" />
          ) : (
            <span className="text-gray-500">{item.coordinators.join(", ")}</span>
          )}
        </td>

        {/* 관리 */}
        <td className={`${cellCls} text-center`}>
          {isEditing ? (
            <div className="flex justify-center gap-1">
              <button onClick={() => onSaveEdit(item)} disabled={inlineSaving} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-50">
                {inlineSaving ? "…" : "저장"}
              </button>
              <button onClick={onCancelEdit} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500">
                취소
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-0.5">
              <button onClick={() => onStartEdit(item)} className="px-2 py-1 text-xs text-blue-600 hover:underline">수정</button>
              <button onClick={() => onAddReservation(item)} className="px-2 py-1 text-xs text-emerald-600 hover:underline">추가</button>
              <button onClick={() => onDelete(item)} className="px-2 py-1 text-xs text-red-500 hover:underline">삭제</button>
            </div>
          )}
        </td>
      </tr>
    );
  }

  function renderPatientHeader(group: PatientGroup) {
    const isEditing = patientEditId === group.patientKey;
    const pf = patientEditForm;

    const birthInfo = getReservationBirthInfo({
      birth: group.birth,
      birthInput: group.birthInput,
      gender: group.gender,
    } as Parameters<typeof getReservationBirthInfo>[0]);

    const surgeryReserved = group.reservations.some((r) => r.surgeryReserved);
    const consultAreas = getConsultAreas(group.reservations, "상담");
    const surgeryAreas = getConsultAreas(group.reservations, "수술");

    const depositRows = group.reservations
      .map((r) => ({ id: r.id, date: r.reservationDate || "", hospital: r.hospital || "", amount: r.depositAmount || "" }));
    const surgeryRows = group.reservations
      .map((r) => ({ id: r.id, date: r.reservationDate || "", hospital: r.hospital || "", amount: r.surgeryCost || "" }));

    const depositPopoverOpen = amountPopover?.groupKey === group.patientKey && amountPopover.type === "deposit";
    const surgeryPopoverOpen = amountPopover?.groupKey === group.patientKey && amountPopover.type === "surgery";

    if (isEditing && pf) {
      return (
        <tr key={`patient-edit-${group.patientKey}`} className="bg-blue-50">
          <td colSpan={8} className="border-y border-blue-200 px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="h-7 w-[100px] rounded-lg border border-[#dfe3e8] bg-white px-2 text-xs font-bold focus:border-[#1d9e75] focus:outline-none"
                value={pf.name}
                placeholder="이름"
                onChange={(e) => onPatientFormChange((p) => p && ({ ...p, name: e.target.value }))}
              />
              <input
                className="h-7 w-[120px] rounded-lg border border-[#dfe3e8] bg-white px-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                value={pf.birthInput}
                placeholder="생년월일 (891210-1)"
                onChange={(e) => onPatientFormChange((p) => p && ({ ...p, birthInput: e.target.value }))}
              />
              <select
                className="h-7 w-[70px] rounded-lg border border-[#dfe3e8] bg-white px-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                value={pf.gender}
                onChange={(e) => onPatientFormChange((p) => p && ({ ...p, gender: e.target.value }))}
              >
                <option value="">성별</option>
                <option value="남">남</option>
                <option value="여">여</option>
              </select>
              <input
                className="h-7 w-[130px] rounded-lg border border-[#dfe3e8] bg-white px-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                value={pf.phone}
                placeholder="연락처"
                onChange={(e) => onPatientFormChange((p) => p && ({ ...p, phone: e.target.value }))}
              />
              <input
                className="h-7 w-[90px] rounded-lg border border-[#dfe3e8] bg-white px-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                value={pf.nationality}
                placeholder="국적"
                onChange={(e) => onPatientFormChange((p) => p && ({ ...p, nationality: e.target.value }))}
              />
              <div className="ml-auto flex gap-1">
                <button
                  onClick={() => onSavePatientEdit(group)}
                  disabled={patientEditSaving}
                  className="rounded-lg bg-emerald-600 px-3 py-1 text-xs text-white disabled:opacity-50"
                >
                  {patientEditSaving ? "…" : "저장"}
                </button>
                <button onClick={onCancelPatientEdit} className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-500">
                  취소
                </button>
              </div>
            </div>
          </td>
        </tr>
      );
    }

    return (
      <tr key={`patient-${group.patientKey}`} className="bg-blue-50">
        <td colSpan={8} className="border-y border-blue-100 px-4 py-2">
          {/* 1행: 환자 기본 정보 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mb-1.5">
            <span className="text-sm font-bold text-gray-900">{group.name}</span>
            {birthInfo.birthDisplay && (
              <span className="text-xs text-gray-500">{birthInfo.birthDisplay} ({birthInfo.ageText})</span>
            )}
            {group.gender && <span className="text-xs text-gray-500">{group.gender}</span>}
            {group.phone && <span className="text-xs text-gray-500">{group.phone}</span>}
            {group.nationality && <span className="text-xs text-gray-400">{group.nationality}</span>}
          </div>

          {/* 2행: 집계 정보 + 버튼 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {consultAreas !== "—" && (
              <span className="text-xs text-gray-600">
                <span className="font-medium text-blue-700">상담</span> {consultAreas}
              </span>
            )}
            {surgeryAreas !== "—" && (
              <span className="text-xs text-gray-600">
                <span className="font-medium text-red-600">수술</span> {surgeryAreas}
              </span>
            )}
            <span className={`text-xs font-medium ${surgeryReserved ? "text-purple-700" : "text-gray-400"}`}>
              수술예약 {surgeryReserved ? "✓" : "✗"}
            </span>

            {/* 예약금 버튼 + 팝오버 */}
            <div className="relative">
              <button
                onClick={() => toggleAmountPopover(group.patientKey, "deposit")}
                className={`rounded-md border px-2 py-0.5 text-xs transition ${depositRows.length > 0 ? "border-blue-200 bg-white text-blue-600 hover:bg-blue-50" : "border-gray-200 bg-white text-gray-400"}`}
              >
                예약금{depositRows.length > 0 ? ` (${depositRows.length})` : ""}
              </button>
              {depositPopoverOpen && (
                <AmountPopover
                  label="예약금"
                  rows={depositRows}
                  onClose={() => setAmountPopover(null)}
                  onSave={(id, v) => onSaveAmount(id, "depositAmount", v)}
                />
              )}
            </div>

            {/* 수술비용 버튼 + 팝오버 */}
            <div className="relative">
              <button
                onClick={() => toggleAmountPopover(group.patientKey, "surgery")}
                className={`rounded-md border px-2 py-0.5 text-xs transition ${surgeryRows.length > 0 ? "border-orange-200 bg-white text-orange-600 hover:bg-orange-50" : "border-gray-200 bg-white text-gray-400"}`}
              >
                수술비용{surgeryRows.length > 0 ? ` (${surgeryRows.length})` : ""}
              </button>
              {surgeryPopoverOpen && (
                <AmountPopover
                  label="수술비용"
                  rows={surgeryRows}
                  onClose={() => setAmountPopover(null)}
                  onSave={(id, v) => onSaveAmount(id, "surgeryCost", v)}
                />
              )}
            </div>

            {(() => {
              const pid = group.patientId || group.patientKey;
              const cnt = invoiceCounts[pid];
              return (
                <button
                  onClick={() => setInvoiceModal({ patientId: pid, patientName: group.name, reservations: group.reservations })}
                  className={`rounded-md border px-2 py-0.5 text-xs transition ${cnt !== undefined && cnt > 0 ? "border-[#1d9e75] bg-white text-[#1d9e75] hover:bg-emerald-50" : "border-gray-200 bg-white text-gray-400 hover:bg-gray-50"}`}
                >
                  인보이스{cnt !== undefined && cnt > 0 ? ` (${cnt})` : ""}
                </button>
              );
            })()}

            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => onOpenPatientMemo(group)}
                className="rounded-md border border-emerald-200 bg-white px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50"
              >
                메모
              </button>
              <button
                onClick={() => onStartPatientEdit(group)}
                className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
              >
                수정
              </button>
              <button
                onClick={() => onDeletePatient(group)}
                className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
              >
                삭제
              </button>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                총 {group.reservations.length}건
              </span>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  function renderBody() {
    if (loading) {
      return (
        <tr>
          <td colSpan={8} className="py-12 text-center text-gray-400">데이터 로딩 중...</td>
        </tr>
      );
    }
    if (patientGroups.length === 0) {
      return (
        <tr>
          <td colSpan={8} className="py-12 text-center text-gray-400">고객이 없습니다.</td>
        </tr>
      );
    }

    const rows: ReactNode[] = [];

    patientGroups.forEach((group) => {
      rows.push(renderPatientHeader(group));
      group.reservations.forEach((item) => {
        rows.push(renderReservationRow(item));
      });
    });

    return rows;
  }

  return (
    <>
    {invoiceModal && (
      <PatientInvoiceModal
        patientId={invoiceModal.patientId}
        patientName={invoiceModal.patientName}
        reservations={invoiceModal.reservations}
        onClose={() => setInvoiceModal(null)}
        onCountLoaded={handleCountLoaded}
      />
    )}
    <div className="-mx-4 sm:-mx-6 lg:-mx-8">
      <div className="overflow-x-auto border-y border-gray-100 bg-white">
        <table className="min-w-[900px] w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[100px]" />
            <col className="w-[60px]" />
            <col className="w-[100px]" />
            <col className="w-[90px]" />
            <col className="w-[60px]" />
            <col className="w-[110px]" />
            <col className="w-[90px]" />
            <col className="w-[120px]" />
          </colgroup>

          <thead className="bg-gray-50">
            <tr>
              {["예약일", "시간", "병원명", "담당 원장", "유형", "상담/수술항목", "담당자", "관리"].map((head) => (
                <th key={head} className="border-b border-gray-200 px-4 py-3 text-left text-xs font-semibold text-gray-500">
                  {head}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>{renderBody()}</tbody>
        </table>
      </div>
    </div>
    </>
  );
}
