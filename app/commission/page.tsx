"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { getStaffByUid, listenCurrentUser } from "@/lib/auth";
import type { StaffUser } from "@/lib/auth";
import { getInvoices, type InvoiceRecord } from "@/lib/invoices";
import { getStaffListForSettings, type SettingsStaffRecord } from "@/lib/settings";
import { paymentMethodLabel } from "@/lib/commissionUtils";

function formatMoney(value: number | undefined) {
  if (value === undefined || value === null) return "-";
  return Number(value).toLocaleString("ko-KR");
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getFirstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function downloadCSV(records: InvoiceRecord[]) {
  const header = ["환자명", "병원명", "담당자", "결제방법", "최종수술비", "커미션기준액", "커미션율(%)", "커미션액"];
  const rows = records.map((r) => [
    r.patientName,
    r.hospitalName || "",
    r.commissionStaffName || "",
    paymentMethodLabel(r.paymentMethod),
    r.totalAmount ?? "",
    r.commissionBase ?? "",
    r.commissionRate ?? "",
    r.commissionAmount ?? "",
  ]);
  const csv = [header, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `커미션내역_${getTodayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function DetailModal({ invoice, onClose }: { invoice: InvoiceRecord; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-bold">{invoice.patientName} 정산 상세</div>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
        </div>
        <div className="space-y-2 text-sm">
          {[
            ["인보이스 ID", invoice.invoiceId],
            ["병원명", invoice.hospitalName || "-"],
            ["담당원장", invoice.doctors?.join(", ") || "-"],
            ["수술/시술명", invoice.surgeryItems || "-"],
            ["담당자", invoice.commissionStaffName || "-"],
            ["결제방법", paymentMethodLabel(invoice.paymentMethod)],
            ["최종 수술비", formatMoney(invoice.totalAmount) + " KRW"],
            ["커미션 기준액", formatMoney(invoice.commissionBase) + " KRW"],
            ["커미션율", invoice.commissionRate !== undefined ? `${invoice.commissionRate}%` : "-"],
            ["커미션액", formatMoney(invoice.commissionAmount) + " KRW"],
            ["상태", { draft: "임시저장", confirmed: "확정", void: "취소" }[invoice.status] || invoice.status],
            ["메모", invoice.memo || "-"],
          ].map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <span className="w-28 shrink-0 text-gray-500">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          닫기
        </button>
      </div>
    </div>
  );
}

export default function CommissionPage() {
  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [staffList, setStaffList] = useState<SettingsStaffRecord[]>([]);

  const [startDate, setStartDate] = useState(getFirstDayOfMonth());
  const [endDate, setEndDate] = useState(getTodayStr());
  const [selectedStaffUid, setSelectedStaffUid] = useState("__all__");
  const [patientSearch, setPatientSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "confirmed" | "draft">("");

  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);

  useEffect(() => {
    const unsub = listenCurrentUser(async (user: User | null) => {
      if (!user) return;
      const staff = await getStaffByUid(user.uid);
      setCurrentUser(staff);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    getStaffListForSettings().then((list) => {
      setStaffList(list.filter((s) => s.active && (s.role === "admin" || s.role === "coordinator")));
    }).catch(() => {});
  }, []);

  async function handleSearch() {
    setLoading(true);
    setSearched(false);
    try {
      const isAdmin = currentUser?.role === "admin";
      const filterUid = isAdmin
        ? selectedStaffUid === "__all__" ? undefined : selectedStaffUid
        : currentUser?.uid;

      const results = await getInvoices({
        startDate,
        endDate,
        status: statusFilter || undefined,
        commissionStaffUid: filterUid,
        patientName: patientSearch || undefined,
      });

      setRecords(results);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }

  const isAdmin = currentUser?.role === "admin";

  const staffSubtotals = useMemo(() => {
    const map: Record<string, { name: string; count: number; totalAmount: number; totalCommission: number }> = {};
    for (const r of records) {
      const uid = r.commissionStaffUid || "__none__";
      const name = r.commissionStaffName || "미지정";
      if (!map[uid]) map[uid] = { name, count: 0, totalAmount: 0, totalCommission: 0 };
      map[uid].count++;
      map[uid].totalAmount += r.totalAmount || 0;
      map[uid].totalCommission += r.commissionAmount || 0;
    }
    return Object.values(map).sort((a, b) => b.totalCommission - a.totalCommission);
  }, [records]);

  const grandTotal = useMemo(() => ({
    count: records.length,
    amount: records.reduce((s, r) => s + (r.totalAmount || 0), 0),
    commission: records.reduce((s, r) => s + (r.commissionAmount || 0), 0),
  }), [records]);

  if (!currentUser) {
    return (
      <div className="rounded-xl border border-black/10 bg-white p-6 text-gray-500">
        로딩 중...
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12">
      {selectedInvoice && (
        <DetailModal invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
      )}

      {/* 컨트롤바 */}
      <div className="-mx-6 rounded-t-2xl border border-[#edf0f3] bg-[#ecfdf5] px-4 py-4 lg:-mx-8 lg:px-8">
        <div className="flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-10 shrink-0 appearance-none rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          />
          <span className="shrink-0 text-sm text-gray-400">~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-10 shrink-0 appearance-none rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          />
          {isAdmin && (
            <select
              value={selectedStaffUid}
              onChange={(e) => setSelectedStaffUid(e.target.value)}
              className="h-10 shrink-0 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
            >
              <option value="__all__">전체 직원</option>
              {staffList.map((s) => (
                <option key={s.uid} value={s.uid}>{s.displayName}</option>
              ))}
            </select>
          )}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-10 shrink-0 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          >
            <option value="">전체 상태</option>
            <option value="confirmed">확정</option>
            <option value="draft">임시저장</option>
          </select>
        </div>
        <div className="mt-2 flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <input
            value={patientSearch}
            onChange={(e) => setPatientSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="환자명 검색"
            className="h-10 flex-1 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            className="h-10 shrink-0 rounded-xl bg-black px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
          >
            {loading ? "조회 중..." : "조회"}
          </button>
        </div>
      </div>

      {/* 결과 */}
      {searched && (
        <>
          {/* 합계 카드 */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-700">
              <div className="text-xs font-semibold opacity-60">총 건수</div>
              <div className="mt-0.5 text-lg font-extrabold">{grandTotal.count}건</div>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-700">
              <div className="text-xs font-semibold opacity-60">총 수술금액</div>
              <div className="mt-0.5 text-lg font-extrabold">{formatMoney(grandTotal.amount)} KRW</div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700">
              <div className="text-xs font-semibold opacity-60">총 커미션</div>
              <div className="mt-0.5 text-lg font-extrabold">{formatMoney(grandTotal.commission)} KRW</div>
            </div>
          </div>

          {/* 담당자별 소계 */}
          {isAdmin && selectedStaffUid === "__all__" && staffSubtotals.length > 0 && (
            <div className="-mx-6 border-t border-[#edf0f3] bg-white lg:-mx-8">
              <div className="flex items-center justify-between px-6 py-4 lg:px-8">
                <div className="text-sm font-bold text-gray-800">담당자별 소계</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-[#edf0f3] bg-[#f8fafc]">
                    <tr className="text-xs text-gray-500">
                      <th className="px-6 py-3 text-left lg:px-8">담당자</th>
                      <th className="px-4 py-3 text-right">건수</th>
                      <th className="px-4 py-3 text-right">수술금액 합계</th>
                      <th className="px-4 py-3 text-right">커미션 합계</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f1f3f5]">
                    {staffSubtotals.map((s) => (
                      <tr key={s.name}>
                        <td className="px-6 py-3 font-medium text-gray-800 lg:px-8">{s.name}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{s.count}건</td>
                        <td className="px-4 py-3 text-right text-gray-700">{formatMoney(s.totalAmount)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#1d9e75]">{formatMoney(s.totalCommission)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 상세 테이블 */}
          <div className="-mx-6 border-t border-[#edf0f3] bg-white lg:-mx-8">
            <div className="flex items-center justify-between px-6 py-4 lg:px-8">
              <div className="text-sm font-bold text-gray-800">상세 내역</div>
              {records.length > 0 && (
                <button
                  onClick={() => downloadCSV(records)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  CSV 다운로드
                </button>
              )}
            </div>
            {records.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-gray-400">
                해당 기간에 커미션 정보가 있는 인보이스가 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="border-b border-[#edf0f3] bg-[#f8fafc]">
                    <tr className="text-xs text-gray-500">
                      <th className="px-6 py-3 text-left lg:px-8">환자명</th>
                      <th className="px-4 py-3 text-left">병원명</th>
                      <th className="px-4 py-3 text-left">담당자</th>
                      <th className="px-4 py-3 text-left">결제방법</th>
                      <th className="px-4 py-3 text-right">최종 수술비</th>
                      <th className="px-4 py-3 text-right">커미션 기준액</th>
                      <th className="px-4 py-3 text-right">커미션율</th>
                      <th className="px-4 py-3 text-right">커미션액</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f1f3f5]">
                    {records.map((r) => (
                      <tr
                        key={r.id}
                        className="cursor-pointer whitespace-nowrap transition hover:bg-[#f8fafc]"
                        onClick={() => setSelectedInvoice(r)}
                      >
                        <td className="px-6 py-3 font-semibold text-gray-800 lg:px-8">{r.patientName}</td>
                        <td className="px-4 py-3 text-gray-600">{r.hospitalName || "-"}</td>
                        <td className="px-4 py-3 text-gray-600">{r.commissionStaffName || "-"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.paymentMethod === "card" ? "bg-blue-50 text-blue-700" :
                            r.paymentMethod === "cash" ? "bg-green-50 text-green-700" :
                            r.paymentMethod === "mixed" ? "bg-orange-50 text-orange-700" :
                            "bg-gray-100 text-gray-500"
                          }`}>
                            {paymentMethodLabel(r.paymentMethod)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{formatMoney(r.totalAmount)}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{formatMoney(r.commissionBase)}</td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {r.commissionRate !== undefined && r.commissionRate !== null ? `${r.commissionRate}%` : "-"}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-[#1d9e75]">
                          {formatMoney(r.commissionAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
