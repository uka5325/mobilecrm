"use client";

import { useEffect, useState } from "react";
import type { StaffUser } from "@/lib/auth";
import {
  getOrCreateInvoiceDraft,
  updateInvoice,
  deleteInvoice,
  getInvoicesByPatientId,
  type InvoiceRecord,
  type InvoiceUpdatePayload,
} from "@/lib/invoices";
import { getStaffListForSettings, type SettingsStaffRecord } from "@/lib/settings";
import { calcCommissionBase, calcCommission, paymentMethodLabel } from "@/lib/commissionUtils";

type Props = {
  reservationDocId: string;
  patientId?: string;
  currentUser: StaffUser;
};

function formatMoney(v: number | undefined) {
  if (v === undefined || v === null) return "-";
  return Number(v).toLocaleString("ko-KR");
}

const STATUS_LABEL: Record<string, string> = { draft: "임시저장", confirmed: "확정", void: "취소" };
const STATUS_CLS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-500",
  confirmed: "bg-emerald-50 text-emerald-700",
  void: "bg-red-50 text-red-500",
};

type EditForm = InvoiceUpdatePayload & { _computedBase?: number; _computedCommission?: number };

function InvoiceEditPanel({
  invoice,
  staffList,
  onSaved,
  onDeleted,
  onCancel,
  currentUser,
}: {
  invoice: InvoiceRecord;
  staffList: SettingsStaffRecord[];
  onSaved: (inv: InvoiceRecord) => void;
  onDeleted: () => void;
  onCancel: () => void;
  currentUser: StaffUser;
}) {
  const [form, setForm] = useState<InvoiceUpdatePayload>({
    hospitalName: invoice.hospitalName || "",
    surgeryItems: invoice.surgeryItems || "",
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
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const computedBase = (() => {
    if (!form.paymentMethod || !form.totalAmount) return undefined;
    return calcCommissionBase(form.totalAmount, form.paymentMethod, form.cardAmount, form.cashAmount);
  })();
  const computedCommission = computedBase !== undefined && form.commissionRate
    ? calcCommission(computedBase, form.commissionRate)
    : undefined;

  async function handleSave() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await updateInvoice(invoice.id, { ...form, commissionBase: computedBase, commissionAmount: computedCommission }, currentUser);
      if (!result.success || !result.invoice) { setError(result.message || "저장 실패"); return; }
      setMessage("저장되었습니다.");
      onSaved(result.invoice);
    } catch { setError("저장 중 오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm("인보이스를 삭제할까요?")) return;
    setDeleting(true);
    setError("");
    try {
      const result = await deleteInvoice(invoice.id, currentUser);
      if (!result.success) { setError(result.message || "삭제 실패"); return; }
      onDeleted();
    } catch { setError("삭제 중 오류가 발생했습니다."); }
    finally { setDeleting(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onCancel} className="text-xs text-gray-500 hover:underline">← 목록</button>
        <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${STATUS_CLS[invoice.status] || "bg-gray-100 text-gray-500"}`}>
          {STATUS_LABEL[invoice.status] || invoice.status}
        </span>
        <span className="text-xs text-gray-400">{invoice.invoiceId}</span>
      </div>

      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">병원명</label>
          <input value={form.hospitalName} onChange={(e) => setForm((p) => ({ ...p, hospitalName: e.target.value }))}
            className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">담당 원장</label>
            <input
              value={(form.doctors || []).join(", ")}
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
            rows={2} className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none resize-none" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">수술비 (KRW)</label>
          <input type="number" value={form.totalAmount || ""} onChange={(e) => setForm((p) => ({ ...p, totalAmount: Number(e.target.value) || 0 }))}
            className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">상태</label>
          <select value={form.status || "draft"} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as "draft" | "confirmed" | "void" }))}
            className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none">
            <option value="draft">임시저장</option>
            <option value="confirmed">확정</option>
            <option value="void">취소</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">메모</label>
          <textarea value={form.memo || ""} onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))}
            rows={2} className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none resize-none" />
        </div>
      </div>

      {/* 커미션 */}
      <div className="rounded-xl border border-[#edf0f3] bg-gray-50 p-3 space-y-2">
        <div className="text-xs font-semibold text-gray-600">커미션</div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">결제방법</label>
          <select value={form.paymentMethod || ""} onChange={(e) => setForm((p) => ({ ...p, paymentMethod: (e.target.value as "card" | "cash" | "mixed") || undefined }))}
            className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none">
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
          <select value={form.commissionStaffUid || ""} onChange={(e) => {
            const uid = e.target.value;
            const staff = staffList.find((s) => s.uid === uid);
            setForm((p) => ({ ...p, commissionStaffUid: uid || undefined, commissionStaffName: staff?.displayName || undefined }));
          }} className="w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none">
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
            <div><div className="text-gray-400">커미션 기준액</div><div className="font-semibold">{formatMoney(computedBase)} KRW</div></div>
            <div><div className="text-gray-400">커미션액</div><div className="font-semibold text-[#1d9e75]">{formatMoney(computedCommission)} KRW</div></div>
          </div>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-xs text-red-600">{error}</div>}
      {message && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-700">{message}</div>}

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 rounded-xl bg-[#1d9e75] px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50">
          {saving ? "저장 중..." : "저장"}
        </button>
        <button onClick={handleDelete} disabled={deleting}
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50">
          {deleting ? "삭제 중..." : "삭제"}
        </button>
      </div>
    </div>
  );
}

export function InvoiceTab({ reservationDocId, patientId, currentUser }: Props) {
  const [allInvoices, setAllInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRecord | null>(null);
  const [staffList, setStaffList] = useState<SettingsStaffRecord[]>([]);

  useEffect(() => {
    getStaffListForSettings()
      .then((list) => setStaffList(list.filter((s) => s.active && (s.role === "admin" || s.role === "coordinator"))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!reservationDocId) return;
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationDocId, patientId]);

  async function loadInvoices() {
    setLoading(true);
    setError("");
    try {
      let invoices: InvoiceRecord[] = [];
      if (patientId) {
        invoices = await getInvoicesByPatientId(patientId);
      } else {
        const { getInvoiceByReservationDocId } = await import("@/lib/invoices");
        const inv = await getInvoiceByReservationDocId(reservationDocId);
        if (inv) invoices = [inv];
      }
      setAllInvoices(invoices);
    } catch (e) {
      console.error("[InvoiceTab] load error:", e);
      setError("인보이스를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteFromList(inv: InvoiceRecord) {
    if (!confirm("인보이스를 삭제할까요?")) return;
    setError("");
    try {
      const result = await deleteInvoice(inv.id, currentUser);
      if (!result.success) { setError(result.message || "삭제 실패"); return; }
      setAllInvoices((prev) => prev.filter((i) => i.id !== inv.id));
    } catch { setError("삭제 중 오류가 발생했습니다."); }
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
    } catch (e) {
      console.error("[InvoiceTab] create error:", e);
      setError("인보이스 생성 중 오류가 발생했습니다.");
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-gray-400">불러오는 중...</div>;

  // 편집 패널 표시 중
  if (editingInvoice) {
    return (
      <InvoiceEditPanel
        invoice={editingInvoice}
        staffList={staffList}
        currentUser={currentUser}
        onSaved={(inv) => {
          setAllInvoices((prev) => prev.map((i) => i.id === inv.id ? inv : i));
          setEditingInvoice(null);
        }}
        onDeleted={() => {
          setAllInvoices((prev) => prev.filter((i) => i.id !== editingInvoice.id));
          setEditingInvoice(null);
        }}
        onCancel={() => setEditingInvoice(null)}
      />
    );
  }

  // 이 예약에 대한 인보이스가 있는지 확인
  const thisReservationInvoice = allInvoices.find((inv) => inv.reservationDocId === reservationDocId);

  return (
    <div className="space-y-3">
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-xs text-red-600">{error}</div>}

      {/* 이 예약 인보이스 없으면 생성 버튼 */}
      {!thisReservationInvoice && (
        <div className="rounded-2xl border-2 border-dashed border-[#dfe3e8] p-4 text-center">
          <div className="text-sm text-gray-400">이 예약에 대한 인보이스가 없습니다.</div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="mt-3 w-full rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
          >
            {creating ? "생성 중..." : "이 예약으로 인보이스 생성"}
          </button>
        </div>
      )}

      {/* 인보이스 목록 */}
      {allInvoices.length > 0 && (
        <div className="space-y-2">
          {allInvoices.length > 1 && (
            <div className="text-xs font-semibold text-gray-500">
              이 환자의 인보이스 {allInvoices.length}건
            </div>
          )}
          {allInvoices.map((inv) => {
            const isThis = inv.reservationDocId === reservationDocId;
            return (
              <div
                key={inv.id}
                className={`rounded-xl border p-3 ${isThis ? "border-[#1d9e75] bg-emerald-50/30" : "border-[#edf0f3] bg-white"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate">{inv.hospitalName || "병원명 미입력"}</span>
                      {inv.doctors?.length > 0 && (
                        <span className="text-xs text-gray-500">{inv.doctors.join(", ")}</span>
                      )}
                      {isThis && (
                        <span className="rounded-full bg-[#1d9e75] px-1.5 py-0.5 text-[10px] font-bold text-white">이 예약</span>
                      )}
                    </div>
                    {inv.surgeryItems && (
                      <div className="mt-0.5 text-xs text-gray-500 truncate">{inv.surgeryItems}</div>
                    )}
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_CLS[inv.status] || "bg-gray-100 text-gray-500"}`}>
                        {STATUS_LABEL[inv.status] || inv.status}
                      </span>
                      {inv.totalAmount > 0 && (
                        <span className="text-xs text-gray-600">₩{formatMoney(inv.totalAmount)}</span>
                      )}
                      {inv.commissionAmount && (
                        <span className="text-xs text-[#1d9e75]">커미션 ₩{formatMoney(inv.commissionAmount)}</span>
                      )}
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
                      onClick={() => handleDeleteFromList(inv)}
                      className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {allInvoices.length === 0 && thisReservationInvoice === undefined && (
        <div className="text-center text-xs text-gray-400 py-4">인보이스가 없습니다.</div>
      )}
    </div>
  );
}
