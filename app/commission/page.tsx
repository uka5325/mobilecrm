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

  // 담당자별 소계
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
      {/* 필터 */}
      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
        <div className="mb-4 text-base font-bold">커미션 조회</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">시작일</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-xl border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">종료일</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-xl border px-3 py-2 text-sm"
            />
          </div>

          {isAdmin && (
            <div>
              <label className="mb-1 block text-xs text-gray-500">담당자</label>
              <select
                value={selectedStaffUid}
                onChange={(e) => setSelectedStaffUid(e.target.value)}
                className="rounded-xl border px-3 py-2 text-sm"
              >
                <option value="__all__">전체 직원</option>
                {staffList.map((s) => (
                  <option key={s.uid} value={s.uid}>{s.displayName}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-gray-500">인보이스 상태</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="rounded-xl border px-3 py-2 text-sm"
            >
              <option value="">전체</option>
              <option value="confirmed">확정</option>
              <option value="draft">임시저장</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">환자명 검색</label>
            <input
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="환자명"
              className="rounded-xl border px-3 py-2 text-sm"
            />
          </div>

          <button
            onClick={handleSearch}
            disabled={loading}
            className="rounded-xl bg-[#1d9e75] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? "조회 중..." : "조회"}
          </button>
        </div>
      </div>

      {/* 결과 */}
      {searched && (
        <>
          {/* 합계 카드 */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <div className="text-xs text-gray-500">총 건수</div>
              <div className="mt-1 text-2xl font-bold">{grandTotal.count}건</div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <div className="text-xs text-gray-500">총 수술금액</div>
              <div className="mt-1 text-2xl font-bold">{formatMoney(grandTotal.amount)} KRW</div>
            </div>
            <div className="rounded-2xl border border-[#1d9e75]/30 bg-emerald-50 p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <div className="text-xs text-gray-500">총 커미션</div>
              <div className="mt-1 text-2xl font-bold text-[#1d9e75]">{formatMoney(grandTotal.commission)} KRW</div>
            </div>
          </div>

          {/* 담당자별 소계 (전체 조회 시) */}
          {isAdmin && selectedStaffUid === "__all__" && staffSubtotals.length > 0 && (
            <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <div className="mb-3 font-bold">담당자별 소계</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-gray-500">
                      <th className="py-2 text-left">담당자</th>
                      <th className="py-2 text-right">건수</th>
                      <th className="py-2 text-right">수술금액 합계</th>
                      <th className="py-2 text-right">커미션 합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffSubtotals.map((s) => (
                      <tr key={s.name} className="border-b last:border-b-0">
                        <td className="py-2 font-medium">{s.name}</td>
                        <td className="py-2 text-right">{s.count}건</td>
                        <td className="py-2 text-right">{formatMoney(s.totalAmount)}</td>
                        <td className="py-2 text-right font-semibold text-[#1d9e75]">{formatMoney(s.totalCommission)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 상세 테이블 */}
          <div className="rounded-2xl border border-black/10 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
            <div className="border-b px-5 py-4 font-bold">상세 내역</div>
            {records.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-gray-400">
                해당 기간에 커미션 정보가 있는 확정 인보이스가 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-xs text-gray-500">
                      <th className="px-4 py-3 text-left">환자명</th>
                      <th className="px-4 py-3 text-left">담당자</th>
                      <th className="px-4 py-3 text-left">결제방법</th>
                      <th className="px-4 py-3 text-right">최종 수술비</th>
                      <th className="px-4 py-3 text-right">커미션 기준액</th>
                      <th className="px-4 py-3 text-right">커미션율</th>
                      <th className="px-4 py-3 text-right">커미션액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} className="border-b last:border-b-0 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{r.patientName}</td>
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
                        <td className="px-4 py-3 text-right">{formatMoney(r.totalAmount)}</td>
                        <td className="px-4 py-3 text-right">{formatMoney(r.commissionBase)}</td>
                        <td className="px-4 py-3 text-right">
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
