"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { searchReservationsByDateRange } from "@/lib/reservations";
import { todayString } from "@/lib/dateUtils";
import {
  type ReservationDoc,
  cleanText,
  getHospital,
  getAppointmentType,
  getReservationDate,
  getReservationTime,
  getConsultAreas,
  getPatientKey,
  getManagers,
  getDoctors,
  isCompleted,
  pctText,
  setQuickRange,
} from "@/lib/dashboardUtils";
import { QuickButton } from "@/components/dashboard/QuickButton";
import { Panel } from "@/components/dashboard/Panel";
import { KpiTable } from "@/components/dashboard/KpiTable";

const APPOINTMENT_TYPES = ["상담", "수술", "시술", "치료", "경과", "진료", "검진"] as const;

const APPT_TYPE_COLORS: Record<string, string> = {
  상담: "#2563eb",
  수술: "#ef4444",
  시술: "#db2777",
  치료: "#16a34a",
  경과: "#f59e0b",
  진료: "#7c3aed",
  검진: "#0891b2",
};

type OperationalRow = {
  name: string;
  total: number;
  patients: number;
  completed: number;
  scheduled: number;
  cancelled: number;
  completionRate: number;
  shareRate?: number;
};

type DayTrend = {
  date: string;
  total: number;
  completed: number;
  scheduled: number;
  cancelled: number;
};

function formatNumber(value: number) {
  return value.toLocaleString("ko-KR");
}

function rateText(part: number, total: number) {
  return pctText(total ? Math.round((part / total) * 1000) / 10 : 0);
}

function isCancelled(item: ReservationDoc) {
  return item.cancelled === true;
}

function isScheduled(item: ReservationDoc) {
  return !isCancelled(item) && !isCompleted(item);
}

function isOperationallyCompleted(item: ReservationDoc) {
  return !isCancelled(item) && isCompleted(item);
}

function buildOperationalRow(name: string, rows: ReservationDoc[], shareBase?: number): OperationalRow {
  const nonCancelled = rows.filter((item) => !isCancelled(item)).length;
  const completed = rows.filter(isOperationallyCompleted).length;
  const cancelled = rows.filter(isCancelled).length;
  const scheduled = rows.filter(isScheduled).length;
  const patients = new Set(rows.map(getPatientKey)).size;

  return {
    name,
    total: rows.length,
    patients,
    completed,
    scheduled,
    cancelled,
    completionRate: nonCancelled ? Math.round((completed / nonCancelled) * 1000) / 10 : 0,
    shareRate: shareBase ? Math.round((rows.length / shareBase) * 1000) / 10 : 0,
  };
}

function toOperationalTableRows(rows: OperationalRow[]) {
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
  useCurrentUser();
  const router = useRouter();
  const [allReservations, setAllReservations] = useState<ReservationDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [searched, setSearched] = useState(false);

  const [startDate, setStartDate] = useState(todayString());
  const [endDate, setEndDate] = useState(todayString());
  const [hospitalFilter, setHospitalFilter] = useState("");
  const [apptTypeFilter, setApptTypeFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [coordinatorFilter, setCoordinatorFilter] = useState("");

  const load = useCallback(async (from: string, to: string) => {
    const normFrom = from <= to ? from : to;
    const normTo = from <= to ? to : from;
    setLoading(true);
    setError("");
    try {
      const list = await searchReservationsByDateRange(normFrom, normTo);
      setAllReservations(list as unknown as ReservationDoc[]);
      setLastLoadedAt(new Date());
      setSearched(true);
    } catch (e) {
      console.error("[dashboard] load error:", e);
      const msg = e instanceof Error && e.message ? e.message : "대시보드 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
      setError(msg);
      setSearched(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const reservations = useMemo(() => {
    const normalizedStart = startDate <= endDate ? startDate : endDate;
    const normalizedEnd = startDate <= endDate ? endDate : startDate;
    return allReservations.filter((item) => {
      const date = getReservationDate(item);
      return date >= normalizedStart && date <= normalizedEnd;
    });
  }, [allReservations, startDate, endDate]);

  const hospitals = useMemo(() => {
    return Array.from(new Set(reservations.map(getHospital).filter(Boolean))).sort();
  }, [reservations]);

  const doctors = useMemo(() => {
    return Array.from(new Set(reservations.flatMap(getDoctors).filter(Boolean))).sort();
  }, [reservations]);

  const coordinators = useMemo(() => {
    return Array.from(new Set(reservations.flatMap(getManagers).filter(Boolean))).sort();
  }, [reservations]);

  const itemOptions = useMemo(() => {
    return Array.from(new Set(reservations.flatMap(getConsultAreas).filter(Boolean))).sort();
  }, [reservations]);

  const filteredRows = useMemo(() => {
    return reservations.filter((item) => {
      if (hospitalFilter && getHospital(item) !== hospitalFilter) return false;
      if (apptTypeFilter && getAppointmentType(item) !== apptTypeFilter) return false;
      if (itemFilter && !getConsultAreas(item).includes(itemFilter)) return false;
      if (doctorFilter && !getDoctors(item).includes(doctorFilter)) return false;
      if (coordinatorFilter && !getManagers(item).includes(coordinatorFilter)) return false;
      return true;
    });
  }, [reservations, hospitalFilter, apptTypeFilter, itemFilter, doctorFilter, coordinatorFilter]);

  const dashboard = useMemo(() => {
    const summary = buildOperationalRow("전체", filteredRows);

    const groupRows = (getName: (item: ReservationDoc) => string) => {
      const map = new Map<string, ReservationDoc[]>();
      for (const item of filteredRows) {
        const name = getName(item) || "미지정";
        map.set(name, [...(map.get(name) || []), item]);
      }
      return [...map.entries()]
        .map(([name, rows]) => buildOperationalRow(name, rows))
        .sort((a, b) => b.total - a.total || cleanText(a.name).localeCompare(cleanText(b.name)));
    };

    const hospitalRows = groupRows((item) => getHospital(item) || "미지정");
    const apptTypeRows = APPOINTMENT_TYPES.map((type) => {
      const rows = filteredRows.filter((item) => getAppointmentType(item) === type);
      return buildOperationalRow(type, rows);
    });
    const itemMap = new Map<string, ReservationDoc[]>();
    for (const item of filteredRows) {
      for (const area of getConsultAreas(item)) {
        itemMap.set(area, [...(itemMap.get(area) || []), item]);
      }
    }
    const itemRows = [...itemMap.entries()]
      .map(([name, rows]) => buildOperationalRow(name, rows, summary.total))
      .sort((a, b) => b.total - a.total || cleanText(a.name).localeCompare(cleanText(b.name)));

    return { summary, hospitalRows, apptTypeRows, itemRows };
  }, [filteredRows]);

  const dayTrendRows = useMemo<DayTrend[]>(() => {
    const map = new Map<string, DayTrend>();
    for (const r of filteredRows) {
      const date = getReservationDate(r) || "날짜 미입력";
      if (!map.has(date)) map.set(date, { date, total: 0, completed: 0, scheduled: 0, cancelled: 0 });
      const row = map.get(date)!;
      row.total += 1;
      if (isOperationallyCompleted(r)) row.completed += 1;
      if (isScheduled(r)) row.scheduled += 1;
      if (isCancelled(r)) row.cancelled += 1;
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredRows]);

  const doctorRows = useMemo(() => {
    const map = new Map<string, ReservationDoc[]>();
    for (const r of filteredRows) {
      const names = getDoctors(r);
      for (const name of names.length ? names : ["미지정"]) {
        map.set(name, [...(map.get(name) || []), r]);
      }
    }
    return [...map.entries()]
      .map(([name, rows]) => buildOperationalRow(name, rows))
      .sort((a, b) => b.total - a.total || cleanText(a.name).localeCompare(cleanText(b.name)));
  }, [filteredRows]);

  const coordinatorRows = useMemo(() => {
    const map = new Map<string, ReservationDoc[]>();
    for (const r of filteredRows) {
      const names = getManagers(r);
      for (const name of names.length ? names : ["미지정"]) {
        map.set(name, [...(map.get(name) || []), r]);
      }
    }
    return [...map.entries()]
      .map(([name, rows]) => buildOperationalRow(name, rows))
      .sort((a, b) => b.total - a.total || cleanText(a.name).localeCompare(cleanText(b.name)));
  }, [filteredRows]);

  const issueRows = useMemo(() => {
    const today = todayString();
    const count = (predicate: (item: ReservationDoc) => boolean) => filteredRows.filter(predicate).length;
    return [
      { label: "지난 날짜 미완료", value: count((item) => {
        const date = getReservationDate(item);
        return !!date && date < today && isScheduled(item);
      }) },
      { label: "담당 원장 미지정", value: count((item) => getDoctors(item).length === 0) },
      { label: "코디네이터 미지정", value: count((item) => getManagers(item).length === 0) },
      { label: "병원 미지정", value: count((item) => !getHospital(item)) },
      { label: "예약시간 미입력", value: count((item) => getReservationTime(item) === "-") },
      { label: "취소 예약", value: count(isCancelled) },
    ];
  }, [filteredRows]);

  function handleQuickRange(type: "today" | "week" | "month" | "lastMonth" | "last7" | "last30") {
    const range = setQuickRange(type);
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
      <section className="-mx-6 mb-4 rounded-t-2xl border border-[#edf0f3] bg-[#ecfdf5] px-4 py-4 lg:-mx-8 lg:px-8">
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
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-5">
          <select
            value={hospitalFilter}
            onChange={(e) => setHospitalFilter(e.target.value)}
            className="h-10 min-w-0 rounded-xl border border-[#dfe3e8] bg-white px-2 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          >
            <option value="">전체 병원</option>
            {hospitals.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <select
            value={apptTypeFilter}
            onChange={(e) => setApptTypeFilter(e.target.value)}
            className="h-10 min-w-0 rounded-xl border border-[#dfe3e8] bg-white px-2 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          >
            <option value="">전체 유형</option>
            {APPOINTMENT_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select
            value={itemFilter}
            onChange={(e) => setItemFilter(e.target.value)}
            className="h-10 min-w-0 rounded-xl border border-[#dfe3e8] bg-white px-2 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          >
            <option value="">전체 항목</option>
            {itemOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select
            value={doctorFilter}
            onChange={(e) => setDoctorFilter(e.target.value)}
            className="h-10 min-w-0 rounded-xl border border-[#dfe3e8] bg-white px-2 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          >
            <option value="">전체 원장</option>
            {doctors.map((doctor) => (
              <option key={doctor} value={doctor}>{doctor}</option>
            ))}
          </select>
          <select
            value={coordinatorFilter}
            onChange={(e) => setCoordinatorFilter(e.target.value)}
            className="h-10 min-w-0 rounded-xl border border-[#dfe3e8] bg-white px-2 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
          >
            <option value="">전체 코디</option>
            {coordinators.map((coordinator) => (
              <option key={coordinator} value={coordinator}>{coordinator}</option>
            ))}
          </select>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => load(startDate, endDate)}
            disabled={loading}
            className="h-10 shrink-0 rounded-xl bg-[#1d9e75] px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-60"
          >
            {loading ? "조회 중..." : "조회"}
          </button>
          <button
            onClick={resetFilters}
            className="h-10 shrink-0 rounded-xl bg-black px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
          >
            초기화
          </button>
          <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
            <QuickButton onClick={() => handleQuickRange("today")}>오늘</QuickButton>
            <QuickButton onClick={() => handleQuickRange("week")}>이번 주</QuickButton>
            <QuickButton onClick={() => handleQuickRange("month")}>이번 달</QuickButton>
            <QuickButton onClick={() => handleQuickRange("lastMonth")}>전달</QuickButton>
          </div>
        </div>

        <div className="mt-3 text-xs text-gray-400">
          {error
            ? error
            : `${
                loading
                  ? "조회 중..."
                  : lastLoadedAt
                  ? `${String(lastLoadedAt.getHours()).padStart(2, "0")}:${String(lastLoadedAt.getMinutes()).padStart(2, "0")} 조회 기준`
                  : "조회 대기"
              } · 표시 ${filteredRows.length.toLocaleString("ko-KR")}건`}
        </div>
      </section>

      {!searched ? (
        <div className="flex items-center justify-center rounded-2xl border border-[#edf0f3] bg-white py-20 text-sm text-gray-400">
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
              <div key={card.label} className="rounded-[14px] border border-black/5 bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                <div className="text-xs font-bold text-gray-500">{card.label}</div>
                <div className="mt-1 text-[24px] font-bold text-gray-900">
                  {typeof card.value === "number" ? formatNumber(card.value) : card.value}
                </div>
                <div className="mt-0.5 text-xs text-gray-500">{card.helper}</div>
              </div>
            ))}
          </section>

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
                    className="rounded-[14px] border border-black/5 bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.04)]"
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
              rows={toOperationalTableRows(doctorRows)}
            />
          </Panel>

          <Panel title="코디네이터별 현황">
            <KpiTable
              headers={["코디네이터", "예약", "환자 수", "완료", "예정", "취소", "완료율"]}
              rows={toOperationalTableRows(coordinatorRows)}
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
              {issueRows.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => router.push("/schedule")}
                  className="rounded-[14px] border border-[#edf0f3] bg-[#f8fafc] p-4 text-left transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md active:scale-[0.99]"
                >
                  <div className="text-xs font-bold text-gray-500">{item.label}</div>
                  <div className="mt-1 text-[22px] font-bold text-gray-900">{formatNumber(item.value)}</div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="일자별 운영 추이" rightText={`${dayTrendRows.length.toLocaleString("ko-KR")}일`}>
            <div className="space-y-3 px-6 pb-5 lg:px-8">
              {dayTrendRows.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">데이터가 없습니다.</div>
              ) : (
                dayTrendRows.map((row) => {
                  const max = Math.max(...dayTrendRows.map((item) => item.total), 1);
                  return (
                    <div key={row.date} className="grid grid-cols-[92px_1fr] gap-3 text-xs md:grid-cols-[92px_1fr_160px] md:items-center">
                      <div className="font-medium text-gray-700">{row.date}</div>
                      <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-[#1d9e75]" style={{ width: `${Math.max(4, (row.total / max) * 100)}%` }} />
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
