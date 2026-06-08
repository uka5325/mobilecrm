"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getInvoices, type InvoiceRecord, type InvoiceListFilter } from "@/lib/invoices";
import { todayString } from "@/lib/dateUtils";

const STATUS_LABEL: Record<string, string> = {
  draft: "임시저장",
  confirmed: "확정",
  void: "취소",
};

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-500",
  confirmed: "bg-emerald-50 text-emerald-700",
  void: "bg-red-50 text-red-500",
};

function formatMoney(value: number) {
  return value.toLocaleString("ko-KR");
}

function formatDate(value: unknown): string {
  try {
    const d =
      value && typeof (value as any).toDate === "function"
        ? (value as any).toDate()
        : value instanceof Date
          ? value
          : new Date(value as any);
    if (Number.isNaN(d.getTime())) return "-";
    return (
      d.getFullYear() +
      "." +
      String(d.getMonth() + 1).padStart(2, "0") +
      "." +
      String(d.getDate()).padStart(2, "0")
    );
  } catch {
    return "-";
  }
}

export function InvoiceListTab() {
  const router = useRouter();
  const today = todayString();
  const firstOfMonth = today.slice(0, 7) + "-01";

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState<"" | "draft" | "confirmed" | "void">("");
  const [nameQuery, setNameQuery] = useState("");
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    load();
  }, [startDate, endDate, statusFilter]);

  async function load() {
    setLoading(true);
    try {
      const filters: InvoiceListFilter = {
        startDate,
        endDate,
        status: statusFilter || undefined,
      };
      const data = await getInvoices(filters);
      setInvoices(data);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!nameQuery.trim()) return invoices;
    const q = nameQuery.toLowerCase();
    return invoices.filter((inv) => inv.patientName.toLowerCase().includes(q));
  }, [invoices, nameQuery]);

  const kpi = useMemo(() => {
    const confirmed = filtered.filter((i) => i.status === "confirmed");
    return {
      total: filtered.length,
      confirmed: confirmed.length,
      eventTotal: confirmed.reduce((s, i) => s + i.eventTotal, 0),
      balance: confirmed.reduce((s, i) => s + i.balanceAmount, 0),
    };
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="h-9 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm focus:border-[#1d9e75] focus:outline-none"
        />
        <span className="text-sm text-gray-400">~</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="h-9 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm focus:border-[#1d9e75] focus:outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-9 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm focus:border-[#1d9e75] focus:outline-none"
        >
          <option value="">전체 상태</option>
          <option value="draft">임시저장</option>
          <option value="confirmed">확정</option>
          <option value="void">취소</option>
        </select>
        <input
          type="text"
          placeholder="환자명 검색"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          className="h-9 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm focus:border-[#1d9e75] focus:outline-none"
        />
        <button
          onClick={load}
          className="h-9 rounded-xl bg-gray-100 px-3 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          새로고침
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { label: "전체", value: kpi.total, className: "bg-gray-50 border-gray-200" },
          { label: "확정", value: kpi.confirmed, className: "bg-emerald-50 border-emerald-200 text-emerald-700" },
          { label: "이벤트가 합계", value: `₩${formatMoney(kpi.eventTotal)}`, className: "bg-blue-50 border-blue-200 text-blue-700" },
          { label: "잔금 합계", value: `₩${formatMoney(kpi.balance)}`, className: "bg-orange-50 border-orange-200 text-orange-700" },
        ].map((box) => (
          <div key={box.label} className={`rounded-xl border px-4 py-2.5 ${box.className}`}>
            <div className="text-xs font-semibold opacity-70">{box.label}</div>
            <div className="text-lg font-extrabold">{box.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-[#edf0f3] bg-white">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400">
            데이터 로딩 중...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400">
            조건에 맞는 인보이스가 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[#edf0f3] bg-[#f8fafc]">
                <tr>
                  {["날짜", "환자명", "담당원장", "상태", "이벤트가", "잔금", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f1f3f5]">
                {filtered.map((inv) => (
                  <tr
                    key={inv.id}
                    className="cursor-pointer transition hover:bg-[#f8fafc]"
                    onClick={() => router.push(`/invoices/${inv.reservationDocId}`)}
                  >
                    <td className="px-4 py-3 text-gray-500">{formatDate(inv.createdAt)}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{inv.patientName}</td>
                    <td className="px-4 py-3 text-gray-600">{inv.doctors.join(", ") || "-"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[inv.status] || "bg-gray-100 text-gray-500"}`}
                      >
                        {STATUS_LABEL[inv.status] || inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-700">
                      ₩{formatMoney(inv.eventTotal)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      ₩{formatMoney(inv.balanceAmount)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/invoices/${inv.reservationDocId}`);
                        }}
                        className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
                      >
                        보기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
