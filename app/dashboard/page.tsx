"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayString } from "@/lib/dateUtils";
import {
  type StaffDoc,
  type ReservationDoc,
  type Counter,
  cleanText,
  getStaffDisplayName,
  getReservationDate,
  getReservationTime,
  getPatientName,
  getConsultArea,
  getDoctors,
  getManagers,
  getStatus,
  isSurgeryReserved,
  emptyCounter,
  accumulate,
  finalizeCounter,
  formatDepositMap,
  pctText,
  setQuickRange,
} from "@/lib/dashboardUtils";
import { QuickButton } from "@/components/dashboard/QuickButton";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { BarStatusRow } from "@/components/dashboard/BarStatusRow";
import { Panel } from "@/components/dashboard/Panel";
import { KpiTable } from "@/components/dashboard/KpiTable";

export default function DashboardPage() {
  const [reservations, setReservations] = useState<ReservationDoc[]>([]);
  const [staff, setStaff] = useState<StaffDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [startDate, setStartDate] = useState(todayString());
  const [endDate, setEndDate] = useState(todayString());
  const [doctorFilter, setDoctorFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const normalizedStart = startDate <= endDate ? startDate : endDate;
      const normalizedEnd = startDate <= endDate ? endDate : startDate;

      if (normalizedStart !== startDate) setStartDate(normalizedStart);
      if (normalizedEnd !== endDate) setEndDate(normalizedEnd);

      const reservationQuery = query(
        collection(db, "reservations"),
        where("reservationDate", ">=", normalizedStart),
        where("reservationDate", "<=", normalizedEnd)
      );

      const [reservationSnap, staffSnap] = await Promise.all([
        getDocs(reservationQuery),
        getDocs(collection(db, "staff")),
      ]);

      const reservationRows = reservationSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<ReservationDoc, "id">),
      }));

      const staffRows = staffSnap.docs.map((docSnap) => ({
        uid: docSnap.id,
        ...(docSnap.data() as StaffDoc),
      }));

      setReservations(reservationRows);
      setStaff(staffRows);
    } catch (err) {
      console.error(err);
      setError("대시보드 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doctors = useMemo(() => {
    return staff
      .filter((item) => item.active !== false)
      .filter((item) => cleanText(item.role).toLowerCase() === "doctor")
      .map((item) => ({
        name: getStaffDisplayName(item),
        orderNo: Number(item.orderNo || item.order_no || 999999),
      }))
      .filter((item) => item.name)
      .sort((a, b) => a.orderNo - b.orderNo || a.name.localeCompare(b.name));
  }, [staff]);

  const managers = useMemo(() => {
    return staff
      .filter((item) => item.active !== false)
      .filter((item) =>
        ["admin", "coordinator", "staff"].includes(cleanText(item.role).toLowerCase())
      )
      .map((item) => ({
        name: getStaffDisplayName(item),
        orderNo: Number(item.orderNo || item.order_no || 999999),
      }))
      .filter((item) => item.name)
      .sort((a, b) => a.orderNo - b.orderNo || a.name.localeCompare(b.name));
  }, [staff]);

  const filteredRows = useMemo(() => {
    return reservations.filter((item) => {
      const date = getReservationDate(item);
      if (date < startDate || date > endDate) return false;
      if (doctorFilter && !getDoctors(item).includes(doctorFilter)) return false;
      if (managerFilter && !getManagers(item).includes(managerFilter)) return false;
      if (areaFilter && getConsultArea(item) !== areaFilter) return false;
      return true;
    });
  }, [reservations, startDate, endDate, doctorFilter, managerFilter, areaFilter]);

  const areaOptions = useMemo(() => {
    return Array.from(new Set(reservations.map(getConsultArea).filter(Boolean))).sort();
  }, [reservations]);

  const dashboard = useMemo(() => {
    const summary = emptyCounter("전체");
    const doctorMap: Record<string, Counter> = {};
    const managerMap: Record<string, Counter> = {};
    const areaMap: Record<string, Counter> = {};

    doctors.forEach((doctor) => {
      doctorMap[doctor.name] = emptyCounter(doctor.name);
    });

    filteredRows.forEach((item) => {
      accumulate(summary, item);

      getDoctors(item).forEach((doctorName) => {
        if (!doctorMap[doctorName]) doctorMap[doctorName] = emptyCounter(doctorName);
        accumulate(doctorMap[doctorName], item);
      });

      getManagers(item).forEach((managerName) => {
        if (!managerMap[managerName]) managerMap[managerName] = emptyCounter(managerName);
        accumulate(managerMap[managerName], item);
      });

      const area = getConsultArea(item);
      if (!areaMap[area]) areaMap[area] = emptyCounter(area);
      accumulate(areaMap[area], item);
    });

    const finalizedSummary = finalizeCounter(summary);

    const doctorRows = Object.values(doctorMap)
      .filter((item) => item.total > 0 || doctors.some((d) => d.name === item.name))
      .map((item) => finalizeCounter(item))
      .sort((a, b) => {
        const ao = doctors.find((d) => d.name === a.name)?.orderNo || 999999;
        const bo = doctors.find((d) => d.name === b.name)?.orderNo || 999999;
        return ao - bo || cleanText(a.name).localeCompare(cleanText(b.name));
      });

    const managerRows = Object.values(managerMap)
      .filter((item) => item.total > 0)
      .map((item) => finalizeCounter(item))
      .sort((a, b) => b.total - a.total || cleanText(a.name).localeCompare(cleanText(b.name)));

    const areaRows = Object.values(areaMap)
      .filter((item) => item.total > 0)
      .map((item) => finalizeCounter(item, summary.total))
      .sort((a, b) => b.total - a.total || cleanText(a.name).localeCompare(cleanText(b.name)));

    return { summary: finalizedSummary, doctorRows, managerRows, areaRows };
  }, [filteredRows, doctors]);

  function handleQuickRange(type: "today" | "week" | "month" | "last7" | "last30") {
    const range = setQuickRange(type);
    setStartDate(range.start);
    setEndDate(range.end);
    setTimeout(() => { loadData(); }, 0);
  }

  function resetFilters() {
    setDoctorFilter("");
    setManagerFilter("");
    setAreaFilter("");
  }

  const rangeText = startDate === endDate ? `${startDate} 기준` : `${startDate} ~ ${endDate}`;

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
              className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">종료일</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">원장님</label>
            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">전체 원장</option>
              {doctors.map((doctor) => (
                <option key={doctor.name} value={doctor.name}>{doctor.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">실장</label>
            <select
              value={managerFilter}
              onChange={(e) => setManagerFilter(e.target.value)}
              className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">전체 실장</option>
              {managers.map((manager) => (
                <option key={manager.name} value={manager.name}>{manager.name}</option>
              ))}
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
              onClick={loadData}
              disabled={loading}
              className="h-10 flex-1 rounded-xl bg-[#1d9e75] px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
            >
              {loading ? "집계 중..." : "조회"}
            </button>

            <button
              onClick={resetFilters}
              className="h-10 rounded-xl bg-[#111827] px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
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
          {error ? error : `Firestore 집계 모드 · 표시 ${filteredRows.length.toLocaleString("ko-KR")}건`}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="전체예약" value={dashboard.summary.total.toLocaleString("ko-KR")} sub={rangeText} />
        <KpiCard label="실제내원" value={dashboard.summary.visited.toLocaleString("ko-KR")} sub={`내원율 ${pctText(dashboard.summary.visitRate)}`} />
        <KpiCard label="귀가" value={dashboard.summary.left.toLocaleString("ko-KR")} sub="상담 종료" />
        <KpiCard label="부도" value={dashboard.summary.noShow.toLocaleString("ko-KR")} sub={`부도율 ${pctText(dashboard.summary.noShowRate)}`} />
        <KpiCard label="수술예약" value={dashboard.summary.surgery.toLocaleString("ko-KR")} sub={`전환율 ${pctText(dashboard.summary.surgeryRate)}`} />
        <KpiCard label="예약금 합계" depositLines={formatDepositMap(dashboard.summary.depositByCurrency)} sub="통화별 분리 집계" compact />
      </section>

      <Panel title="핵심 현황">
        <div className="space-y-4">
          <BarStatusRow label="전체예약" count={dashboard.summary.total} percentage={100} />
          <BarStatusRow
            label="실제내원"
            count={dashboard.summary.visited}
            percentage={dashboard.summary.total ? Math.round((dashboard.summary.visited / dashboard.summary.total) * 100) : 0}
          />
          <BarStatusRow
            label="부도"
            count={dashboard.summary.noShow}
            percentage={dashboard.summary.total ? Math.round((dashboard.summary.noShow / dashboard.summary.total) * 100) : 0}
          />
          <BarStatusRow
            label="수술예약"
            count={dashboard.summary.surgery}
            percentage={dashboard.summary.total ? Math.round((dashboard.summary.surgery / dashboard.summary.total) * 100) : 0}
          />
        </div>
      </Panel>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="원장님별 KPI">
          <KpiTable
            headers={["원장님", "상담", "내원", "수술예약", "전환율", "예약금"]}
            rows={dashboard.doctorRows.map((row) => [
              row.name || "미지정",
              row.total.toLocaleString("ko-KR"),
              row.visited.toLocaleString("ko-KR"),
              row.surgery.toLocaleString("ko-KR"),
              pctText(row.surgeryRate),
              formatDepositMap(row.depositByCurrency).join(" / "),
            ])}
          />
        </Panel>

        <Panel title="담당 실장별 KPI">
          <KpiTable
            headers={["담당자", "배정", "내원", "수술예약", "전환율", "예약금"]}
            rows={dashboard.managerRows.map((row) => [
              row.name || "미지정",
              row.total.toLocaleString("ko-KR"),
              row.visited.toLocaleString("ko-KR"),
              row.surgery.toLocaleString("ko-KR"),
              pctText(row.surgeryRate),
              formatDepositMap(row.depositByCurrency).join(" / "),
            ])}
          />
        </Panel>
      </section>

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

      <Panel
        title="예약 상세 리스트"
        rightText={`${filteredRows.length.toLocaleString("ko-KR")}건 표시`}
      >
        <KpiTable
          headers={["날짜", "시간", "이름", "원장", "상담부위", "담당자", "상태", "수술예약", "예약금"]}
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
              getDoctors(row).join(", ") || "-",
              getConsultArea(row),
              getManagers(row).join(", ") || "-",
              getStatus(row),
              isSurgeryReserved(row) ? "예약" : "-",
              cleanText(row.depositAmount || row.deposit_amount || row.deposit || "-") || "-",
            ])}
        />
      </Panel>
    </div>
  );
}
