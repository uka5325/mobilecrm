"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  getOrCreateInvoiceDraft,
  updateInvoice,
  deleteInvoice,
  type InvoiceRecord,
} from "@/lib/invoices";
import { calcCommissionBase, calcCommission, type PaymentMethod } from "@/lib/commissionUtils";
import { getStaffListForSettings, type SettingsStaffRecord } from "@/lib/settings";

function formatMoney(value: number | undefined) {
  if (value === undefined || value === null) return "";
  return Number(value).toLocaleString("ko-KR");
}

function parseMoney(value: string) {
  const n = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function getParamValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export default function InvoiceEditPage() {
  const params = useParams();
  const router = useRouter();
  const reservationDocId = getParamValue(params.reservationId);

  const { currentUser, authReady } = useCurrentUser();
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [staffList, setStaffList] = useState<SettingsStaffRecord[]>([]);

  const [hospitalName, setHospitalName] = useState("");
  const [surgeryDate, setSurgeryDate] = useState("");
  const [surgeryItems, setSurgeryItems] = useState("");
  const [totalAmount, setTotalAmount] = useState(0);
  const [status, setStatus] = useState<"draft" | "confirmed" | "void">("draft");
  const [memo, setMemo] = useState("");

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [cardAmount, setCardAmount] = useState(0);
  const [cashAmount, setCashAmount] = useState(0);
  const [commissionRate, setCommissionRate] = useState<number | "">("");
  const [commissionStaffUid, setCommissionStaffUid] = useState("");
  const [commissionStaffName, setCommissionStaffName] = useState("");

  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!authReady || !currentUser || !reservationDocId) return;
    setLoadingInvoice(true);
    setMessage("");
    getOrCreateInvoiceDraft(reservationDocId, currentUser)
      .then((result) => {
        if (!result.success || !result.invoice) {
          setMessage(result.message || "인보이스를 불러오지 못했습니다.");
          return;
        }
        applyInvoice(result.invoice);
      })
      .catch((e) => { console.error("[InvoicePage] load error:", (e as Error)?.message ?? ""); setMessage("인보이스 로딩 중 오류가 발생했습니다."); })
      .finally(() => setLoadingInvoice(false));
  }, [authReady, currentUser, reservationDocId]);

  useEffect(() => {
    getStaffListForSettings()
      .then((list) => setStaffList(list.filter((s) => s.active && (s.role === "admin" || s.role === "coordinator"))))
      .catch(() => {});
  }, []);

  function applyInvoice(inv: InvoiceRecord) {
    setInvoice(inv);
    setHospitalName(inv.hospitalName || "");
    setSurgeryDate(inv.surgeryDate || "");
    setSurgeryItems(inv.surgeryItems || "");
    setTotalAmount(inv.totalAmount || 0);
    setStatus(inv.status || "draft");
    setMemo(inv.memo || "");
    setPaymentMethod(inv.paymentMethod || "");
    setCardAmount(inv.cardAmount || 0);
    setCashAmount(inv.cashAmount || 0);
    setCommissionRate(inv.commissionRate ?? "");
    setCommissionStaffUid(inv.commissionStaffUid || "");
    setCommissionStaffName(inv.commissionStaffName || "");
  }

  const commissionCalc = useMemo(() => {
    if (!paymentMethod || commissionRate === "") return null;
    const base = calcCommissionBase(totalAmount, paymentMethod as PaymentMethod, cardAmount, cashAmount);
    const amount = calcCommission(base, Number(commissionRate));
    return { base, amount };
  }, [paymentMethod, totalAmount, cardAmount, cashAmount, commissionRate]);

  async function handleSave() {
    if (!currentUser || !invoice) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await updateInvoice(
        invoice.id,
        {
          hospitalName,
          surgeryDate,
          surgeryItems,
          totalAmount,
          paymentMethod: paymentMethod || undefined,
          cardAmount: paymentMethod === "mixed" ? cardAmount : undefined,
          cashAmount: paymentMethod === "mixed" ? cashAmount : undefined,
          commissionRate: commissionRate !== "" ? Number(commissionRate) : undefined,
          commissionStaffUid: commissionStaffUid || undefined,
          commissionStaffName: commissionStaffName || undefined,
          commissionBase: commissionCalc?.base,
          commissionAmount: commissionCalc?.amount,
          memo,
          status,
        },
        currentUser
      );
      if (!result.success || !result.invoice) {
        setMessage(result.message || "저장에 실패했습니다.");
        return;
      }
      router.push("/invoice");
    } catch (e) {
      console.error("[InvoicePage] save error:", (e as Error)?.message ?? "");
      setMessage("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!currentUser || !invoice) return;
    if (!confirm("인보이스를 삭제하시겠습니까?")) return;
    setDeleting(true);
    try {
      const result = await deleteInvoice(invoice.id, currentUser);
      if (result.success) router.back();
      else setMessage(result.message || "삭제 실패");
    } catch (e) {
      console.error("[InvoicePage] delete error:", (e as Error)?.message ?? "");
      setMessage("삭제 중 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  if (!authReady || loadingInvoice) {
    return (
      <div className="rounded-xl border border-black/10 bg-white p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
        인보이스를 불러오는 중...
      </div>
    );
  }

  if (!currentUser) {
    return <div className="rounded-xl border border-black/10 bg-white p-6 text-red-600">로그인 정보를 확인할 수 없습니다.</div>;
  }

  if (!invoice) {
    return <div className="rounded-xl border border-black/10 bg-white p-6 text-red-600">{message || "인보이스 정보를 찾을 수 없습니다."}</div>;
  }

  return (
    <div className="space-y-5 pb-28">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
        <div>
          <div className="text-xs font-bold text-[#1d9e75]">INVOICE</div>
          <h1 className="mt-1 text-xl font-bold text-[#1a1a1a]">{invoice.invoiceId}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => router.back()} className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700">← 뒤로</button>
          <button onClick={handleDelete} disabled={deleting} className="rounded-xl border border-red-200 px-4 py-2 text-sm text-red-600 disabled:opacity-50">
            {deleting ? "삭제 중..." : "삭제"}
          </button>
          <button onClick={handleSave} disabled={saving} className="rounded-xl bg-black px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {message && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${message === "저장 완료" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 환자 정보 */}
        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <div className="mb-4 text-sm font-bold">환자 정보</div>
          <div className="grid grid-cols-[90px_1fr] gap-y-2.5 text-sm">
            <span className="text-gray-500">이름</span><span className="font-semibold">{invoice.patientName}</span>
            <span className="text-gray-500">생년월일</span><span>{invoice.birthDisplay}</span>
            <span className="text-gray-500">담당원장</span><span>{invoice.doctors.join(", ") || "-"}</span>
            <span className="text-gray-500">담당자</span><span>{invoice.coordinators.join(", ") || "-"}</span>
            <span className="text-gray-500">국적</span><span>{invoice.nationality || "-"}</span>
            <span className="text-gray-500">연락처</span><span>{invoice.phone || "-"}</span>
          </div>
        </div>

        {/* 인보이스 입력 */}
        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <div className="mb-4 text-sm font-bold">인보이스 정보</div>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">병원명</label>
              <input
                value={hospitalName}
                onChange={(e) => setHospitalName(e.target.value)}
                className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
                placeholder="병원명 입력"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">수술날짜</label>
              <input
                type="date"
                value={surgeryDate}
                onChange={(e) => setSurgeryDate(e.target.value)}
                className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">담당 원장</label>
              <div className="w-full rounded-xl border border-[#edf0f3] bg-gray-50 px-3 py-2 text-sm text-gray-600">
                {invoice.doctors?.join(", ") || "-"}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">수술/시술명</label>
              <textarea
                value={surgeryItems}
                onChange={(e) => setSurgeryItems(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
                placeholder="수술 및 시술 항목 입력"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">수술비 (KRW)</label>
              <input
                value={totalAmount ? formatMoney(totalAmount) : ""}
                onChange={(e) => setTotalAmount(parseMoney(e.target.value))}
                className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-right text-sm focus:border-[#1d9e75] focus:outline-none"
                placeholder="0"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">상태</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "draft" | "confirmed" | "void")}
                className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
              >
                <option value="draft">임시저장</option>
                <option value="confirmed">확정</option>
                <option value="void">취소</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">메모</label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 커미션 섹션 */}
      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
        <div className="mb-4 text-sm font-bold">커미션 정보</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">결제 방법</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | "")}
              className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
            >
              <option value="">선택</option>
              <option value="cash">현금</option>
              <option value="card">카드</option>
              <option value="mixed">혼합</option>
            </select>
          </div>

          {paymentMethod === "mixed" && (
            <>
              <div>
                <label className="mb-1 block text-xs text-gray-500">카드 금액</label>
                <input
                  value={cardAmount ? formatMoney(cardAmount) : ""}
                  onChange={(e) => setCardAmount(parseMoney(e.target.value))}
                  className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-right text-sm focus:border-[#1d9e75] focus:outline-none"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">현금 금액</label>
                <input
                  value={cashAmount ? formatMoney(cashAmount) : ""}
                  onChange={(e) => setCashAmount(parseMoney(e.target.value))}
                  className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-right text-sm focus:border-[#1d9e75] focus:outline-none"
                  placeholder="0"
                />
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-xs text-gray-500">담당 직원</label>
            <select
              value={commissionStaffUid}
              onChange={(e) => {
                const uid = e.target.value;
                setCommissionStaffUid(uid);
                const found = staffList.find((s) => s.uid === uid);
                setCommissionStaffName(found?.displayName || "");
              }}
              className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-[#1d9e75] focus:outline-none"
            >
              <option value="">선택</option>
              {staffList.map((s) => (
                <option key={s.uid} value={s.uid}>{s.displayName}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">커미션율 (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-right text-sm focus:border-[#1d9e75] focus:outline-none"
              placeholder="예: 15"
            />
          </div>

          {commissionCalc && (
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="mb-1 block text-xs text-gray-500">커미션 계산 결과</label>
              <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">기준액</span>
                  <b>{formatMoney(commissionCalc.base)} KRW</b>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-gray-600">커미션 ({commissionRate}%)</span>
                  <b className="text-[#1d9e75]">{formatMoney(commissionCalc.amount)} KRW</b>
                </div>
                {paymentMethod === "card" && (
                  <div className="mt-1 text-xs text-gray-400">* 카드: VAT(10%) 제외 후 계산</div>
                )}
                {paymentMethod === "mixed" && (
                  <div className="mt-1 text-xs text-gray-400">* 혼합: 카드분 VAT 제외, 현금분 그대로</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 하단 고정 바 */}
      <div className="sticky bottom-0 z-20 rounded-t-2xl border border-black/10 bg-white p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="text-gray-500">수술비 </span>
            <b>{formatMoney(totalAmount)} KRW</b>
            {commissionCalc && (
              <>
                <span className="mx-2 text-gray-300">|</span>
                <span className="text-gray-500">커미션 </span>
                <b className="text-[#1d9e75]">{formatMoney(commissionCalc.amount)} KRW</b>
              </>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-black px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "저장 중..." : "인보이스 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
