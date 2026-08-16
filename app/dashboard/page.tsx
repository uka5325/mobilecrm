"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { searchReservationsByDateRange } from "@/features/reservations/data/client";
import { listSalesSummaryRows, type SalesSummaryRow } from "@/features/settlements/data/client/settlements";
import { aggregateSettlementRows } from "@/lib/settlementMath";
import { todayString } from "@/lib/dateUtils";
import {
  APPOINTMENT_TYPES,
  calculateDashboardKpi,
  type ReservationDoc,
  getHospital,
  getAppointmentType,
  getReservationDate,
  getDemandAreas,
  getManagers,
  getDoctors,
  pctText,
  setQuickRange,
} from "@/features/dashboard/domain/dashboardKpi";
import { QuickButton } from "@/components/dashboard/QuickButton";
import { Panel } from "@/components/dashboard/Panel";
import { KpiTable } from "@/components/dashboard/KpiTable";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: "카드",
  cash: "현금",
  bank_transfer: "계좌이체",
  foreign_card: "해외카드",
  other: "기타",
};

const APPT_TYPE_COLORS: Record<string, string> = {
  상담: "#2563eb",
  수술: "#ef4444",
  시술: "#db2777",
  치료: "#16a34a",
  경과: "#f59e0b",
  진료: "#7c3aed",
  검진: "#0891b2",
};

function formatNumber(value: number) {
  return value.toLocaleString("ko-KR");
}

function formatWon(value: number) {
  return `${formatNumber(value)}원`;
}

function rateText(part: number, total: number) {
  return pctText(total ? Math.round((part / total) * 1000) / 10 : 0);
}

function toOperationalTableRows(rows: ReturnType<typeof calculateDashboardKpi>["hospitalRows"]) {
  return rows.map((row) => [
    row.name || "미지정",
    formatNumber(row.total),
    formatNumber(row.patients),
    formatNumber(row.completed),
    formatNumber(row.scheduled),
    formatNumber(row.cancelled),
    pctText(row.completionRate),
  ]);
}

export default function DashboardPage() {
  const { currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role === "admin";
  const router = useRouter();
  const [allReservations, setAllReservations] = useState<ReservationDoc[]>([]);
  const [salesRows, setSalesRows] = useState<SalesSummaryRow[]>([]);
  const [salesError, setSalesError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [loadedRange, setLoadedRange] = useState<{ start: string; end: string } | null>(null);
  const [searched, setSearched] = useState(false);
  const loadSequenceRef = useRef(0);

  const [startDate, setStartDate] = useState(todayString());
  const [endDate, setEndDate] = useState(todayString());
  const [hospitalFilter, setHospitalFilter] = useState("");
  const [apptTypeFilter, setApptTypeFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [coordinatorFilter, setCoordinatorFilter] = useState("");
  const [quickRangeType, setQuickRangeType] = useState<"today" | "week" | "month" | "lastMonth" | null>("today");

  const load = useCallback(async (from: string, to: string) => {
    const normFrom = from <= to ? from : to;
    const normTo = from <= to ? to : from;
    const sequence = ++loadSequenceRef.current;
    setLoading(true);
    setError("");
    setSalesError("");
    try {
      const [reservationResult, salesResult] = await Promise.allSettled([
        searchReservationsByDateRange(normFrom, normTo),
        isAdmin ? listSalesSummaryRows(normFrom, normTo) : Promise.resolve([] as SalesSummaryRow[]),
      ]);
      if (sequence !== loadSequenceRef.current) return;
      if (reservationResult.status === "rejected") throw reservationResult.reason;
      setAllReservations(reservationResult.value as unknown as ReservationDoc[]);
      if (salesResult.status === "fulfilled") {
        setSalesRows(salesResult.value as SalesSummaryRow[]);
      } else if (isAdmin) {
        setSalesRows([]);
        setSalesError(salesResult.reason instanceof Error ? salesResult.reason.message : "매출 현황을 불러오지 못했습니다.");
      }
      setLoadedRange({ start: normFrom, end: normTo });
      setLastLoadedAt(new Date());
      setSearched(true);
    } catch (e) {
      if (sequence !== loadSequenceRef.current) return;
      console.error("[dashboard] load error:", e);
      const msg = e instanceof Error && e.message ? e.message : "대시보드 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
      setError(msg);
      setSearched(false);
    } finally {
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [isAdmin]);

  const reservations = useMemo(() => {
    if (!loadedRange) return [];
    return allReservations.filter((item) => {
      const date = getReservationDate(item);
      return date >= loadedRange.start && date <= loadedRange.end;
    });
  }, [allReservations, loadedRange]);

  const hospitals = useMemo(() => {
    return Array.from(new Set([
      ...reservations.map(getHospital),
      ...salesRows.map((row) => row.hospital),
    ].filter(Boolean))).sort();
  }, [reservations, salesRows]);

  const doctors = useMemo(() => {
    return Array.from(new Set([
      ...reservations.flatMap(getDoctors),
      ...salesRows.flatMap((row) => row.doctors),
    ].filter(Boolean))).sort();
  }, [reservations, salesRows]);

  const coordinators = useMemo(() => {
    return Array.from(new Set([
      ...reservations.flatMap(getManagers),
      ...salesRows.flatMap((row) => row.coordinators),
    ].filter(Boolean))).sort();
  }, [reservations, salesRows]);

  const itemOptions = useMemo(() => {
    const salesAreas = salesRows.flatMap((row) => getDemandAreas({ id: "", ...row } as ReservationDoc));
    return Array.from(new Set([...reservations.flatMap(getDemandAreas), ...salesAreas].filter(Boolean))).sort();
  }, [reservations, salesRows]);

  const filteredRows = useMemo(() => {
    return reservations.filter((item) => {
      if (hospitalFilter && getHospital(item) !== hospitalFilter) return false;
      if (apptTypeFilter && getAppointmentType(item) !== apptTypeFilter) return false;
      if (itemFilter && !getDemandAreas(item).includes(itemFilter)) return false;
      if (doctorFilter && !getDoctors(item).includes(doctorFilter)) return false;
      if (coordinatorFilter && !getManagers(item).includes(coordinatorFilter)) return false;
      return true;
    });
  }, [reservations, hospitalFilter, apptTypeFilter, itemFilter, doctorFilter, coordinatorFilter]);

  const filteredSalesRows = useMemo(() => {
    if (!loadedRange) return [];
    return salesRows.filter((row) => {
      if (row.paidAt < loadedRange.start || row.paidAt > loadedRange.end) return false;
      const reservationLike = { id: "", ...row } as ReservationDoc;
      if (hospitalFilter && row.hospital !== hospitalFilter) return false;
      if (apptTypeFilter && getAppointmentType(reservationLike) !== apptTypeFilter) return false;
      if (itemFilter && !getDemandAreas(reservationLike).includes(itemFilter)) return false;
      if (doctorFilter && !row.doctors.includes(doctorFilter)) return false;
      if (coordinatorFilter && !row.coordinators.includes(coordinatorFilter)) return false;
      return true;
    });
  }, [salesRows, loadedRange, hospitalFilter, apptTypeFilter, itemFilter, doctorFilter, coordinatorFilter]);

  const sales = useMemo(() => {
    const aggregate = aggregateSettlementRows(filteredSalesRows);
    const group = (getName: (row: SalesSummaryRow) => string) => {
      const map = new Map<string, SalesSummaryRow[]>();
      for (const row of filteredSalesRows) {
        const name = getName(row) || "미지정";
        map.set(name, [...(map.get(name) || []), row]);
      }
      return [...map.entries()]
        .map(([name, rows]) => ({ name, ...aggregateSettlementRows(rows) }))
        .sort((a, b) => b.netAmount - a.netAmount || a.name.localeCompare(b.name));
    };
    return {
      aggregate,
      hospitals: group((row) => row.hospital || "미지정"),
      methods: group((row) => PAYMENT_METHOD_LABELS[row.paymentMethod] || "기타"),
    };
  }, [filteredSalesRows]);

  const dashboard = useMemo(
    () => calculateDashboardKpi(filteredRows, todayString()),
    [filteredRows]
  );

  function handleQuickRange(type: "today" | "week" | "month" | "lastMonth" | "last7" | "last30") {
    const range = setQuickRange(type);
    setQuickRangeType(type === "last7" || type === "last30" ? null : type);
    setStartDate(range.start);
    setEndDate(range.end);
    load(range.start, range.end);
  }

  function resetFilters() {
    setHospitalFilter("");
    setApptTypeFilter("");
    setItemFilter("");
    setDoctorFilter("");
    setCoordinatorFilter("");
  }

  return (
    <div className="space-y-5">
      <section className="mb-4 rounded-[26px] bg-[#eaf8f3] p-5 shadow-[0_18px_50px_rgba(7,56,58,0.08)] lg:p-6">
        <div className="space-y-2">
          <div className="grid grid-cols-3 items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setQuickRangeType(null); setStartDate(e.target.value); }}
              className="h-10 min-w-0 appearance-none rounded-[18px] bg-white px-2 text-[11px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setQuickRangeType(null); setEndDate(e.target.value); }}
              className="h-10 min-w-0 appearance-none rounded-[18px] bg-white px-2 text-[11px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            />
            <select
              value={hospitalFilter}
              onChange={(e) => setHospitalFilter(e.target.value)}
              className="h-10 min-w-0 rounded-[18px] bg-white px-2 text-[11px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            >
              <option value="">전체 병원</option>
              {hospitals.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <select
              value={apptTypeFilter}
              onChange={(e) => setApptTypeFilter(e.target.value)}
              className="h-10 min-w-0 rounded-[18px] bg-white px-2 text-[11px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            >
              <option value="">전체 유형</option>
              {APPOINTMENT_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <select
              value={itemFilter}
              onChange={(e) => setItemFilter(e.target.value)}
              className="h-10 min-w-0 rounded-[18px] bg-white px-2 text-[11px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            >
              <option value="">전체 항목</option>
              {itemOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="h-10 min-w-0 rounded-[18px] bg-white px-2 text-[11px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            >
              <option value="">전체 원장</option>
              {doctors.map((doctor) => (
                <option key={doctor} value={doctor}>{doctor}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <select
              value={coordinatorFilter}
              onChange={(e) => setCoordinatorFilter(e.target.value)}
              className="h-10 min-w-0 rounded-[18px] bg-white px-2 text-[11px] text-[#101828] outline-none transition focus:ring-2 focus:ring-[#bdeee8]"
            >
              <option value="">전체 코디</option>
              {coordinators.map((coordinator) => (
                <option key={coordinator} value={coordinator}>{coordinator}</option>
              ))}
            </select>
            <button
              onClick={() => load(startDate, endDate)}
              disabled={loading}
              className="h-10 min-w-0 rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-2 text-[11px] font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition hover:-translate-y-0.5 active:scale-95 disabled:opacity-60"
            >
              {loading ? "조회 중..." : "조회"}
            </button>
            <button
              onClick={resetFilters}
              className="h-10 min-w-0 rounded-[18px] bg-[#e3f2ee] px-2 text-[11px] font-bold text-[#0f9b8e] transition hover:-translate-y-0.5 active:scale-95"
            >
              초기화
            </button>
          </div>

          <div className="rounded-[20px] bg-white p-1">
            <div className="grid grid-cols-4 gap-1">
              <QuickButton active={quickRangeType === "today"} onClick={() => handleQuickRange("today")}>오늘</QuickButton>
              <QuickButton active={quickRangeType === "week"} onClick={() => handleQuickRange("week")}>이번 주</QuickButton>
              <QuickButton active={quickRangeType === "month"} onClick={() => handleQuickRange("month")}>이번 달</QuickButton>
              <QuickButton active={quickRangeType === "lastMonth"} onClick={() => handleQuickRange("lastMonth")}>전달</QuickButton>
            </div>
          </div>
        </div>

        <div className="mt-3 text-xs text-gray-400">
          {error
            ? error
            : `${
                loading
                  ? "조회 중..."
                  : lastLoadedAt
                  ? `${loadedRange?.start} ~ ${loadedRange?.end} · ${String(lastLoadedAt.getHours()).padStart(2, "0")}:${String(lastLoadedAt.getMinutes()).padStart(2, "0")} 조회 기준`
                  : "조회 대기"
              } · 표시 ${filteredRows.length.toLocaleString("ko-KR")}건`}
        </div>
      </section>

      {!searched ? (
        <div className="flex items-center justify-center rounded-[28px] bg-white py-20 text-sm text-gray-400 shadow-[0_16px_50px_rgba(15,23,42,0.055)]">
          기간을 선택하고 조회를 누르세요.
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {[
              { label: "전체 예약", value: dashboard.summary.total, helper: `${formatNumber(dashboard.summary.patients)}명` },
              { label: "환자 수", value: dashboard.summary.patients, helper: "중복 환자 제외" },
              { label: "완료", value: dashboard.summary.completed, helper: rateText(dashboard.summary.completed, Math.max(1, dashboard.summary.total - dashboard.summary.cancelled)) },
              { label: "진행 예정", value: dashboard.summary.scheduled, helper: "미완료·미취소" },
              { label: "취소", value: dashboard.summary.cancelled, helper: rateText(dashboard.summary.cancelled, dashboard.summary.total) },
              { label: "완료율", value: pctText(dashboard.summary.completionRate), helper: "취소 제외 기준" },
            ].map((card) => (
              <div key={card.label} className="rounded-[22px] bg-[#f8fbfa] p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                <div className="text-xs font-bold text-gray-500">{card.label}</div>
                <div className="mt-1 text-[24px] font-bold text-gray-900">
                  {typeof card.value === "number" ? formatNumber(card.value) : card.value}
                </div>
                <div className="mt-0.5 text-xs text-gray-500">{card.helper}</div>
              </div>
            ))}
          </section>

          {isAdmin && (
            <>
              <Panel title="매출 현황" rightText="실제 결제일 기준 · Admin 전용">
                {salesError ? (
                  <div className="px-6 pb-5 text-sm text-red-600 lg:px-8">{salesError}</div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 px-6 pb-5 md:grid-cols-4 lg:px-8">
                    {[
                      { label: "순매출", value: formatWon(sales.aggregate.netAmount), helper: "결제 - 환불" },
                      { label: "총 결제", value: formatWon(sales.aggregate.totalPaid), helper: `${formatNumber(sales.aggregate.paymentCount)}건` },
                      { label: "총 환불", value: formatWon(sales.aggregate.totalRefunded), helper: `${formatNumber(sales.aggregate.refundCount)}건` },
                      { label: "정산 건수", value: `${formatNumber(sales.aggregate.count)}건`, helper: `결제 ${formatNumber(sales.aggregate.paymentCount)} · 환불 ${formatNumber(sales.aggregate.refundCount)}` },
                    ].map((card) => (
                      <div key={card.label} className="rounded-[20px] bg-[#f8fbfa] p-4">
                        <div className="text-xs font-bold text-gray-500">{card.label}</div>
                        <div className="mt-1 break-words text-[20px] font-bold text-gray-900">{card.value}</div>
                        <div className="mt-0.5 text-xs text-gray-500">{card.helper}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              {!salesError && (
                <>
                  <Panel title="병원별 매출">
                    <KpiTable
                      headers={["병원", "결제", "환불", "순매출", "건수"]}
                      rows={sales.hospitals.map((row) => [
                        row.name,
                        formatWon(row.totalPaid),
                        formatWon(row.totalRefunded),
                        formatWon(row.netAmount),
                        `${formatNumber(row.count)}건`,
                      ])}
                    />
                  </Panel>

                  <Panel title="결제수단별 매출">
                    <KpiTable
                      headers={["결제수단", "결제", "환불", "순매출", "건수"]}
                      rows={sales.methods.map((row) => [
                        row.name,
                        formatWon(row.totalPaid),
                        formatWon(row.totalRefunded),
                        formatWon(row.netAmount),
                        `${formatNumber(row.count)}건`,
                      ])}
                    />
                  </Panel>
                </>
              )}
            </>
          )}

          <Panel title="예약 유형별 현황">
            <div className="grid grid-cols-2 gap-3 px-6 pb-5 md:grid-cols-4 lg:px-8">
              {APPOINTMENT_TYPES.map((type) => {
                const row = dashboard.apptTypeRows.find((item) => item.name === type);
                const count = row?.total || 0;
                const completed = row?.completed || 0;
                const scheduled = row?.scheduled || 0;
                const cancelled = row?.cancelled || 0;
                return (
                  <div
                    key={type}
                    className="rounded-[22px] bg-[#f8fbfa] p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
                    style={{ borderLeftWidth: 4, borderLeftColor: APPT_TYPE_COLORS[type] }}
                  >
                    <div className="text-xs font-bold" style={{ color: APPT_TYPE_COLORS[type] }}>{type}</div>
                    <div className="mt-1 text-[24px] font-bold text-gray-900">{formatNumber(count)}</div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      완료 {formatNumber(completed)}건 · 예정 {formatNumber(scheduled)}건 · 취소 {formatNumber(cancelled)}건
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="병원별 운영 현황">
            <KpiTable
              headers={["병원", "예약", "환자 수", "완료", "예정", "취소", "완료율"]}
              rows={toOperationalTableRows(dashboard.hospitalRows)}
            />
          </Panel>

          <Panel title="담당 원장별 현황">
            <KpiTable
              headers={["원장", "예약", "환자 수", "완료", "예정", "취소", "완료율"]}
              rows={toOperationalTableRows(dashboard.doctorRows)}
            />
          </Panel>

          <Panel title="코디네이터별 현황">
            <KpiTable
              headers={["코디네이터", "예약", "환자 수", "완료", "예정", "취소", "완료율"]}
              rows={toOperationalTableRows(dashboard.coordinatorRows)}
            />
          </Panel>

          <Panel title="항목별 수요 현황">
            <KpiTable
              headers={["항목", "예약", "환자 수", "완료", "예정", "취소", "비중"]}
              rows={dashboard.itemRows.map((row) => [
                row.name || "미지정",
                formatNumber(row.total),
                formatNumber(row.patients),
                formatNumber(row.completed),
                formatNumber(row.scheduled),
                formatNumber(row.cancelled),
                pctText(row.shareRate || 0),
              ])}
            />
          </Panel>

          <Panel title="운영 확인 필요 항목" rightText="상세 확인은 스케줄에서 진행">
            <div className="grid grid-cols-2 gap-3 px-6 pb-5 md:grid-cols-3 lg:px-8">
              {dashboard.issueRows.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => router.push("/schedule")}
                  className="rounded-[22px] bg-[#f8fbfa] p-4 text-left shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:bg-white active:scale-[0.99]"
                >
                  <div className="text-xs font-bold text-gray-500">{item.label}</div>
                  <div className="mt-1 text-[22px] font-bold text-gray-900">{formatNumber(item.value)}</div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="일자별 운영 추이" rightText={`${dashboard.dayTrendRows.length.toLocaleString("ko-KR")}일`}>
            <div className="space-y-3 px-6 pb-5 lg:px-8">
              {dashboard.dayTrendRows.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">데이터가 없습니다.</div>
              ) : (
                dashboard.dayTrendRows.map((row) => {
                  const max = Math.max(...dashboard.dayTrendRows.map((item) => item.total), 1);
                  return (
                    <div key={row.date} className="grid grid-cols-[92px_1fr] gap-3 text-xs md:grid-cols-[92px_1fr_160px] md:items-center">
                      <div className="font-medium text-gray-700">{row.date}</div>
                      <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)]" style={{ width: `${Math.max(4, (row.total / max) * 100)}%` }} />
                      </div>
                      <div className="col-span-2 text-gray-500 md:col-span-1 md:text-right">
                        {formatNumber(row.total)}건 · 완료 {formatNumber(row.completed)} · 예정 {formatNumber(row.scheduled)} · 취소 {formatNumber(row.cancelled)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
