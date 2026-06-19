"use client";

import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { subscribeAllReservations } from "@/lib/reservations";
import { todayString } from "@/lib/dateUtils";
import {
  type ReservationDoc,
  type Counter,
  cleanText,
  getHospital,
  getAppointmentType,
  getReservationDate,
  getReservationTime,
  getPatientName,
  getConsultArea,
  getManagers,
  isCompleted,
  emptyCounter,
  accumulate,
  finalizeCounter,
  pctText,
  formatDepositMap,
  setQuickRange,
} from "@/lib/dashboardUtils";
import { QuickButton } from "@/components/dashboard/QuickButton";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { Panel } from "@/components/dashboard/Panel";
import { KpiTable } from "@/components/dashboard/KpiTable";

export default function DashboardPage() {
  const { authReady } = useCurrentUser();
  const [allReservations, setAllReservations] = useState<ReservationDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [startDate, setStartDate] = useState(todayString());
  const [endDate, setEndDate] = useState(todayString());
  const [hospitalFilter, setHospitalFilter] = useState("");
  const [apptTypeFilter, setApptTypeFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");

  useEffect(() => {
    if (!authReady) return;
    setLoading(true);
    const unsub = subscribeAllReservations(
      ({ reservations }) => {
        setAllReservations(reservations as unknown as ReservationDoc[]);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setError("대시보드 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [authReady]);

  const reservations = useMemo(() => {
    const normalizedStart = startDate <= endDate ? startDate : endDate;
    const normalizedEnd = startDate <= endDate ? endDate : startDate;
    return allReservations.filter((item) => {
      const date = getReservationDate(item);
      return date >= normalizedStart && date <= normalizedEnd;
    });
  }, [allReservations, startDate, endDate]);

  const hospitals = useMemo(() => {
    return Array.from(
      new Set(
        reservations
          .map(getHospital)
          .filter(Boolean)
      )
    ).sort();
  }, [reservations]);

  const filteredRows = useMemo(() => {
    return reservations.filter((item) => {
      if (hospitalFilter && getHospital(item) !== hospitalFilter) return false;
      if (apptTypeFilter && getAppointmentType(item) !== apptTypeFilter) return false;
      if (areaFilter && getConsultArea(item) !== areaFilter) return false;
      return true;
    });
  }, [reservations, hospitalFilter, apptTypeFilter, areaFilter]);

  const areaOptions = useMemo(() => {
    return Array.from(new Set(reservations.map(getConsultArea).filter(Boolean))).sort();
  }, [reservations]);

  const dashboard = useMemo(() => {
    const summary = emptyCounter("전체");
    const hospitalMap: Record<string, Counter> = {};
    const apptTypeMap: Record<string, Counter> = {};
    const areaMap: Record<string, Counter> = {};

    filteredRows.forEach((item) => {
      accumulate(summary, item);

      const hospital = getHospital(item) || "미지정";
      if (!hospitalMap[hospital]) hospitalMap[hospital] = emptyCounter(hospital);
      accumulate(hospitalMap[hospital], item);

      const apptType = getAppointmentType(item);
      if (!apptTypeMap[apptType]) apptTypeMap[apptType] = emptyCounter(apptType);
      accumulate(apptTypeMap[apptType], item);

      const area = getConsultArea(item);
      if (!areaMap[area]) areaMap[area] = emptyCounter(area);
      accumulate(areaMap[area], item);
    });

    const finalizedSummary = finalizeCounter(summary);

    const hospitalRows = Object.values(hospitalMap)
      .filter((item) => item.total > 0)
      .map((item) => finalizeCounter(item))
      .sort((a, b) => b.total - a.total || cleanText(a.name).localeCompare(cleanText(b.name)));

    const apptTypeRows = (["상담", "수술", "치료", "경과"] as const).map((type) => {
      const counter = apptTypeMap[type] || emptyCounter(type);
      return finalizeCounter(counter, summary.total);
    });

    const areaRows = Object.values(areaMap)
      .filter((item) => item.total > 0)
      .map((item) => finalizeCounter(item, summary.total))
      .sort((a, b) => b.total - a.total || cleanText(a.name).localeCompare(cleanText(b.name)));

    return { summary: finalizedSummary, hospitalRows, apptTypeRows, areaRows };
  }, [filteredRows]);

  const cancelledCount = useMemo(() => filteredRows.filter((r) => r.cancelled === true).length, [filteredRows]);
  const cancelledRate = filteredRows.length ? Math.round((cancelledCount / filteredRows.length) * 100) : 0;

  const coordinatorRows = useMemo(() => {
    const map = new Map<string, { total: number; completed: number; cancelled: number }>();
    for (const r of filteredRows) {
      const managers = getManagers(r);
      const names = managers.length ? managers : ["미지정"];
      for (const name of names) {
        if (!map.has(name)) map.set(name, { total: 0, completed: 0, cancelled: 0 });
        const s = map.get(name)!;
        s.total++;
        if (isCompleted(r)) s.completed++;
        if (r.cancelled === true) s.cancelled++;
      }
    }
    return [...map.entries()]
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.total - a.total);
  }, [filteredRows]);

  function handleQuickRange(type: "today" | "week" | "month" | "last7" | "last30") {
    const range = setQuickRange(type);
    setStartDate(range.start);
    setEndDate(range.end);
  }

  function resetFilters() {
    setHospitalFilter("");
    setApptTypeFilter("");
    setAreaFilter("");
  }

  const rangeText = startDate === endDate ? `${startDate} 기준` : `${startDate} ~ ${endDate}`;

  const APPT_TYPE_COLORS: Record<string, string> = {
    상담: "#2563eb",
    수술: "#ef4444",
    치료: "#16a34a",
    경과: "#f59e0b",
  };

  return (
    <div className="space-y-5">
      <section className="rounded-[18px] border border-[#edf0f3] bg-white p-5 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
        <div className="grid grid-cols-2 items-end gap-3 xl:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs text-gray-500">시작일</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-10 min-w-0 w-full appearance-none rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">종료일</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-10 min-w-0 w-full appearance-none rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">병원</label>
            <select
              value={hospitalFilter}
              onChange={(e) => setHospitalFilter(e.target.value)}
              className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">전체 병원</option>
              {hospitals.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">예약 유형</label>
            <select
              value={apptTypeFilter}
              onChange={(e) => setApptTypeFilter(e.target.value)}
              className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">전체 유형</option>
              <option value="상담">상담</option>
              <option value="수술">수술</option>
              <option value="치료">치료</option>
              <option value="경과">경과</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">상담부위</label>
            <select
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
              className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">전체 부위</option>
              {areaOptions.map((area) => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={resetFilters}
              className="h-10 flex-1 rounded-xl bg-[#111827] px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
            >
              초기화
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <QuickButton onClick={() => handleQuickRange("today")}>오늘</QuickButton>
          <QuickButton onClick={() => handleQuickRange("week")}>이번 주</QuickButton>
          <QuickButton onClick={() => handleQuickRange("month")}>이번 달</QuickButton>
          <QuickButton onClick={() => handleQuickRange("last7")}>지난 7일</QuickButton>
          <QuickButton onClick={() => handleQuickRange("last30")}>지난 30일</QuickButton>
        </div>

        <div className="mt-3 text-xs text-gray-400">
          {error ? error : `집계 모드 · 표시 ${filteredRows.length.toLocaleString("ko-KR")}건`}
        </div>
      </section>

      {/* KPI 카드 */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-2 xl:grid-cols-2">
        <KpiCard label="취소" value={cancelledCount.toLocaleString("ko-KR")} sub={`취소율 ${cancelledRate}%`} />
      </section>

      {/* 유형별 현황 */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["상담", "수술", "치료", "경과"] as const).map((type) => {
          const row = dashboard.apptTypeRows.find((r) => r.name === type);
          const count = row?.total || 0;
          const completed = row?.completedCount || 0;
          return (
            <div
              key={type}
              className="rounded-[14px] border border-black/5 bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.04)]"
              style={{ borderLeftWidth: 4, borderLeftColor: APPT_TYPE_COLORS[type] }}
            >
              <div className="text-xs font-bold" style={{ color: APPT_TYPE_COLORS[type] }}>{type}</div>
              <div className="mt-1 text-[24px] font-bold text-gray-900">{count.toLocaleString("ko-KR")}</div>
              <div className="mt-0.5 text-xs text-gray-500">
                완료 {completed}건 · 미완료 {count - completed}건
              </div>
            </div>
          );
        })}
      </section>

      {/* 병원별 KPI */}
      <Panel title="병원별 KPI">
        <KpiTable
          headers={["병원명", "상담", "내원", "수술예약", "완료", "전환율", "예약금"]}
          rows={dashboard.hospitalRows.map((row) => [
            row.name || "미지정",
            row.total.toLocaleString("ko-KR"),
            row.visited.toLocaleString("ko-KR"),
            row.surgery.toLocaleString("ko-KR"),
            row.completedCount.toLocaleString("ko-KR"),
            pctText(row.surgeryRate),
            formatDepositMap(row.depositByCurrency).join(" / "),
          ])}
        />
      </Panel>

      <Panel title="상담부위별 KPI">
        <KpiTable
          headers={["상담부위", "상담", "수술예약", "전환율", "비중", "예약금"]}
          rows={dashboard.areaRows.map((row) => [
            row.name || "미지정",
            row.total.toLocaleString("ko-KR"),
            row.surgery.toLocaleString("ko-KR"),
            pctText(row.surgeryRate),
            pctText(row.shareRate || 0),
            formatDepositMap(row.depositByCurrency).join(" / "),
          ])}
        />
      </Panel>

      <Panel title="담당자별 KPI">
        <KpiTable
          headers={["담당자", "총 예약", "완료", "취소", "완료율"]}
          rows={coordinatorRows.map((r) => [
            r.name,
            r.total.toLocaleString("ko-KR"),
            r.completed.toLocaleString("ko-KR"),
            r.cancelled.toLocaleString("ko-KR"),
            pctText(r.total ? Math.round((r.completed / r.total) * 100) : 0),
          ])}
        />
      </Panel>

      <Panel
        title="예약 상세 리스트"
        rightText={`${filteredRows.length.toLocaleString("ko-KR")}건 표시`}
      >
        <KpiTable
          headers={["날짜", "시간", "이름", "병원", "유형", "상담부위", "담당자", "상태", "예약금"]}
          rows={filteredRows
            .slice()
            .sort((a, b) => {
              const dateDiff = getReservationDate(a).localeCompare(getReservationDate(b));
              if (dateDiff !== 0) return dateDiff;
              return getReservationTime(a).localeCompare(getReservationTime(b));
            })
            .slice(0, 500)
            .map((row) => [
              getReservationDate(row) || "-",
              getReservationTime(row) || "-",
              getPatientName(row),
              getHospital(row) || "-",
              getAppointmentType(row),
              getConsultArea(row),
              getManagers(row).join(", ") || "-",
              row.cancelled === true ? "취소" : isCompleted(row) ? "완료" : "미완료",
              cleanText(row.depositAmount || row.deposit_amount || row.deposit || "-") || "-",
            ])}
        />
      </Panel>
    </div>
  );
}
