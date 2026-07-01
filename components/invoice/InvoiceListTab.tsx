"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getInvoices, type InvoiceRecord, type InvoiceListFilter } from "@/lib/invoices";
import { QuickButton } from "@/components/dashboard/QuickButton";
import { toDate } from "@/lib/settingsUtils";

function pad(n: number) { return String(n).padStart(2, "0"); }
function monthRange(offset: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const y = d.getFullYear(), m = d.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  return { start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
}

function DetailModal({ invoice, onClose }: { invoice: InvoiceRecord; onClose: () => void }) {
  function fmt(v: number | undefined) {
    if (v === undefined || v === null) return "-";
    return Number(v).toLocaleString("ko-KR");
  }
  const payLabel: Record<string, string> = { cash: "현금", card: "카드", mixed: "혼합" };
  const statusLabel: Record<string, string> = { draft: "임시저장", confirmed: "확정", void: "취소" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-bold">{invoice.patientName} 인보이스 상세</div>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
        </div>
        <div className="space-y-2 text-sm">
          {([
            ["인보이스 ID", invoice.invoiceId],
            ["병원명", invoice.hospitalName || "-"],
            ["수술날짜", invoice.surgeryDate || "-"],
            ["담당원장", invoice.doctors?.join(", ") || "-"],
            ["수술/시술명", invoice.surgeryItems || "-"],
            ["담당자", invoice.commissionStaffName || "-"],
            ["결제방법", payLabel[invoice.paymentMethod ?? ""] || "-"],
            ["최종 수술비", fmt(invoice.totalAmount) + " KRW"],
            ["커미션 기준액", fmt(invoice.commissionBase) + " KRW"],
            ["커미션율", invoice.commissionRate !== undefined ? `${invoice.commissionRate}%` : "-"],
            ["커미션액", fmt(invoice.commissionAmount) + " KRW"],
            ["상태", statusLabel[invoice.status] || invoice.status],
            ["메모", invoice.memo || "-"],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <span className="w-28 shrink-0 text-gray-500">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </div>
        <button onClick={onClose} className="mt-5 w-full rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200">
          닫기
        </button>
      </div>
    </div>
  );
}

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
  const d = toDate(value);
  if (!d) return "-";
  return (
    d.getFullYear() +
    "." +
    String(d.getMonth() + 1).padStart(2, "0") +
    "." +
    String(d.getDate()).padStart(2, "0")
  );
}

export function InvoiceListTab() {
  const router = useRouter();

  const [startDate, setStartDate] = useState(() => monthRange(0).start);
  const [endDate, setEndDate] = useState(() => monthRange(0).end);
  const [statusFilter, setStatusFilter] = useState<"" | "draft" | "confirmed" | "void">("");
  const [nameQuery, setNameQuery] = useState("");
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [capped, setCapped] = useState(false);
  // 온디맨드: 진입 시 자동 조회하지 않는다(읽기 비용 절감). 조회/퀵버튼을 눌러야 읽음.
  const [searched, setSearched] = useState(false);

  // 인자로 받은 기간/상태로 조회(퀵버튼은 set 직후 호출 — state 비동기 반영을 우회).
  async function load(opts?: { start?: string; end?: string; status?: typeof statusFilter }) {
    const s = opts?.start ?? startDate;
    const e = opts?.end ?? endDate;
    const st = opts?.status ?? statusFilter;
    setLoading(true);
    setLoadError("");
    try {
      const filters: InvoiceListFilter = {
        startDate: s,
        endDate: e,
        status: st || undefined,
      };
      // 서버가 surgeryDate 범위 + 권한 스코프로 해당 기간만 반환 → 합계/건수 정확, 읽기 절감.
      const result = await getInvoices(filters);
      setInvoices(result.invoices);
      setCapped(result.capped);
      setSearched(true);
    } catch (e) {
      console.error("[InvoiceListTab] load error:", (e as Error)?.message ?? "");
      setLoadError("인보이스 목록을 불러오지 못했습니다. F12 콘솔에서 오류를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }

  // 퀵버튼: 기간 set + 즉시 해당 기간 조회.
  function quickRange(offset: number) {
    const r = monthRange(offset);
    setStartDate(r.start);
    setEndDate(r.end);
    load({ start: r.start, end: r.end });
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
      totalAmount: confirmed.reduce((s, i) => s + (i.totalAmount || 0), 0),
      totalCommission: confirmed.reduce((s, i) => s + (i.commissionAmount || 0), 0),
    };
  }, [filtered]);

  async function handleDelete(inv: typeof filtered[0], e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`${inv.patientName}의 인보이스를 삭제할까요?`)) return;
    try {
      const { auth } = await import("@/lib/firebase");
      const { deleteInvoice } = await import("@/lib/invoices");
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) { alert("로그인 정보를 확인할 수 없습니다."); return; }
      const { getStaffByUid } = await import("@/lib/auth");
      const staff = await getStaffByUid();
      if (!staff) { alert("직원 정보를 찾을 수 없습니다."); return; }
      const result = await deleteInvoice(inv.id, staff);
      if (result.success) setInvoices((prev) => prev.filter((i) => i.id !== inv.id));
      else alert(result.message || "삭제 실패");
    } catch {
      alert("삭제 중 오류가 발생했습니다.");
    }
  }

  return (
    <>
    {selectedInvoice && <DetailModal invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}
    <div className="flex flex-col gap-4">
      {/* 컨트롤바 */}
      <div className="-mx-6 rounded-t-2xl border border-[#edf0f3] bg-[#ecfdf5] px-4 py-4 lg:-mx-8 lg:px-8">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-10 min-w-0 flex-1 appearance-none rounded-xl border border-[#dfe3e8] bg-white px-2 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          />
          <span className="shrink-0 text-sm text-gray-400">~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-10 min-w-0 flex-1 appearance-none rounded-xl border border-[#dfe3e8] bg-white px-2 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-10 min-w-0 flex-1 rounded-xl border border-[#dfe3e8] bg-white px-2 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          >
            <option value="">전체 상태</option>
            <option value="draft">임시저장</option>
            <option value="confirmed">확정</option>
            <option value="void">취소</option>
          </select>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            placeholder="환자명 검색"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          />
          <button
            onClick={() => load()}
            disabled={loading}
            className="h-10 shrink-0 rounded-xl bg-[#1d9e75] px-5 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-60"
          >
            {loading ? "조회 중…" : "조회"}
          </button>
        </div>
        {/* 퀵필터 */}
        <div className="mt-3 flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <QuickButton onClick={() => quickRange(-1)}>전달</QuickButton>
          <QuickButton onClick={() => quickRange(0)}>이번 달</QuickButton>
          <QuickButton onClick={() => quickRange(1)}>다음 달</QuickButton>
        </div>
      </div>

      {/* KPI — 조회 후에만 표시(커미션·대시보드와 통일) */}
      {searched && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "전체", value: kpi.total + "건", className: "bg-gray-50 border-gray-200 text-gray-700" },
            { label: "확정", value: kpi.confirmed + "건", className: "bg-emerald-50 border-emerald-200 text-emerald-700" },
            { label: "확정 수술비", value: `₩${formatMoney(kpi.totalAmount)}`, className: "bg-blue-50 border-blue-200 text-blue-700" },
            { label: "확정 커미션", value: `₩${formatMoney(kpi.totalCommission)}`, className: "bg-orange-50 border-orange-200 text-orange-700" },
          ].map((box) => (
            <div key={box.label} className={`rounded-xl border px-4 py-3 ${box.className}`}>
              <div className="text-xs font-semibold opacity-60">{box.label}</div>
              <div className="mt-0.5 text-lg font-extrabold">{box.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 테이블 */}
      <div className="-mx-6 overflow-hidden border-t border-[#edf0f3] bg-white lg:-mx-8">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400">
            데이터 로딩 중...
          </div>
        ) : loadError ? (
          <div className="flex items-center justify-center py-16 text-sm text-red-500">
            {loadError}
          </div>
        ) : !searched ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400">
            기간을 선택하고 조회를 누르세요.
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
                  {["날짜", "환자명", "병원명", "수술명", "담당원장", "상태", "수술비", "커미션", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f1f3f5]">
                {filtered.map((inv) => (
                  <tr
                    key={inv.id}
                    className="cursor-pointer whitespace-nowrap transition hover:bg-[#f8fafc]"
                    onClick={() => router.push(`/invoices/${inv.reservationDocId}`)}
                  >
                    <td className="px-4 py-3 text-gray-500">{inv.surgeryDate || formatDate(inv.createdAt)}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{inv.patientName}</td>
                    <td className="px-4 py-3 text-gray-600">{inv.hospitalName || "-"}</td>
                    <td className="max-w-[140px] overflow-hidden text-ellipsis px-4 py-3 text-gray-600">{inv.surgeryItems || "-"}</td>
                    <td className="px-4 py-3 text-gray-600">{inv.doctors.join(", ") || "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[inv.status] || "bg-gray-100 text-gray-500"}`}>
                        {STATUS_LABEL[inv.status] || inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-700">
                      ₩{formatMoney(inv.totalAmount || 0)}
                    </td>
                    <td className="px-4 py-3 text-[#1d9e75]">
                      {inv.commissionAmount ? `₩${formatMoney(inv.commissionAmount)}` : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); router.push(`/invoices/${inv.reservationDocId}`); }}
                          className="px-2 py-1 text-xs text-blue-600 hover:underline"
                        >
                          수정
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedInvoice(inv); }}
                          className="px-2 py-1 text-xs text-gray-500 hover:underline"
                        >
                          보기
                        </button>
                        <button
                          onClick={(e) => handleDelete(inv, e)}
                          className="px-2 py-1 text-xs text-red-500 hover:underline"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 건수 / 상한 경고 */}
      <div className="flex items-center justify-center gap-2 border-t border-[#edf0f3] pt-3 text-xs text-gray-400">
        <span>총 {filtered.length}건</span>
        {capped && (
          <span className="text-amber-600">
            · 결과가 많아 일부만 표시됩니다. 기간을 좁혀 다시 조회하세요.
          </span>
        )}
      </div>
    </div>
    </>
  );
}
