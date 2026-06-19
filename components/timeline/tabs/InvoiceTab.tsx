"use client";

import { useEffect, useMemo, useState } from "react";
import type { StaffUser } from "@/lib/auth";
import {
  getOrCreateInvoiceDraft,
  updateInvoice,
  deleteInvoice,
  type InvoiceRecord,
  type InvoiceUpdatePayload,
} from "@/lib/invoices";
import { getInvoiceByReservationDocId } from "@/lib/invoices";
import { getStaffListForSettings, type SettingsStaffRecord } from "@/lib/settings";
import { calcCommissionBase, calcCommission, paymentMethodLabel } from "@/lib/commissionUtils";

type Props = {
  reservationDocId: string;
  currentUser: StaffUser;
};

function formatMoney(v: number | undefined) {
  if (v === undefined || v === null) return "-";
  return Number(v).toLocaleString("ko-KR");
}

export function InvoiceTab({ reservationDocId, currentUser }: Props) {
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [staffList, setStaffList] = useState<SettingsStaffRecord[]>([]);

  const [form, setForm] = useState<InvoiceUpdatePayload>({
    hospitalName: "",
    surgeryItems: "",
    totalAmount: 0,
    paymentMethod: undefined,
    cardAmount: undefined,
    cashAmount: undefined,
    commissionStaffUid: undefined,
    commissionStaffName: undefined,
    commissionRate: undefined,
    commissionBase: undefined,
    commissionAmount: undefined,
    memo: "",
    status: "draft",
  });

  useEffect(() => {
    getStaffListForSettings()
      .then((list) => setStaffList(list.filter((s) => s.active && (s.role === "admin" || s.role === "coordinator"))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!reservationDocId) return;
    setLoading(true);
    setError("");
    setMessage("");
    getInvoiceByReservationDocId(reservationDocId)
      .then((inv) => {
        setInvoice(inv);
        if (inv) populateForm(inv);
      })
      .catch(() => setError("인보이스를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [reservationDocId]);

  function populateForm(inv: InvoiceRecord) {
    setForm({
      hospitalName: inv.hospitalName || "",
      surgeryItems: inv.surgeryItems || "",
      totalAmount: inv.totalAmount || 0,
      paymentMethod: inv.paymentMethod,
      cardAmount: inv.cardAmount,
      cashAmount: inv.cashAmount,
      commissionStaffUid: inv.commissionStaffUid,
      commissionStaffName: inv.commissionStaffName,
      commissionRate: inv.commissionRate,
      commissionBase: inv.commissionBase,
      commissionAmount: inv.commissionAmount,
      memo: inv.memo || "",
      status: inv.status || "draft",
    });
  }

  const computedBase = useMemo(() => {
    if (!form.paymentMethod || !form.totalAmount) return undefined;
    return calcCommissionBase(form.totalAmount, form.paymentMethod, form.cardAmount, form.cashAmount);
  }, [form.paymentMethod, form.totalAmount, form.cardAmount, form.cashAmount]);

  const computedCommission = useMemo(() => {
    if (computedBase === undefined || !form.commissionRate) return undefined;
    return calcCommission(computedBase, form.commissionRate);
  }, [computedBase, form.commissionRate]);

  async function handleCreate() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await getOrCreateInvoiceDraft(reservationDocId, currentUser);
      if (!result.success || !result.invoice) {
        setError(result.message || "인보이스 생성 실패");
        return;
      }
      setInvoice(result.invoice);
      populateForm(result.invoice);
      setMessage("인보이스가 생성되었습니다.");
    } catch {
      setError("인보이스 생성 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!invoice) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload: InvoiceUpdatePayload = {
        ...form,
        commissionBase: computedBase,
        commissionAmount: computedCommission,
      };
      const result = await updateInvoice(invoice.id, payload, currentUser);
      if (!result.success || !result.invoice) {
        setError(result.message || "저장 실패");
        return;
      }
      setInvoice(result.invoice);
      setMessage("저장되었습니다.");
    } catch {
      setError("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!invoice) return;
    if (!confirm("인보이스를 삭제할까요?")) return;
    setDeleting(true);
    setError("");
    try {
      const result = await deleteInvoice(invoice.id, currentUser);
      if (!result.success) { setError(result.message || "삭제 실패"); return; }
      setInvoice(null);
      setForm({ hospitalName: "", surgeryItems: "", totalAmount: 0, memo: "", status: "draft" });
      setMessage("인보이스가 삭제되었습니다.");
    } catch {
      setError("삭제 중 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-gray-400">불러오는 중...</div>;
  }

  if (!invoice) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border-2 border-dashed border-[#dfe3e8] p-6 text-center">
          <div className="text-sm text-gray-400">이 예약에 대한 인보이스가 없습니다.</div>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="mt-4 w-full rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
          >
            {saving ? "생성 중..." : "인보이스 생성"}
          </button>
        </div>
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-xs text-red-600">{error}</div>}
        {message && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-700">{message}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status badge */}
      <div className="flex items-center justify-between">
        <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
          invoice.status === "confirmed" ? "bg-emerald-50 text-emerald-700" :
          invoice.status === "void" ? "bg-red-50 text-red-500" :
          "bg-gray-100 text-gray-500"
        }`}>
          {{ draft: "임시저장", confirmed: "확정", void: "취소" }[invoice.status] || invoice.status}
        </span>
        <span className="text-xs text-gray-400">{invoice.invoiceId}</span>
      </div>

      {/* Form */}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">병원명</label>
          <input
            value={form.hospitalName}
            onChange={(e) => setForm((p) => ({ ...p, hospitalName: e.target.value }))}
            placeholder="병원명"
            className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">수술/시술명</label>
          <textarea
            value={form.surgeryItems}
            onChange={(e) => setForm((p) => ({ ...p, surgeryItems: e.target.value }))}
            placeholder="수술명, 시술명 등"
            rows={2}
            className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none resize-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">수술비 (KRW)</label>
          <input
            type="number"
            value={form.totalAmount || ""}
            onChange={(e) => setForm((p) => ({ ...p, totalAmount: Number(e.target.value) || 0 }))}
            placeholder="0"
            className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">상태</label>
          <select
            value={form.status || "draft"}
            onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as "draft" | "confirmed" | "void" }))}
            className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
          >
            <option value="draft">임시저장</option>
            <option value="confirmed">확정</option>
            <option value="void">취소</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">메모</label>
          <textarea
            value={form.memo || ""}
            onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))}
            placeholder="메모"
            rows={2}
            className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none resize-none"
          />
        </div>
      </div>

      {/* Commission section */}
      <div className="rounded-xl border border-[#edf0f3] bg-gray-50 p-3 space-y-3">
        <div className="text-xs font-semibold text-gray-600">커미션</div>

        <div>
          <label className="mb-1 block text-xs text-gray-500">결제방법</label>
          <select
            value={form.paymentMethod || ""}
            onChange={(e) => setForm((p) => ({ ...p, paymentMethod: e.target.value as "card" | "cash" | "mixed" | undefined || undefined }))}
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
              <input
                type="number"
                value={form.cardAmount || ""}
                onChange={(e) => setForm((p) => ({ ...p, cardAmount: Number(e.target.value) || 0 }))}
                placeholder="0"
                className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">현금금액</label>
              <input
                type="number"
                value={form.cashAmount || ""}
                onChange={(e) => setForm((p) => ({ ...p, cashAmount: Number(e.target.value) || 0 }))}
                placeholder="0"
                className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs text-gray-500">커미션 담당자</label>
          <select
            value={form.commissionStaffUid || ""}
            onChange={(e) => {
              const uid = e.target.value;
              const staff = staffList.find((s) => s.uid === uid);
              setForm((p) => ({ ...p, commissionStaffUid: uid || undefined, commissionStaffName: staff?.displayName || undefined }));
            }}
            className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
          >
            <option value="">담당자 선택</option>
            {staffList.map((s) => (
              <option key={s.uid} value={s.uid}>{s.displayName}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500">커미션율 (%)</label>
          <input
            type="number"
            value={form.commissionRate ?? ""}
            onChange={(e) => setForm((p) => ({ ...p, commissionRate: e.target.value ? Number(e.target.value) : undefined }))}
            placeholder="예: 15"
            className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
          />
        </div>

        {computedBase !== undefined && (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-2.5 text-xs">
            <div>
              <div className="text-gray-400">커미션 기준액</div>
              <div className="font-semibold">{formatMoney(computedBase)} KRW</div>
            </div>
            <div>
              <div className="text-gray-400">커미션액</div>
              <div className="font-semibold text-[#1d9e75]">{formatMoney(computedCommission)} KRW</div>
            </div>
          </div>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-xs text-red-600">{error}</div>}
      {message && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-700">{message}</div>}

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 rounded-xl bg-[#1d9e75] px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
        >
          {deleting ? "삭제 중..." : "삭제"}
        </button>
      </div>
    </div>
  );
}
