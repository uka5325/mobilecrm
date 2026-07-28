"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getInvoices, type InvoiceRecord, type InvoiceListFilter } from "@/features/invoices/data/client/invoices";
import { QuickButton } from "@/components/dashboard/QuickButton";
import { toDate } from "@/lib/dateUtils";
import { monthRange } from "@/lib/dateUtils";
import { formatMoney, INVOICE_STATUS_CLASS, INVOICE_STATUS_LABEL } from "@/components/invoices/invoiceUi";
import { InvoiceDetailModal } from "@/components/invoices/InvoiceDetailModal";

const PAGE_SIZE = 10;

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
  const [quickOffset, setQuickOffset] = useState<-1 | 0 | 1 | null>(0);
  const [capped, setCapped] = useState(false);
  // 온디맨드: 진입 시 자동 조회하지 않는다(읽기 비용 절감). 조회/퀵버튼을 눌러야 읽음.
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);

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
      setPage(1);
    } catch (e) {
      console.error("[InvoiceListTab] load error:", (e as Error)?.message ?? "");
      setLoadError("인보이스 목록을 불러오지 못했습니다. F12 콘솔에서 오류를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }

  // 퀵버튼: 기간 set + 즉시 해당 기간 조회.
  function quickRange(offset: -1 | 0 | 1) {
    const r = monthRange(offset);
    setQuickOffset(offset);
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedInvoices = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  async function handleDelete(inv: typeof filtered[0], e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`${inv.patientName}의 인보이스를 삭제할까요?`)) return;
    try {
      const { auth } = await import("@/lib/firebase");
      const { deleteInvoice } = await import("@/features/invoices/data/client/invoices");
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
    {selectedInvoice && (
      <InvoiceDetailModal
        invoice={selectedInvoice}
        title="인보이스 상세"
        onClose={() => setSelectedInvoice(null)}
        onEdit={() => router.push(`/invoices/${selectedInvoice.reservationDocId}`)}
      />
    )}
    <div className="flex flex-col gap-4">
      {/* 컨트롤바 */}
      <div className="h-[184px] overflow-hidden rounded-[26px] bg-[#eaf8f3] p-5 shadow-[0_18px_50px_rgba(7,56,58,0.08)] lg:h-[196px] lg:p-6">
        <div className="flex h-full flex-col justify-between">
          <div className="grid grid-cols-[minmax(88px,1fr)_auto_minmax(88px,1fr)_104px] items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setQuickOffset(null); setStartDate(e.target.value); }}
              className="h-10 min-w-0 appearance-none whitespace-nowrap rounded-[18px] bg-white px-1.5 text-[10px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            />
            <span className="flex h-10 items-center text-sm text-[#98a2b3]">~</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setQuickOffset(null); setEndDate(e.target.value); }}
              className="h-10 min-w-0 appearance-none whitespace-nowrap rounded-[18px] bg-white px-1.5 text-[10px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-10 min-w-0 rounded-[18px] bg-white px-2 text-[10px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            >
              <option value="">전체 상태</option>
              <option value="draft">임시저장</option>
              <option value="confirmed">확정</option>
              <option value="void">취소</option>
            </select>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <input
              type="text"
              placeholder="환자명 검색"
              value={nameQuery}
              onChange={(e) => { setNameQuery(e.target.value); setPage(1); }}
              className="h-10 min-w-0 rounded-[18px] bg-white px-3 text-xs text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:ring-2 focus:ring-[#bdeee8]"
            />
            <button
              onClick={() => load()}
              disabled={loading}
              className="h-10 shrink-0 rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-5 text-[11px] font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition active:scale-95 disabled:opacity-60"
            >
              {loading ? "조회 중…" : "조회"}
            </button>
          </div>
          <div className="rounded-[20px] bg-white p-1">
            <div className="grid grid-cols-3 gap-1">
              <QuickButton active={quickOffset === -1} onClick={() => quickRange(-1)}>전달</QuickButton>
              <QuickButton active={quickOffset === 0} onClick={() => quickRange(0)}>이번 달</QuickButton>
              <QuickButton active={quickOffset === 1} onClick={() => quickRange(1)}>다음 달</QuickButton>
            </div>
          </div>
        </div>
      </div>

      {/* KPI — 조회 후에만 표시(커미션·대시보드와 통일) */}
      {searched && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "전체", value: kpi.total + "건", className: "bg-gray-50 border-gray-200 text-gray-700" },
            { label: "확정", value: kpi.confirmed + "건", className: "bg-[#e3f2ee] border-emerald-200 text-[#0f9b8e]" },
            { label: "확정 수술비", value: `₩${formatMoney(kpi.totalAmount)}`, className: "bg-blue-50 border-blue-200 text-blue-700" },
            { label: "확정 커미션", value: `₩${formatMoney(kpi.totalCommission)}`, className: "bg-orange-50 border-orange-200 text-orange-700" },
          ].map((box) => (
            <div key={box.label} className={`rounded-[22px] px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)] ${box.className.replace("border ", "")}`}>
              <div className="text-xs font-semibold opacity-60">{box.label}</div>
              <div className="mt-0.5 text-lg font-extrabold">{box.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 인보이스 리스트 */}
      <div className="space-y-2.5">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400">
            데이터 로딩 중...
          </div>
        ) : loadError ? (
          <div className="flex items-center justify-center py-16 text-sm text-red-500">
            {loadError}
          </div>
        ) : !searched ? (
          <div className="flex items-center justify-center rounded-[28px] bg-white py-20 text-sm text-gray-400 shadow-[0_16px_50px_rgba(15,23,42,0.055)]">
            기간을 선택하고 조회를 누르세요.
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400">
            조건에 맞는 인보이스가 없습니다.
          </div>
        ) : (
          <>
            {pagedInvoices.map((inv) => (
              <article
                key={inv.id}
                className="rounded-[24px] bg-white p-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]"
              >
                <div className="flex min-w-0 items-start justify-between gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className="truncate text-[15px] font-bold tracking-[-0.04em] text-[#101828]">{inv.patientName}</h3>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${INVOICE_STATUS_CLASS[inv.status] || "bg-gray-100 text-gray-500"}`}>
                        {INVOICE_STATUS_LABEL[inv.status] || inv.status}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-[#667085]">
                      <span>{inv.surgeryDate || formatDate(inv.createdAt)}</span>
                      <span>{inv.hospitalName || "-"}</span>
                      <span>{inv.doctors.join(", ") || "-"}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 border-t border-[#edf0f3] pt-1.5">
                  <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 text-xs text-[#667085]">
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                        <span><span className="text-[#98a2b3]">수술비 </span>₩{formatMoney(inv.totalAmount || 0)}</span>
                        <span><span className="text-[#98a2b3]">커미션 </span>{inv.commissionAmount ? `₩${formatMoney(inv.commissionAmount)}` : "-"}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 lg:justify-end">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedInvoice(inv); }}
                        className="h-6 rounded-[13px] bg-[#e3f2ee] px-2 text-[10px] font-semibold text-[#0f9b8e] transition active:scale-95"
                      >
                        보기
                      </button>
                      <button
                        onClick={(e) => handleDelete(inv, e)}
                        className="h-6 rounded-[13px] bg-red-50 px-2 text-[10px] font-semibold text-red-500 transition active:scale-95"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </>
        )}
      </div>

      {/* 건수 / 상한 경고 */}
      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-[#edf0f3] pt-3 text-xs text-gray-400">
        <span>총 {filtered.length}건</span>
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="h-7 rounded-full bg-[#e3f2ee] px-3 font-semibold text-[#0f9b8e] disabled:opacity-40"
            >
              이전
            </button>
            <span className="text-[#667085]">{currentPage} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="h-7 rounded-full bg-[#e3f2ee] px-3 font-semibold text-[#0f9b8e] disabled:opacity-40"
            >
              다음
            </button>
          </div>
        )}
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
