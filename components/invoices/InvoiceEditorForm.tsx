"use client";

import { useEffect, useMemo, useState } from "react";
import type { StaffUser } from "@/lib/auth";
import type { InvoiceRecord, InvoiceUpdatePayload } from "@/lib/invoices";
import { calcCommission, calcCommissionBase } from "@/lib/commissionUtils";
import { INVOICE_STATUS_CLASS, INVOICE_STATUS_LABEL, formatMoney } from "./invoiceUi";

type Props = {
  invoice: InvoiceRecord;
  currentUser?: StaffUser;
  showHeader?: boolean;
  onSaved: (invoice: InvoiceRecord) => void;
  onDeleted: () => void;
  onCancel: () => void;
};

async function resolveStaff(currentUser?: StaffUser) {
  if (currentUser) return currentUser;
  const [{ auth }, { getStaffByUid }] = await Promise.all([
    import("@/lib/firebase"),
    import("@/lib/auth"),
  ]);
  if (!auth.currentUser) return null;
  return getStaffByUid();
}

export function InvoiceEditorForm({
  invoice,
  currentUser,
  showHeader = true,
  onSaved,
  onDeleted,
  onCancel,
}: Props) {
  const [form, setForm] = useState<InvoiceUpdatePayload>({
    hospitalName: invoice.hospitalName || "",
    surgeryItems: invoice.surgeryItems || "",
    surgeryDate: invoice.surgeryDate || "",
    totalAmount: invoice.totalAmount || 0,
    paymentMethod: invoice.paymentMethod,
    cardAmount: invoice.cardAmount,
    cashAmount: invoice.cashAmount,
    commissionStaffUid: invoice.commissionStaffUid,
    commissionStaffName: invoice.commissionStaffName,
    commissionRate: invoice.commissionRate,
    commissionBase: invoice.commissionBase,
    commissionAmount: invoice.commissionAmount,
    memo: invoice.memo || "",
    doctors: invoice.doctors || [],
    status: invoice.status || "draft",
  });
  const [staffList, setStaffList] = useState<Array<{ uid: string; displayName: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    import("@/lib/settings").then(({ getStaffListForSettings }) => {
      getStaffListForSettings()
        .then((list) => setStaffList(list.filter((staff) => staff.active && (staff.role === "admin" || staff.role === "coordinator"))))
        .catch(() => {});
    });
  }, []);

  const { commissionBase, commissionAmount } = useMemo(() => {
    const base = form.paymentMethod && form.totalAmount
      ? calcCommissionBase(form.totalAmount, form.paymentMethod, form.cardAmount, form.cashAmount)
      : undefined;
    const amount = base !== undefined && form.commissionRate
      ? calcCommission(base, form.commissionRate)
      : undefined;
    return { commissionBase: base, commissionAmount: amount };
  }, [form.paymentMethod, form.totalAmount, form.cardAmount, form.cashAmount, form.commissionRate]);

  async function handleSave() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const staff = await resolveStaff(currentUser);
      if (!staff) {
        setError("로그인 또는 직원 정보를 확인할 수 없습니다.");
        return;
      }
      const { updateInvoice } = await import("@/lib/invoices");
      const result = await updateInvoice(invoice.id, {
        ...form,
        commissionBase,
        commissionAmount,
      }, staff);
      if (!result.success || !result.invoice) {
        setError(result.message || "저장 실패");
        return;
      }
      setMessage("저장되었습니다.");
      onSaved(result.invoice);
    } catch {
      setError("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("인보이스를 삭제할까요?")) return;
    setDeleting(true);
    setError("");
    try {
      const staff = await resolveStaff(currentUser);
      if (!staff) {
        setError("로그인 또는 직원 정보를 확인할 수 없습니다.");
        return;
      }
      const { deleteInvoice } = await import("@/lib/invoices");
      const result = await deleteInvoice(invoice.id, staff);
      if (!result.success) {
        setError(result.message || "삭제 실패");
        return;
      }
      onDeleted();
    } catch {
      setError("삭제 중 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      {showHeader && (
        <div className="flex items-center justify-between">
          <button onClick={onCancel} className="text-xs text-gray-500 hover:underline">← 목록</button>
          <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${INVOICE_STATUS_CLASS[invoice.status] || "bg-gray-100 text-gray-500"}`}>
            {INVOICE_STATUS_LABEL[invoice.status] || invoice.status}
          </span>
          <span className="text-xs text-gray-400">{invoice.invoiceId}</span>
        </div>
      )}

      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">병원명</label>
          <input value={form.hospitalName} onChange={(event) => setForm((prev) => ({ ...prev, hospitalName: event.target.value }))} className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">수술날짜</label>
          <input type="date" value={form.surgeryDate || ""} onChange={(event) => setForm((prev) => ({ ...prev, surgeryDate: event.target.value }))} className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">담당 원장</label>
            <input value={(form.doctors || []).join(", ")} onChange={(event) => setForm((prev) => ({ ...prev, doctors: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) }))} placeholder="쉼표로 구분" className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">담당자</label>
            <div className="rounded-xl border border-[#dfe3e8] bg-gray-50 px-3 py-2 text-sm text-gray-600">{invoice.coordinators?.length ? invoice.coordinators.join(", ") : "-"}</div>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">수술/시술명</label>
          <textarea value={form.surgeryItems} onChange={(event) => setForm((prev) => ({ ...prev, surgeryItems: event.target.value }))} rows={2} className="w-full resize-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">수술비 (KRW)</label>
          <input type="number" value={form.totalAmount || ""} onChange={(event) => setForm((prev) => ({ ...prev, totalAmount: Number(event.target.value) || 0 }))} className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">상태</label>
          <select value={form.status || "draft"} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as "draft" | "confirmed" | "void" }))} className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none">
            <option value="draft">임시저장</option><option value="confirmed">확정</option><option value="void">취소</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">메모</label>
          <textarea value={form.memo || ""} onChange={(event) => setForm((prev) => ({ ...prev, memo: event.target.value }))} rows={2} className="w-full resize-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-[#edf0f3] bg-gray-50 p-3">
        <div className="text-xs font-semibold text-gray-600">커미션</div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">결제방법</label>
          <select value={form.paymentMethod || ""} onChange={(event) => setForm((prev) => ({ ...prev, paymentMethod: (event.target.value as "card" | "cash" | "mixed") || undefined }))} className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none">
            <option value="">선택</option><option value="card">카드</option><option value="cash">현금</option><option value="mixed">혼합</option>
          </select>
        </div>
        {form.paymentMethod === "mixed" && (
          <div className="grid grid-cols-2 gap-2">
            <div><label className="mb-1 block text-xs text-gray-500">카드금액</label><input type="number" value={form.cardAmount || ""} onChange={(event) => setForm((prev) => ({ ...prev, cardAmount: Number(event.target.value) || 0 }))} className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" /></div>
            <div><label className="mb-1 block text-xs text-gray-500">현금금액</label><input type="number" value={form.cashAmount || ""} onChange={(event) => setForm((prev) => ({ ...prev, cashAmount: Number(event.target.value) || 0 }))} className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" /></div>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-gray-500">커미션 담당자</label>
          <select value={form.commissionStaffUid || ""} onChange={(event) => { const uid = event.target.value; const staff = staffList.find((item) => item.uid === uid); setForm((prev) => ({ ...prev, commissionStaffUid: uid || undefined, commissionStaffName: staff?.displayName || undefined })); }} className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none">
            <option value="">담당자 선택</option>{staffList.map((staff) => <option key={staff.uid} value={staff.uid}>{staff.displayName}</option>)}
          </select>
        </div>
        <div><label className="mb-1 block text-xs text-gray-500">커미션율 (%)</label><input type="number" value={form.commissionRate ?? ""} onChange={(event) => setForm((prev) => ({ ...prev, commissionRate: event.target.value ? Number(event.target.value) : undefined }))} className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" /></div>
        {commissionBase !== undefined && (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-2.5 text-xs">
            <div><div className="text-gray-400">커미션 기준액</div><div className="font-semibold">{formatMoney(commissionBase)} KRW</div></div>
            <div><div className="text-gray-400">커미션액</div><div className="font-semibold text-[#1d9e75]">{formatMoney(commissionAmount)} KRW</div></div>
          </div>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
      {message && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</div>}
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl bg-[#1d9e75] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "저장 중..." : "저장"}</button>
        <button onClick={handleDelete} disabled={deleting} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 disabled:opacity-50">{deleting ? "삭제 중..." : "삭제"}</button>
        {!showHeader && <button onClick={onCancel} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-500">취소</button>}
      </div>
    </div>
  );
}
