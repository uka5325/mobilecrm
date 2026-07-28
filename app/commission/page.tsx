"use client";

import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { getInvoices, type InvoiceRecord } from "@/features/invoices/data/client/invoices";
import { getStaffListForSettings, type SettingsStaffRecord } from "@/features/settings/data/client/settings";
import { paymentMethodLabel } from "@/lib/commissionUtils";
import { buildCsvContent } from "@/lib/csv";
import { monthRange } from "@/lib/dateUtils";
import { formatMoney } from "@/components/invoices/invoiceUi";
import { InvoiceDetailModal } from "@/components/invoices/InvoiceDetailModal";
import { QuickButton } from "@/components/dashboard/QuickButton";

const PAGE_SIZE = 10;

type PageControlsProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
};

function PageControls({ page, totalPages, onPageChange }: PageControlsProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 text-xs text-[#667085]">
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="h-7 rounded-full bg-[#e3f2ee] px-3 font-semibold text-[#0f9b8e] disabled:opacity-40"
      >
        이전
      </button>
      <span>{page} / {totalPages}</span>
      <button
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="h-7 rounded-full bg-[#e3f2ee] px-3 font-semibold text-[#0f9b8e] disabled:opacity-40"
      >
        다음
      </button>
    </div>
  );
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
  // formula injection 방어 + 안전한 quoting/BOM은 공통 유틸에서 처리.
  const csv = buildCsvContent([header, ...rows]);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `커미션내역_${getTodayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CommissionPage() {
  // 직원정보는 sessionStorage 캐시 기반 훅으로 즉시 렌더(진입 "로딩 중..." 깜빡임 제거 + verify-staff 읽기 절감).
  const { currentUser } = useCurrentUser();
  const [staffList, setStaffList] = useState<SettingsStaffRecord[]>([]);

  const [startDate, setStartDate] = useState(getFirstDayOfMonth());
  const [endDate, setEndDate] = useState(getTodayStr());
  const [selectedStaffUid, setSelectedStaffUid] = useState("__all__");
  const [patientSearch, setPatientSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "confirmed" | "draft">("");

  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [quickOffset, setQuickOffset] = useState<-1 | 0 | 1 | null>(null);
  const [recordPage, setRecordPage] = useState(1);
  const [staffPage, setStaffPage] = useState(1);

  useEffect(() => {
    getStaffListForSettings().then((list) => {
      setStaffList(list.filter((s) => s.active && (s.role === "admin" || s.role === "coordinator")));
    }).catch(() => {});
  }, []);

  // 퀵버튼은 날짜 set 직후 즉시 조회하므로(state 비동기 반영 우회) 날짜 오버라이드를 허용.
  async function handleSearch(override?: { start?: string; end?: string }) {
    const s = override?.start ?? startDate;
    const e = override?.end ?? endDate;
    setLoading(true);
    setSearched(false);
    try {
      const isAdmin = currentUser?.role === "admin";
      const filterUid = isAdmin
        ? selectedStaffUid === "__all__" ? undefined : selectedStaffUid
        : currentUser?.uid;

      const results = await getInvoices({
        startDate: s,
        endDate: e,
        status: statusFilter || undefined,
        commissionStaffUid: filterUid,
        patientName: patientSearch || undefined,
      });

      setRecords(results.invoices);
      setCapped(results.capped);
      setSearched(true);
      setRecordPage(1);
      setStaffPage(1);
    } finally {
      setLoading(false);
    }
  }

  // 퀵버튼: 기간 set + 즉시 해당 기간 조회(인보이스·KPI와 동일 모델).
  function quickRange(offset: -1 | 0 | 1) {
    const r = monthRange(offset);
    setQuickOffset(offset);
    setStartDate(r.start);
    setEndDate(r.end);
    handleSearch({ start: r.start, end: r.end });
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

  const recordTotalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentRecordPage = Math.min(recordPage, recordTotalPages);
  const pagedRecords = useMemo(
    () => records.slice((currentRecordPage - 1) * PAGE_SIZE, currentRecordPage * PAGE_SIZE),
    [records, currentRecordPage],
  );

  const staffTotalPages = Math.max(1, Math.ceil(staffSubtotals.length / PAGE_SIZE));
  const currentStaffPage = Math.min(staffPage, staffTotalPages);
  const pagedStaffSubtotals = useMemo(
    () => staffSubtotals.slice((currentStaffPage - 1) * PAGE_SIZE, currentStaffPage * PAGE_SIZE),
    [staffSubtotals, currentStaffPage],
  );

  useEffect(() => {
    if (recordPage !== currentRecordPage) setRecordPage(currentRecordPage);
  }, [currentRecordPage, recordPage]);

  useEffect(() => {
    if (staffPage !== currentStaffPage) setStaffPage(currentStaffPage);
  }, [currentStaffPage, staffPage]);

  if (!currentUser) {
    return (
      <div className="rounded-[28px] bg-white p-6 text-gray-500 shadow-[0_16px_50px_rgba(15,23,42,0.055)]">
        로딩 중...
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12">
      {selectedInvoice && (
        <InvoiceDetailModal invoice={selectedInvoice} title="정산 상세" onClose={() => setSelectedInvoice(null)} />
      )}

      {/* 컨트롤바 */}
      <div className="h-[184px] overflow-hidden rounded-[26px] bg-[#eaf8f3] p-5 shadow-[0_18px_50px_rgba(7,56,58,0.08)] lg:h-[196px] lg:p-6">
        <div className="flex h-full flex-col justify-between">
          {/* 1행: 날짜 + 담당자 */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_112px] items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setQuickOffset(null); setStartDate(e.target.value); }}
              className="h-10 min-w-0 appearance-none rounded-[18px] bg-white px-3 text-xs text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            />
            <span className="flex h-10 items-center text-sm text-[#98a2b3]">~</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setQuickOffset(null); setEndDate(e.target.value); }}
              className="h-10 min-w-0 appearance-none rounded-[18px] bg-white px-3 text-xs text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            />
            {isAdmin ? (
              <select
                value={selectedStaffUid}
                onChange={(e) => setSelectedStaffUid(e.target.value)}
                className="h-10 min-w-0 rounded-[18px] bg-white px-3 text-xs text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
              >
                <option value="__all__">전체 직원</option>
                {staffList.map((s) => (
                  <option key={s.uid} value={s.uid}>{s.displayName}</option>
                ))}
              </select>
            ) : (
              <div className="h-10 min-w-0 truncate rounded-[18px] bg-white px-3 text-xs leading-10 text-[#101828]">
                {currentUser.displayName || "내 커미션"}
              </div>
            )}
          </div>
          {/* 2행: 상태 + 환자명 검색 + 조회 */}
          <div className="grid grid-cols-[112px_minmax(0,1fr)_auto] gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-10 min-w-0 rounded-[18px] bg-white px-3 text-xs text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            >
              <option value="">전체 상태</option>
              <option value="confirmed">확정</option>
              <option value="draft">임시저장</option>
            </select>
            <input
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="환자명 검색"
              className="h-10 min-w-0 rounded-[18px] bg-white px-3 text-xs text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:ring-2 focus:ring-[#bdeee8]"
            />
            <button
              onClick={() => handleSearch()}
              disabled={loading}
              className="h-10 shrink-0 rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-5 text-xs font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition hover:-translate-y-0.5 active:scale-95 disabled:opacity-50"
            >
              {loading ? "조회 중..." : "조회"}
            </button>
          </div>
          {/* 퀵필터 */}
          <div className="rounded-[20px] bg-white p-1">
            <div className="grid grid-cols-3 gap-1">
              <QuickButton active={quickOffset === -1} onClick={() => quickRange(-1)}>전달</QuickButton>
              <QuickButton active={quickOffset === 0} onClick={() => quickRange(0)}>이번 달</QuickButton>
              <QuickButton active={quickOffset === 1} onClick={() => quickRange(1)}>다음 달</QuickButton>
            </div>
          </div>
        </div>
      </div>

      {/* 미조회 안내 */}
      {!searched && (
        <div className="flex items-center justify-center rounded-[28px] bg-white py-20 text-sm text-gray-400 shadow-[0_16px_50px_rgba(15,23,42,0.055)]">
          기간을 선택하고 조회를 누르세요.
        </div>
      )}

      {/* 결과 */}
      {searched && (
        <>
          {capped && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              결과가 많아 일부만 집계되었습니다. 기간을 좁혀 다시 조회하면 정확한 합계를 볼 수 있습니다.
            </div>
          )}
          {/* 합계 카드 */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[22px] bg-[#f8fbfa] px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)] text-gray-700">
              <div className="text-xs font-semibold opacity-60">총 건수</div>
              <div className="mt-0.5 text-lg font-extrabold">{grandTotal.count}건</div>
            </div>
            <div className="rounded-[22px] bg-blue-50 px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)] text-blue-700">
              <div className="text-xs font-semibold opacity-60">총 수술금액</div>
              <div className="mt-0.5 text-lg font-extrabold">{formatMoney(grandTotal.amount)} KRW</div>
            </div>
            <div className="rounded-[22px] bg-[#e3f2ee] px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)] text-[#0f9b8e]">
              <div className="text-xs font-semibold opacity-60">총 커미션</div>
              <div className="mt-0.5 text-lg font-extrabold">{formatMoney(grandTotal.commission)} KRW</div>
            </div>
          </div>

          {/* 담당자별 소계 */}
          {isAdmin && selectedStaffUid === "__all__" && staffSubtotals.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <div className="text-sm font-bold text-gray-800">담당자별 소계</div>
                <div className="text-xs text-[#98a2b3]">총 {staffSubtotals.length}명</div>
              </div>
              {pagedStaffSubtotals.map((s) => (
                <article
                  key={s.name}
                  className="rounded-[24px] bg-white p-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-bold tracking-[-0.04em] text-[#101828]">{s.name}</div>
                      <div className="mt-0.5 text-[11px] text-[#667085]">{s.count}건</div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-[#667085]">
                      <div><span className="text-[#98a2b3]">수술금액 </span>₩{formatMoney(s.totalAmount)}</div>
                      <div className="mt-0.5 font-semibold text-[#0f9b8e]">
                        <span className="text-[#98a2b3]">커미션 </span>₩{formatMoney(s.totalCommission)}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
              <PageControls page={currentStaffPage} totalPages={staffTotalPages} onPageChange={setStaffPage} />
            </div>
          )}

          {/* 환자별 목록 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <div className="text-sm font-bold text-gray-800">환자별 목록</div>
              {records.length > 0 && (
                <button
                  onClick={() => downloadCSV(records)}
                  className="rounded-full bg-[#e3f2ee] px-3 py-1.5 text-xs font-semibold text-[#0f9b8e] transition hover:bg-[#dff7f3]"
                >
                  CSV 다운로드
                </button>
              )}
            </div>
            {records.length === 0 ? (
              <div className="flex items-center justify-center rounded-[28px] bg-white py-16 text-sm text-gray-400 shadow-[0_16px_50px_rgba(15,23,42,0.055)]">
                해당 기간에 커미션 정보가 있는 인보이스가 없습니다.
              </div>
            ) : (
              <>
                {pagedRecords.map((r) => (
                  <article
                    key={r.id}
                    onClick={() => setSelectedInvoice(r)}
                    className="cursor-pointer rounded-[24px] bg-white p-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.05)] transition active:scale-[0.99]"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <h3 className="truncate text-[15px] font-bold tracking-[-0.04em] text-[#101828]">{r.patientName}</h3>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            r.paymentMethod === "card" ? "bg-blue-50 text-blue-700" :
                            r.paymentMethod === "cash" ? "bg-green-50 text-green-700" :
                            r.paymentMethod === "mixed" ? "bg-orange-50 text-orange-700" :
                            "bg-gray-100 text-gray-500"
                          }`}>
                            {paymentMethodLabel(r.paymentMethod)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-[#667085]">
                          <span>{r.hospitalName || "-"}</span>
                          <span>{r.commissionStaffName || "-"}</span>
                          <span>{r.commissionRate !== undefined && r.commissionRate !== null ? `${r.commissionRate}%` : "커미션율 -"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-1.5 border-t border-[#edf0f3] pt-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#667085]">
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                          <span><span className="text-[#98a2b3]">수술비 </span>₩{formatMoney(r.totalAmount || 0)}</span>
                          <span><span className="text-[#98a2b3]">기준액 </span>₩{formatMoney(r.commissionBase || 0)}</span>
                        </div>
                        <div className="font-semibold text-[#0f9b8e]">
                          <span className="text-[#98a2b3]">커미션 </span>₩{formatMoney(r.commissionAmount || 0)}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-gray-400">
                  <span>총 {records.length}건</span>
                  <PageControls page={currentRecordPage} totalPages={recordTotalPages} onPageChange={setRecordPage} />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
