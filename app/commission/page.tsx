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

type PageControlsProps = { page: number; totalPages: number; onPageChange: (page: number) => void };

function PageControls({ page, totalPages, onPageChange }: PageControlsProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 text-xs text-[#667085]">
      <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} className="h-7 rounded-full bg-[#e3f2ee] px-3 font-semibold text-[#0f9b8e] disabled:opacity-40">이전</button>
      <span>{page} / {totalPages}</span>
      <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="h-7 rounded-full bg-[#e3f2ee] px-3 font-semibold text-[#0f9b8e] disabled:opacity-40">다음</button>
    </div>
  );
}

function getTodayStr() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getFirstDayOfMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function downloadCSV(records: InvoiceRecord[]) {
  const header = ["환자명", "병원명", "담당자", "결제방법", "최종수술비", "커미션기준액", "커미션율(%)", "커미션액"];
  const rows = records.map((record) => [record.patientName, record.hospitalName || "", record.commissionStaffName || "", paymentMethodLabel(record.paymentMethod), record.totalAmount ?? "", record.commissionBase ?? "", record.commissionRate ?? "", record.commissionAmount ?? ""]);
  const blob = new Blob([buildCsvContent([header, ...rows])], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `커미션내역_${getTodayStr()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function paymentClass(method: InvoiceRecord["paymentMethod"]) {
  if (method === "card") return "bg-blue-50 text-blue-700";
  if (method === "cash") return "bg-green-50 text-green-700";
  if (method === "mixed") return "bg-orange-50 text-orange-700";
  return "bg-gray-100 text-gray-500";
}

function CommissionMobileCard({ record, onClick }: { record: InvoiceRecord; onClick: () => void }) {
  return (
    <article onClick={onClick} className="cursor-pointer rounded-[24px] bg-white p-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.05)] transition active:scale-[0.99]">
      <div className="flex min-w-0 items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[15px] font-bold tracking-[-0.04em] text-[#101828]">{record.patientName}</h3>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${paymentClass(record.paymentMethod)}`}>{paymentMethodLabel(record.paymentMethod)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-[#667085]">
            <span>{record.hospitalName || "-"}</span><span>{record.commissionStaffName || "-"}</span><span>{record.commissionRate !== undefined && record.commissionRate !== null ? `${record.commissionRate}%` : "커미션율 -"}</span>
          </div>
        </div>
      </div>
      <div className="mt-1.5 border-t border-[#edf0f3] pt-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#667085]">
          <div className="flex flex-wrap gap-x-2 gap-y-0.5"><span><span className="text-[#98a2b3]">수술비 </span>₩{formatMoney(record.totalAmount || 0)}</span><span><span className="text-[#98a2b3]">기준액 </span>₩{formatMoney(record.commissionBase || 0)}</span></div>
          <div className="font-semibold text-[#0f9b8e]"><span className="text-[#98a2b3]">커미션 </span>₩{formatMoney(record.commissionAmount || 0)}</div>
        </div>
      </div>
    </article>
  );
}

export default function CommissionPage() {
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
  const [quickOffset, setQuickOffset] = useState<-1 | 0 | 1 | null>(0);
  const [recordPage, setRecordPage] = useState(1);
  const [staffPage, setStaffPage] = useState(1);

  useEffect(() => {
    getStaffListForSettings().then((list) => setStaffList(list.filter((staff) => staff.active && (staff.role === "admin" || staff.role === "coordinator")))).catch(() => {});
  }, []);

  async function handleSearch(override?: { start?: string; end?: string }) {
    const start = override?.start ?? startDate;
    const end = override?.end ?? endDate;
    setLoading(true);
    setSearched(false);
    try {
      const admin = currentUser?.role === "admin";
      const filterUid = admin ? (selectedStaffUid === "__all__" ? undefined : selectedStaffUid) : currentUser?.uid;
      const results = await getInvoices({ startDate: start, endDate: end, status: statusFilter || undefined, commissionStaffUid: filterUid, patientName: patientSearch || undefined });
      setRecords(results.invoices);
      setCapped(results.capped);
      setSearched(true);
      setRecordPage(1);
      setStaffPage(1);
    } finally {
      setLoading(false);
    }
  }

  function quickRange(offset: -1 | 0 | 1) {
    const range = monthRange(offset);
    setQuickOffset(offset);
    setStartDate(range.start);
    setEndDate(range.end);
    void handleSearch({ start: range.start, end: range.end });
  }

  const isAdmin = currentUser?.role === "admin";
  const staffSubtotals = useMemo(() => {
    const map: Record<string, { name: string; count: number; totalAmount: number; totalCommission: number }> = {};
    for (const record of records) {
      const uid = record.commissionStaffUid || "__none__";
      const name = record.commissionStaffName || "미지정";
      if (!map[uid]) map[uid] = { name, count: 0, totalAmount: 0, totalCommission: 0 };
      map[uid].count += 1;
      map[uid].totalAmount += record.totalAmount || 0;
      map[uid].totalCommission += record.commissionAmount || 0;
    }
    return Object.values(map).sort((a, b) => b.totalCommission - a.totalCommission);
  }, [records]);

  const grandTotal = useMemo(() => ({ count: records.length, amount: records.reduce((sum, record) => sum + (record.totalAmount || 0), 0), commission: records.reduce((sum, record) => sum + (record.commissionAmount || 0), 0) }), [records]);
  const recordTotalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentRecordPage = Math.min(recordPage, recordTotalPages);
  const pagedRecords = useMemo(() => records.slice((currentRecordPage - 1) * PAGE_SIZE, currentRecordPage * PAGE_SIZE), [records, currentRecordPage]);
  const staffTotalPages = Math.max(1, Math.ceil(staffSubtotals.length / PAGE_SIZE));
  const currentStaffPage = Math.min(staffPage, staffTotalPages);
  const pagedStaffSubtotals = useMemo(() => staffSubtotals.slice((currentStaffPage - 1) * PAGE_SIZE, currentStaffPage * PAGE_SIZE), [staffSubtotals, currentStaffPage]);

  useEffect(() => { if (recordPage !== currentRecordPage) setRecordPage(currentRecordPage); }, [currentRecordPage, recordPage]);
  useEffect(() => { if (staffPage !== currentStaffPage) setStaffPage(currentStaffPage); }, [currentStaffPage, staffPage]);

  if (!currentUser) return <div className="rounded-[28px] bg-white p-6 text-gray-500 shadow-[0_16px_50px_rgba(15,23,42,0.055)]">로딩 중...</div>;

  return (
    <div className="flex flex-col gap-4 pb-12">
      {selectedInvoice && <InvoiceDetailModal invoice={selectedInvoice} title="정산 상세" onClose={() => setSelectedInvoice(null)} />}

      <div className="h-[184px] overflow-hidden rounded-[26px] bg-[#eaf8f3] p-5 shadow-[0_18px_50px_rgba(7,56,58,0.08)] lg:h-auto lg:p-3 lg:shadow-none">
        <div className="flex h-full flex-col justify-between lg:gap-2">
          <div className="grid grid-cols-[minmax(88px,1fr)_auto_minmax(88px,1fr)_104px] items-center gap-1.5 lg:grid-cols-[minmax(130px,1fr)_auto_minmax(130px,1fr)_minmax(120px,0.8fr)_minmax(110px,0.7fr)_minmax(180px,1.2fr)_auto] lg:gap-2">
            <input type="date" value={startDate} onChange={(event) => { setQuickOffset(null); setStartDate(event.target.value); }} className="h-10 min-w-0 appearance-none whitespace-nowrap rounded-[18px] bg-white px-1.5 text-[10px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8] lg:px-3 lg:text-xs" />
            <span className="flex h-10 items-center text-sm text-[#98a2b3]">~</span>
            <input type="date" value={endDate} onChange={(event) => { setQuickOffset(null); setEndDate(event.target.value); }} className="h-10 min-w-0 appearance-none whitespace-nowrap rounded-[18px] bg-white px-1.5 text-[10px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8] lg:px-3 lg:text-xs" />
            {isAdmin ? <select value={selectedStaffUid} onChange={(event) => setSelectedStaffUid(event.target.value)} className="h-10 min-w-0 rounded-[18px] bg-white px-2 text-[10px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8] lg:text-xs"><option value="__all__">전체 직원</option>{staffList.map((staff) => <option key={staff.uid} value={staff.uid}>{staff.displayName}</option>)}</select> : <div className="h-10 min-w-0 truncate rounded-[18px] bg-white px-2 text-[10px] leading-10 text-[#101828] lg:text-xs">{currentUser.displayName || "내 커미션"}</div>}
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="hidden h-10 min-w-0 rounded-[18px] bg-white px-2 text-xs text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8] lg:block"><option value="">전체 상태</option><option value="confirmed">확정</option><option value="draft">임시저장</option></select>
            <input value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void handleSearch(); }} placeholder="환자명 검색" className="hidden h-10 min-w-0 rounded-[18px] bg-white px-3 text-xs text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:ring-2 focus:ring-[#bdeee8] lg:block" />
            <button onClick={() => void handleSearch()} disabled={loading} className="hidden h-10 shrink-0 rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-5 text-xs font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition active:scale-95 disabled:opacity-50 lg:block">{loading ? "조회 중..." : "조회"}</button>
          </div>
          <div className="grid grid-cols-[96px_minmax(0,1fr)_auto] gap-2 lg:hidden">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="h-10 min-w-0 rounded-[18px] bg-white px-2 text-[10px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"><option value="">전체 상태</option><option value="confirmed">확정</option><option value="draft">임시저장</option></select>
            <input value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void handleSearch(); }} placeholder="환자명 검색" className="h-10 min-w-0 rounded-[18px] bg-white px-2 text-[11px] text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:ring-2 focus:ring-[#bdeee8]" />
            <button onClick={() => void handleSearch()} disabled={loading} className="h-10 shrink-0 rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-5 text-[11px] font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition active:scale-95 disabled:opacity-50">{loading ? "조회 중..." : "조회"}</button>
          </div>
          <div className="rounded-[20px] bg-white p-1 lg:flex lg:items-center lg:gap-5 lg:overflow-x-auto lg:rounded-none lg:bg-transparent lg:p-0 lg:whitespace-nowrap"><div className="grid grid-cols-3 gap-1 lg:flex lg:items-center lg:gap-5"><QuickButton active={quickOffset === -1} onClick={() => quickRange(-1)}>전달</QuickButton><QuickButton active={quickOffset === 0} onClick={() => quickRange(0)}>이번 달</QuickButton><QuickButton active={quickOffset === 1} onClick={() => quickRange(1)}>다음 달</QuickButton></div></div>
        </div>
      </div>

      {!searched && <div className="flex items-center justify-center rounded-[28px] bg-white py-20 text-sm text-gray-400 shadow-[0_16px_50px_rgba(15,23,42,0.055)]">기간을 선택하고 조회를 누르세요.</div>}

      {searched && (
        <>
          {capped && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">결과가 많아 일부만 집계되었습니다. 기간을 좁혀 다시 조회하면 정확한 합계를 볼 수 있습니다.</div>}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[22px] bg-[#f8fbfa] px-4 py-3 text-gray-700 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"><div className="text-xs font-semibold opacity-60">총 건수</div><div className="mt-0.5 text-lg font-extrabold">{grandTotal.count}건</div></div>
            <div className="rounded-[22px] bg-blue-50 px-4 py-3 text-blue-700 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"><div className="text-xs font-semibold opacity-60">총 수술금액</div><div className="mt-0.5 text-lg font-extrabold">{formatMoney(grandTotal.amount)} KRW</div></div>
            <div className="rounded-[22px] bg-[#e3f2ee] px-4 py-3 text-[#0f9b8e] shadow-[0_10px_24px_rgba(15,23,42,0.04)]"><div className="text-xs font-semibold opacity-60">총 커미션</div><div className="mt-0.5 text-lg font-extrabold">{formatMoney(grandTotal.commission)} KRW</div></div>
          </div>

          {isAdmin && selectedStaffUid === "__all__" && staffSubtotals.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-1"><div className="text-sm font-bold text-gray-800">담당자별 소계</div><div className="text-xs text-[#98a2b3]">총 {staffSubtotals.length}명</div></div>
              <div className="space-y-2.5 lg:hidden">{pagedStaffSubtotals.map((staff) => <article key={staff.name} className="rounded-[24px] bg-white p-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="truncate text-[15px] font-bold tracking-[-0.04em] text-[#101828]">{staff.name}</div><div className="mt-0.5 text-[11px] text-[#667085]">{staff.count}건</div></div><div className="shrink-0 text-right text-xs text-[#667085]"><div><span className="text-[#98a2b3]">수술금액 </span>₩{formatMoney(staff.totalAmount)}</div><div className="mt-0.5 font-semibold text-[#0f9b8e]"><span className="text-[#98a2b3]">커미션 </span>₩{formatMoney(staff.totalCommission)}</div></div></div></article>)}</div>
              <section className="hidden overflow-hidden rounded-[18px] border border-[#dfe7e4] bg-white lg:block">
                <div className="grid min-h-[42px] grid-cols-[minmax(180px,1.4fr)_120px_minmax(180px,1fr)_minmax(180px,1fr)] items-center gap-4 border-b border-[#dfe7e4] bg-[#fbfdfc] px-5 text-[11px] font-semibold text-[#667085]"><div>담당자</div><div>건수</div><div>수술금액</div><div>커미션</div></div>
                {pagedStaffSubtotals.map((staff) => <div key={staff.name} className="grid min-h-[62px] grid-cols-[minmax(180px,1.4fr)_120px_minmax(180px,1fr)_minmax(180px,1fr)] items-center gap-4 border-b border-[#edf2ef] px-5 transition last:border-b-0 hover:bg-[#f3fbf8]"><div className="truncate text-sm font-bold text-[#101828]">{staff.name}</div><div className="text-xs text-[#344054]">{staff.count}건</div><div className="text-xs font-semibold text-[#344054]">₩{formatMoney(staff.totalAmount)}</div><div className="text-xs font-semibold text-[#0f9b8e]">₩{formatMoney(staff.totalCommission)}</div></div>)}
              </section>
              <PageControls page={currentStaffPage} totalPages={staffTotalPages} onPageChange={setStaffPage} />
            </div>
          )}

          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1"><div className="text-sm font-bold text-gray-800">환자별 목록</div>{records.length > 0 && <button onClick={() => downloadCSV(records)} className="rounded-full bg-[#e3f2ee] px-3 py-1.5 text-xs font-semibold text-[#0f9b8e] transition hover:bg-[#dff7f3]">CSV 다운로드</button>}</div>
            {records.length === 0 ? <div className="flex items-center justify-center rounded-[28px] bg-white py-16 text-sm text-gray-400 shadow-[0_16px_50px_rgba(15,23,42,0.055)]">해당 기간에 커미션 정보가 있는 인보이스가 없습니다.</div> : (
              <>
                <div className="space-y-2.5 lg:hidden">{pagedRecords.map((record) => <CommissionMobileCard key={record.id} record={record} onClick={() => setSelectedInvoice(record)} />)}</div>
                <section className="hidden overflow-hidden rounded-[18px] border border-[#dfe7e4] bg-white lg:block">
                  <div className="grid min-h-[44px] grid-cols-[minmax(180px,1.25fr)_minmax(150px,1fr)_minmax(130px,.85fr)_110px_minmax(140px,.9fr)_minmax(140px,.9fr)_minmax(140px,.9fr)_80px] items-center gap-4 border-b border-[#dfe7e4] bg-[#fbfdfc] px-5 text-[11px] font-semibold text-[#667085]"><div>환자</div><div>병원</div><div>담당자</div><div>결제</div><div>수술비</div><div>기준액·율</div><div>커미션</div><div className="text-right">관리</div></div>
                  {pagedRecords.map((record) => <div key={record.id} className="grid min-h-[68px] grid-cols-[minmax(180px,1.25fr)_minmax(150px,1fr)_minmax(130px,.85fr)_110px_minmax(140px,.9fr)_minmax(140px,.9fr)_minmax(140px,.9fr)_80px] items-center gap-4 border-b border-[#edf2ef] px-5 transition last:border-b-0 hover:bg-[#f3fbf8]"><div className="truncate text-sm font-bold text-[#101828]">{record.patientName}</div><div className="truncate text-xs text-[#344054]">{record.hospitalName || "-"}</div><div className="truncate text-xs text-[#344054]">{record.commissionStaffName || "-"}</div><div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${paymentClass(record.paymentMethod)}`}>{paymentMethodLabel(record.paymentMethod)}</span></div><div className="truncate text-xs font-semibold text-[#344054]">₩{formatMoney(record.totalAmount || 0)}</div><div className="min-w-0"><div className="truncate text-xs font-semibold text-[#344054]">₩{formatMoney(record.commissionBase || 0)}</div><div className="mt-1 text-[11px] text-[#667085]">{record.commissionRate !== undefined && record.commissionRate !== null ? `${record.commissionRate}%` : "-"}</div></div><div className="truncate text-xs font-semibold text-[#0f9b8e]">₩{formatMoney(record.commissionAmount || 0)}</div><div className="flex justify-end"><button onClick={() => setSelectedInvoice(record)} className="h-7 rounded-[13px] bg-[#e3f2ee] px-2.5 text-[10px] font-semibold text-[#0f9b8e]">보기</button></div></div>)}
                </section>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-gray-400"><span>총 {records.length}건</span><PageControls page={currentRecordPage} totalPages={recordTotalPages} onPageChange={setRecordPage} /></div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
