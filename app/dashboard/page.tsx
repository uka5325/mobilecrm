"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayString } from "@/lib/dateUtils";

type StaffRole = "admin" | "doctor" | "coordinator" | "staff" | "interpreter";

type StaffDoc = {
  uid?: string;
  email?: string;
  displayName?: string;
  display_name?: string;
  name?: string;
  role?: StaffRole | string;
  active?: boolean;
  orderNo?: number;
  order_no?: number;
};

type ReservationDoc = {
  id: string;

  reservationId?: string;
  reservation_id?: string;

  name?: string;
  patientName?: string;
  patient_name?: string;

  reservationDate?: string;
  reservation_date?: string;
  date?: string;

  reservationTime?: string;
  reservation_time?: string;
  time?: string;

  consultArea?: string;
  consult_area?: string;
  area?: string;

  doctors?: string[];
  doctor?: string;
  doctorName?: string;
  doctor_name?: string;

  coordinators?: string[];
  manager?: string;
  managerName?: string;
  manager_name?: string;
  coordinator?: string;

  operationStatus?: string;
  operation_status?: string;
  status?: string;

  surgeryReserved?: boolean;
  surgery_reserved?: boolean;
  surgeryStatus?: string;
  surgery_status?: string;

  depositAmount?: string;
  deposit_amount?: string;
  deposit?: string | number;

  nationality?: string;
  phone?: string;
};

type Counter = {
  name?: string;
  total: number;
  visited: number;
  noShow: number;
  surgery: number;
  before: number;
  wait: number;
  cons: number;
  post: number;
  left: number;
  depositByCurrency: Record<string, number>;
};

type KpiRow = Counter & {
  visitRate: number;
  surgeryRate: number;
  noShowRate: number;
  shareRate?: number;
};

const CURRENCY_ORDER = ["KRW", "MNT", "USD", "JPY", "CNY", "VND"];
const CURRENCY_SYMBOL: Record<string, string> = {
  KRW: "₩",
  MNT: "₮",
  USD: "$",
  JPY: "¥",
  CNY: "¥",
  VND: "₫",
};

function formatDate(date: Date) {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function cleanName(value: unknown) {
  let text = cleanText(value);

  if (!text) return "";

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        text = parsed.map(cleanName).filter(Boolean).join(", ");
      }
    } catch {
      // ignore
    }
  }

  return text
    .replace(/^\s*\[\s*|\s*\]\s*$/g, "")
    .replace(/^\s*["']+|["']+\s*$/g, "")
    .replace(/\\"/g, "")
    .replace(/["']/g, "")
    .trim();
}

function splitNames(value: unknown) {
  if (Array.isArray(value)) return value.map(cleanName).filter(Boolean);

  return cleanText(value)
    .split(/[,/|·、，\n]/)
    .map(cleanName)
    .filter(Boolean);
}

function normalizeDate(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";

  const dot = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (dot) {
    return `${dot[1]}-${String(Number(dot[2])).padStart(2, "0")}-${String(
      Number(dot[3])
    ).padStart(2, "0")}`;
  }

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  return raw.slice(0, 10);
}

function normalizeTime(value: unknown) {
  const raw = cleanText(value);
  const m = raw.match(/(\d{1,2}):(\d{2})/);

  if (!m) return raw || "-";

  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

function getReservationDate(item: ReservationDoc) {
  return normalizeDate(
    item.reservationDate || item.reservation_date || item.date || ""
  );
}

function getReservationTime(item: ReservationDoc) {
  return normalizeTime(
    item.reservationTime || item.reservation_time || item.time || ""
  );
}

function getPatientName(item: ReservationDoc) {
  return cleanName(item.name || item.patientName || item.patient_name || "-");
}

function getConsultArea(item: ReservationDoc) {
  return cleanName(
    item.consultArea || item.consult_area || item.area || "미지정"
  );
}

function getDoctors(item: ReservationDoc) {
  const fromArray = splitNames(item.doctors);
  const fromSingle = splitNames(
    item.doctor || item.doctorName || item.doctor_name
  );

  return Array.from(new Set([...fromArray, ...fromSingle])).filter(Boolean);
}

function getManagers(item: ReservationDoc) {
  const fromArray = splitNames(item.coordinators);
  const fromSingle = splitNames(
    item.manager || item.managerName || item.manager_name || item.coordinator
  );

  return Array.from(new Set([...fromArray, ...fromSingle])).filter(Boolean);
}

function getStatus(item: ReservationDoc) {
  return cleanText(
    item.operationStatus || item.operation_status || item.status || "내원전"
  );
}

function isSurgeryReserved(item: ReservationDoc) {
  if (typeof item.surgeryReserved === "boolean") return item.surgeryReserved;
  if (typeof item.surgery_reserved === "boolean") return item.surgery_reserved;

  const raw = cleanText(
    item.surgeryStatus || item.surgery_status || item.surgery_reserved || ""
  ).toLowerCase();

  return [
    "true",
    "1",
    "y",
    "yes",
    "예약",
    "수술예약",
    "수술 예약",
    "확정",
    "완료",
    "o",
    "○",
  ].includes(raw);
}

function parseMoney(value: unknown) {
  if (typeof value === "number") return value;

  const raw = cleanText(value).replace(/,/g, "");
  const m = raw.match(/-?\d+(\.\d+)?/);

  return m ? Number(m[0]) : 0;
}

function detectCurrency(value: unknown) {
  const raw = cleanText(value).toLowerCase();

  if (
    raw.includes("투그릭") ||
    raw.includes("mnt") ||
    raw.includes("₮") ||
    raw.includes("төг") ||
    raw.includes("tugrik")
  ) {
    return "MNT";
  }

  if (raw.includes("달러") || raw.includes("usd") || raw.includes("$")) {
    return "USD";
  }

  if (
    raw.includes("엔") ||
    raw.includes("jpy") ||
    raw.includes("¥") ||
    raw.includes("円")
  ) {
    return "JPY";
  }

  if (
    raw.includes("위안") ||
    raw.includes("cny") ||
    raw.includes("rmb") ||
    raw.includes("元") ||
    raw.includes("￥")
  ) {
    return "CNY";
  }

  if (raw.includes("동") || raw.includes("vnd") || raw.includes("₫")) {
    return "VND";
  }

  return "KRW";
}

function parseDepositParts(value: unknown) {
  const raw = cleanText(value);

  if (!raw) return [];

  return raw
    .split("/")
    .map((part) => {
      const amount = parseMoney(part);
      if (!amount) return null;

      return {
        currency: detectCurrency(part),
        amount,
      };
    })
    .filter(Boolean) as { currency: string; amount: number }[];
}

function emptyCounter(name?: string): Counter {
  return {
    name,
    total: 0,
    visited: 0,
    noShow: 0,
    surgery: 0,
    before: 0,
    wait: 0,
    cons: 0,
    post: 0,
    left: 0,
    depositByCurrency: {},
  };
}

function addDeposit(counter: Counter, item: ReservationDoc) {
  const raw = item.depositAmount || item.deposit_amount || item.deposit || "";
  const parts = parseDepositParts(raw);

  parts.forEach((part) => {
    counter.depositByCurrency[part.currency] =
      (counter.depositByCurrency[part.currency] || 0) + part.amount;
  });
}

function accumulate(counter: Counter, item: ReservationDoc) {
  const status = getStatus(item);

  counter.total += 1;

  if (status === "내원전") counter.before += 1;
  if (status === "대기") counter.wait += 1;
  if (status === "원상중") counter.cons += 1;
  if (status === "후상중") counter.post += 1;
  if (status === "귀가") counter.left += 1;
  if (status === "부도") counter.noShow += 1;

  if (status !== "부도" && status !== "내원전") counter.visited += 1;
  if (isSurgeryReserved(item)) counter.surgery += 1;

  addDeposit(counter, item);
}

function rate(a: number, b: number) {
  if (!b) return 0;

  return Math.round((a / b) * 1000) / 10;
}

function finalizeCounter(counter: Counter, shareBase?: number): KpiRow {
  return {
    ...counter,
    visitRate: rate(counter.visited, counter.total),
    noShowRate: rate(counter.noShow, counter.total),
    surgeryRate: rate(counter.surgery, counter.visited || counter.total),
    shareRate: shareBase ? rate(counter.total, shareBase) : 0,
  };
}

function formatDepositMap(map: Record<string, number>) {
  const parts: string[] = [];

  CURRENCY_ORDER.forEach((currency) => {
    const amount = Number(map[currency] || 0);
    if (!amount) return;

    parts.push(`${amount.toLocaleString("ko-KR")}${CURRENCY_SYMBOL[currency]}`);
  });

  Object.keys(map)
    .sort()
    .forEach((currency) => {
      if (CURRENCY_ORDER.includes(currency)) return;

      const amount = Number(map[currency] || 0);
      if (!amount) return;

      parts.push(`${amount.toLocaleString("ko-KR")}${currency}`);
    });

  return parts.length ? parts : ["0₩"];
}

function pctText(value: number) {
  return `${Number(value || 0).toFixed(1).replace(".0", "")}%`;
}

function setQuickRange(type: "today" | "week" | "month" | "last7" | "last30") {
  const now = new Date();
  let start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let end = new Date(start.getTime());

  if (type === "week") {
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    end = new Date(start.getTime());
    end.setDate(start.getDate() + 6);
  }

  if (type === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }

  if (type === "last7") {
    start.setDate(start.getDate() - 6);
  }

  if (type === "last30") {
    start.setDate(start.getDate() - 29);
  }

  return {
    start: formatDate(start),
    end: formatDate(end),
  };
}

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

      const reservationRows = reservationSnap.docs.map((docSnap) => {
        return {
          id: docSnap.id,
          ...(docSnap.data() as Omit<ReservationDoc, "id">),
        };
      });

      const staffRows = staffSnap.docs.map((docSnap) => {
        return {
          uid: docSnap.id,
          ...(docSnap.data() as StaffDoc),
        };
      });

      setReservations(reservationRows);
      setStaff(staffRows);
    } catch (err) {
      console.error(err);
      setError(
        "대시보드 데이터를 불러오지 못했습니다. Firestore 권한 또는 인덱스를 확인해 주세요."
      );
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
        name: cleanName(item.displayName || item.display_name || item.name),
        orderNo: Number(item.orderNo || item.order_no || 999999),
      }))
      .filter((item) => item.name)
      .sort((a, b) => a.orderNo - b.orderNo || a.name.localeCompare(b.name));
  }, [staff]);

  const managers = useMemo(() => {
    return staff
      .filter((item) => item.active !== false)
      .filter((item) =>
        ["admin", "coordinator", "staff"].includes(
          cleanText(item.role).toLowerCase()
        )
      )
      .map((item) => ({
        name: cleanName(item.displayName || item.display_name || item.name),
        orderNo: Number(item.orderNo || item.order_no || 999999),
      }))
      .filter((item) => item.name)
      .sort((a, b) => a.orderNo - b.orderNo || a.name.localeCompare(b.name));
  }, [staff]);

  const filteredRows = useMemo(() => {
    return reservations.filter((item) => {
      const date = getReservationDate(item);
      if (date < startDate || date > endDate) return false;

      if (doctorFilter && !getDoctors(item).includes(doctorFilter)) {
        return false;
      }

      if (managerFilter && !getManagers(item).includes(managerFilter)) {
        return false;
      }

      if (areaFilter && getConsultArea(item) !== areaFilter) {
        return false;
      }

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

      const itemDoctors = getDoctors(item);
      itemDoctors.forEach((doctorName) => {
        if (!doctorMap[doctorName]) {
          doctorMap[doctorName] = emptyCounter(doctorName);
        }

        accumulate(doctorMap[doctorName], item);
      });

      const itemManagers = getManagers(item);
      itemManagers.forEach((managerName) => {
        if (!managerMap[managerName]) {
          managerMap[managerName] = emptyCounter(managerName);
        }

        accumulate(managerMap[managerName], item);
      });

      const area = getConsultArea(item);
      if (!areaMap[area]) areaMap[area] = emptyCounter(area);
      accumulate(areaMap[area], item);
    });

    const finalizedSummary = finalizeCounter(summary);

    const doctorRows = Object.values(doctorMap)
      .filter(
        (item) =>
          item.total > 0 || doctors.some((doctor) => doctor.name === item.name)
      )
      .map((item) => finalizeCounter(item))
      .sort((a, b) => {
        const ao =
          doctors.find((doctor) => doctor.name === a.name)?.orderNo || 999999;
        const bo =
          doctors.find((doctor) => doctor.name === b.name)?.orderNo || 999999;

        return ao - bo || cleanText(a.name).localeCompare(cleanText(b.name));
      });

    const managerRows = Object.values(managerMap)
      .filter((item) => item.total > 0)
      .map((item) => finalizeCounter(item))
      .sort(
        (a, b) =>
          b.total - a.total || cleanText(a.name).localeCompare(cleanText(b.name))
      );

    const areaRows = Object.values(areaMap)
      .filter((item) => item.total > 0)
      .map((item) => finalizeCounter(item, summary.total))
      .sort(
        (a, b) =>
          b.total - a.total || cleanText(a.name).localeCompare(cleanText(b.name))
      );

    return {
      summary: finalizedSummary,
      doctorRows,
      managerRows,
      areaRows,
    };
  }, [filteredRows, doctors]);

  function handleQuickRange(
    type: "today" | "week" | "month" | "last7" | "last30"
  ) {
    const range = setQuickRange(type);
    setStartDate(range.start);
    setEndDate(range.end);

    setTimeout(() => {
      loadData();
    }, 0);
  }

  function resetFilters() {
    setDoctorFilter("");
    setManagerFilter("");
    setAreaFilter("");
  }

  const rangeText =
    startDate === endDate ? `${startDate} 기준` : `${startDate} ~ ${endDate}`;

  return (
    <div className="space-y-5">
      <section className="rounded-[18px] border border-[#edf0f3] bg-white p-5 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-2 xl:grid-cols-6">
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
                <option key={doctor.name} value={doctor.name}>
                  {doctor.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">담당 실장</label>
            <select
              value={managerFilter}
              onChange={(e) => setManagerFilter(e.target.value)}
              className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">전체 실장</option>
              {managers.map((manager) => (
                <option key={manager.name} value={manager.name}>
                  {manager.name}
                </option>
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
                <option key={area} value={area}>
                  {area}
                </option>
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
          <QuickButton onClick={() => handleQuickRange("today")}>
            오늘
          </QuickButton>
          <QuickButton onClick={() => handleQuickRange("week")}>
            이번 주
          </QuickButton>
          <QuickButton onClick={() => handleQuickRange("month")}>
            이번 달
          </QuickButton>
          <QuickButton onClick={() => handleQuickRange("last7")}>
            지난 7일
          </QuickButton>
          <QuickButton onClick={() => handleQuickRange("last30")}>
            지난 30일
          </QuickButton>
        </div>

        <div className="mt-3 text-xs text-gray-400">
          {error
            ? error
            : `Firestore 집계 모드 · 표시 ${filteredRows.length.toLocaleString(
                "ko-KR"
              )}건`}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="전체예약"
          value={dashboard.summary.total.toLocaleString("ko-KR")}
          sub={rangeText}
        />
        <KpiCard
          label="실제내원"
          value={dashboard.summary.visited.toLocaleString("ko-KR")}
          sub={`내원율 ${pctText(dashboard.summary.visitRate)}`}
        />
        <KpiCard
          label="귀가"
          value={dashboard.summary.left.toLocaleString("ko-KR")}
          sub="상담 종료"
        />
        <KpiCard
          label="부도"
          value={dashboard.summary.noShow.toLocaleString("ko-KR")}
          sub={`부도율 ${pctText(dashboard.summary.noShowRate)}`}
        />
        <KpiCard
          label="수술예약"
          value={dashboard.summary.surgery.toLocaleString("ko-KR")}
          sub={`전환율 ${pctText(dashboard.summary.surgeryRate)}`}
        />
        <KpiCard
          label="예약금 합계"
          depositLines={formatDepositMap(dashboard.summary.depositByCurrency)}
          sub="통화별 분리 집계"
          compact
        />
      </section>

      <Panel title="핵심 현황">
        <div className="space-y-4">
          <BarStatusRow
            label="전체예약"
            count={dashboard.summary.total}
            percentage={100}
          />

          <BarStatusRow
            label="실제내원"
            count={dashboard.summary.visited}
            percentage={
              dashboard.summary.total
                ? Math.round(
                    (dashboard.summary.visited / dashboard.summary.total) * 100
                  )
                : 0
            }
          />

          <BarStatusRow
            label="부도"
            count={dashboard.summary.noShow}
            percentage={
              dashboard.summary.total
                ? Math.round(
                    (dashboard.summary.noShow / dashboard.summary.total) * 100
                  )
                : 0
            }
          />

          <BarStatusRow
            label="수술예약"
            count={dashboard.summary.surgery}
            percentage={
              dashboard.summary.total
                ? Math.round(
                    (dashboard.summary.surgery / dashboard.summary.total) * 100
                  )
                : 0
            }
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
          headers={[
            "날짜",
            "시간",
            "이름",
            "원장",
            "상담부위",
            "담당자",
            "상태",
            "수술예약",
            "예약금",
          ]}
          rows={filteredRows
            .slice()
            .sort((a, b) => {
              const dateDiff = getReservationDate(a).localeCompare(
                getReservationDate(b)
              );
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
              cleanText(
                row.depositAmount || row.deposit_amount || row.deposit || "-"
              ) || "-",
            ])}
        />
      </Panel>
    </div>
  );
}

function QuickButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-700 transition hover:-translate-y-0.5 hover:bg-gray-200 active:scale-95"
    >
      {children}
    </button>
  );
}

function KpiCard({
  label,
  value,
  sub,
  depositLines,
  compact,
}: {
  label: string;
  value?: string;
  sub: string;
  depositLines?: string[];
  compact?: boolean;
}) {
  return (
    <div className="flex min-h-[150px] flex-col rounded-[20px] border border-[#edf0f3] bg-white px-6 py-5 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
      <div className="text-base font-bold leading-tight text-gray-700">
        {label}
      </div>

      <div
        className={`flex flex-1 flex-col ${
          compact ? "justify-start pt-5" : "justify-center -translate-y-1"
        }`}
      >
        {depositLines ? (
          <div className="flex flex-col gap-0.5 text-lg font-extrabold leading-relaxed text-gray-900">
            {depositLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        ) : (
          <div className="text-[34px] font-black leading-none tracking-[-0.7px] text-gray-900">
            {value}
          </div>
        )}

        <div
          className={`${
            compact ? "mt-4" : "mt-3"
          } text-[13px] font-medium leading-relaxed text-gray-400`}
        >
          {sub}
        </div>
      </div>
    </div>
  );
}

function BarStatusRow({
  label,
  count,
  percentage,
}: {
  label: string;
  count: number;
  percentage: number;
}) {
  const safePercentage = Math.min(Math.max(percentage, 0), 100);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-gray-500">
          {count.toLocaleString("ko-KR")}명 · {safePercentage}%
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-[#1d9e75]"
          style={{ width: `${safePercentage}%` }}
        />
      </div>
    </div>
  );
}

function Panel({
  title,
  rightText,
  children,
}: {
  title: string;
  rightText?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[18px] border border-[#edf0f3] bg-white p-5 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        {rightText && <span className="text-xs text-gray-400">{rightText}</span>}
      </div>

      {children}
    </section>
  );
}

function KpiTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                className="whitespace-nowrap border-b border-[#edf0f3] bg-gray-50 px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={headers.length}
                className="py-8 text-center text-sm text-gray-400"
              >
                데이터가 없습니다.
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={`${row.join("-")}-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${cell}-${cellIndex}`}
                    className="whitespace-nowrap border-b border-[#f1f3f5] px-3 py-3 text-gray-700"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
