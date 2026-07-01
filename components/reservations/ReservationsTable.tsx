"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import type { ReservationRecord, AppointmentType } from "@/lib/reservations";
import { APPOINTMENT_TYPES } from "@/lib/reservations";
import { getReservationBirthInfo } from "@/lib/reservationUtils";
import { getInvoiceCountByPatientId, getCachedInvoiceCount } from "@/lib/invoices";
import { getPatientFullHistoryCached, getCachedPatientFullHistory } from "@/lib/reservations";
import { PatientInvoiceModal } from "./PatientInvoiceModal";

export type PatientGroup = {
  patientKey: string;
  patientId: string;
  name: string;
  birth: string;
  birthInput: string;
  gender: string;
  phone: string;
  nationality: string;
  reservations: ReservationRecord[];
};

export type PatientEditForm = {
  name: string;
  birthInput: string;
  phone: string;
  nationality: string;
  gender: string;
};

const APPT_TYPE_COLORS: Record<AppointmentType, string> = {
  상담: "#2563eb",
  수술: "#ef4444",
  시술: "#db2777",
  치료: "#16a34a",
  경과: "#f59e0b",
  진료: "#7c3aed",
  검진: "#0891b2",
};

type InlineForm = {
  name: string; birthInput: string; phone: string; nationality: string;
  consultArea: string; reservationDate: string; reservationTime: string;
  coordinators: string; depositAmount: string; surgeryCost: string; hospital: string;
  doctors: string;
  appointmentType: AppointmentType;
} | null;

type Props = {
  patientGroups: PatientGroup[];
  loading: boolean;
  inlineEditId: string | null;
  inlineForm: InlineForm;
  inlineSaving: boolean;
  onFormChange: (updater: (prev: InlineForm) => InlineForm) => void;
  onStartEdit: (item: ReservationRecord) => void;
  onSaveEdit: (item: ReservationRecord) => void;
  onCancelEdit: () => void;
  onDelete: (item: ReservationRecord) => void;
  onAddReservation: (group: PatientGroup) => void;
  // 환자 헤더 편집
  patientEditId: string | null;
  patientEditForm: PatientEditForm | null;
  patientEditSaving: boolean;
  onPatientFormChange: (updater: (prev: PatientEditForm | null) => PatientEditForm | null) => void;
  onStartPatientEdit: (group: PatientGroup) => void;
  onSavePatientEdit: (group: PatientGroup) => void;
  onCancelPatientEdit: () => void;
  onDeletePatient: (group: PatientGroup) => void;
  onOpenPatientMemo: (group: PatientGroup) => void;
  onOpenPatientHistory?: (patientId: string, name: string) => void;
  onSaveAmount: (reservationId: string, field: "depositAmount" | "surgeryCost", value: string) => Promise<void>;
};

function getConsultAreas(reservations: ReservationRecord[], type: AppointmentType): string {
  const areas = reservations
    .filter((r) => r.appointmentType === type && r.consultArea)
    .map((r) => r.consultArea);
  return [...new Set(areas)].join(", ") || "—";
}

type AmountPopoverProps = {
  label: string;
  rows: { id: string; date: string; hospital: string; amount: string }[];
  onClose: () => void;
  onSave: (reservationId: string, newAmount: string) => Promise<void>;
};

function AmountPopover({ label, rows, onClose, onSave }: AmountPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  async function handleSave(id: string) {
    setSaving(true);
    try {
      await onSave(id, editValue);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={ref}
      className="absolute z-50 mt-1 min-w-[300px] rounded-xl border border-gray-200 bg-white shadow-xl"
    >
      <div className="border-b border-gray-100 px-4 py-2.5 text-xs font-bold text-gray-700">{label} 내역</div>
      <div className="max-h-60 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-4 py-3 text-xs text-gray-400">내역 없음</div>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2 border-b border-gray-50 px-3 py-2 last:border-0">
              <span className="text-xs text-gray-500 w-[70px] shrink-0">{row.date || "—"}</span>
              <span className="text-xs text-gray-500 truncate flex-1">{row.hospital || "—"}</span>
              {editingId === row.id ? (
                <>
                  <input
                    autoFocus
                    className="w-[90px] rounded-lg border border-[#dfe3e8] px-2 py-0.5 text-xs focus:border-[#1d9e75] focus:outline-none"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                  />
                  <button
                    disabled={saving}
                    onClick={() => handleSave(row.id)}
                    className="rounded-lg bg-emerald-600 px-2 py-0.5 text-xs text-white disabled:opacity-50"
                  >
                    {saving ? "…" : "저장"}
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-600">
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs font-medium text-gray-800 w-[80px] text-right">{row.amount || "—"}</span>
                  <button
                    onClick={() => { setEditingId(row.id); setEditValue(row.amount); }}
                    className="text-xs text-blue-500 hover:underline shrink-0"
                  >
                    {row.amount ? "수정" : "입력"}
                  </button>
                  {row.amount && (
                    <button
                      onClick={async () => { setSaving(true); try { await onSave(row.id, ""); setEditingId(null); } finally { setSaving(false); } }}
                      className="text-xs text-red-400 hover:underline shrink-0"
                    >
                      삭제
                    </button>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function ReservationsTable({
  patientGroups,
  loading,
  inlineEditId,
  inlineForm,
  inlineSaving,
  onFormChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onAddReservation,
  patientEditId,
  patientEditForm,
  patientEditSaving,
  onPatientFormChange,
  onStartPatientEdit,
  onSavePatientEdit,
  onCancelPatientEdit,
  onDeletePatient,
  onOpenPatientMemo,
  onOpenPatientHistory,
  onSaveAmount,
}: Props) {
  const cellCls = "border-b border-gray-100 px-2 py-2";
  const inputCls = "w-full rounded-lg border border-[#dfe3e8] px-2 py-1 text-xs focus:border-[#1d9e75] focus:outline-none";

  type PopoverState = { groupKey: string; type: "deposit" | "surgery" } | null;
  const [amountPopover, setAmountPopover] = useState<PopoverState>(null);
  const [invoiceModal, setInvoiceModal] = useState<{ patientId: string; patientName: string; reservations: ReservationRecord[] } | null>(null);
  const [invoiceCounts, setInvoiceCounts] = useState<Record<string, number>>({});
  const invoiceCountsRef = useRef<Record<string, number>>({});
  useEffect(() => { invoiceCountsRef.current = invoiceCounts; }, [invoiceCounts]);

  const handleCountLoaded = useCallback((pid: string, count: number) => {
    setInvoiceCounts((prev) => ({ ...prev, [pid]: count }));
  }, []);

  useEffect(() => {
    if (!patientGroups.length) return;
    patientGroups.forEach((g) => {
      const pid = g.patientId || g.patientKey;
      if (!pid || pid in invoiceCountsRef.current) return;
      // 캐시 있으면 즉시 반영(재진입 시 재조회 없음), 없으면 1회 조회
      const cached = getCachedInvoiceCount(pid);
      if (cached !== undefined) {
        setInvoiceCounts((prev) => ({ ...prev, [pid]: cached }));
        return;
      }
      getInvoiceCountByPatientId(pid)
        .then((count) => setInvoiceCounts((prev) => ({ ...prev, [pid]: count })))
        .catch(() => {});
    });
  }, [patientGroups]);

  // 환자 카드 배지("총 건수"/예약금/수술비용/부위)를 라이브 윈도우(45일)와 무관하게
  // 정확히 표시하기 위한 전체 이력 지연 로드 — invoiceCounts와 동일한 구조.
  const [fullHistory, setFullHistory] = useState<Record<string, ReservationRecord[]>>({});
  const fullHistoryRef = useRef<Record<string, ReservationRecord[]>>({});
  useEffect(() => { fullHistoryRef.current = fullHistory; }, [fullHistory]);

  useEffect(() => {
    if (!patientGroups.length) return;
    patientGroups.forEach((g) => {
      const pid = g.patientId || g.patientKey;
      if (!pid || pid in fullHistoryRef.current) return;
      const cached = getCachedPatientFullHistory(pid);
      if (cached) {
        setFullHistory((prev) => ({ ...prev, [pid]: cached.reservations }));
        return;
      }
      getPatientFullHistoryCached(pid)
        .then((result) => setFullHistory((prev) => ({ ...prev, [pid]: result.reservations })))
        .catch(() => {});
    });
  }, [patientGroups]);

  function toggleAmountPopover(groupKey: string, type: "deposit" | "surgery") {
    setAmountPopover((prev) =>
      prev?.groupKey === groupKey && prev.type === type ? null : { groupKey, type }
    );
  }

  function renderReservationRow(item: ReservationRecord) {
    const apptType = item.appointmentType || "상담";
    const isEditing = inlineEditId === item.id;
    const f = inlineForm;

    return (
      <tr key={item.id} className={isEditing ? "bg-emerald-50" : "hover:bg-gray-50"}>
        {/* 예약일 */}
        <td className={cellCls}>
          {isEditing ? (
            <input type="date" className="h-[26px] w-[110px] rounded-lg border border-[#dfe3e8] px-1 text-xs focus:border-[#1d9e75] focus:outline-none" value={f!.reservationDate} onChange={(e) => onFormChange((p) => p && ({ ...p, reservationDate: e.target.value }))} />
          ) : (
            <span className="text-gray-700">{item.reservationDate || "—"}</span>
          )}
        </td>

        {/* 예약시간 */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.reservationTime} onChange={(e) => onFormChange((p) => p && ({ ...p, reservationTime: e.target.value }))} placeholder="HH:MM" />
          ) : (
            <span className="text-gray-700">{item.reservationTime || "—"}</span>
          )}
        </td>

        {/* 병원명 */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.hospital} onChange={(e) => onFormChange((p) => p && ({ ...p, hospital: e.target.value }))} placeholder="병원명" />
          ) : (
            <span className="font-medium text-gray-700">{item.hospital || "-"}</span>
          )}
        </td>

        {/* 담당 원장 */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.doctors} onChange={(e) => onFormChange((p) => p && ({ ...p, doctors: e.target.value }))} placeholder="쉼표 구분" />
          ) : (
            <span className="text-gray-500 text-xs">{(item.doctors || []).join(", ") || "—"}</span>
          )}
        </td>

        {/* 예약 유형 */}
        <td className={cellCls}>
          {isEditing ? (
            <select
              className={inputCls}
              value={f!.appointmentType}
              onChange={(e) => onFormChange((p) => p && ({ ...p, appointmentType: e.target.value as AppointmentType }))}
            >
              {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: APPT_TYPE_COLORS[apptType] || "#6b7280" }}
            >
              {apptType}
            </span>
          )}
        </td>

        {/* 상담부위/수술항목 (편집 모드에서만 표시) */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.consultArea} onChange={(e) => onFormChange((p) => p && ({ ...p, consultArea: e.target.value }))} />
          ) : (
            <span className="text-gray-500 text-xs">{item.consultArea || "—"}</span>
          )}
        </td>

        {/* 담당자 */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.coordinators} onChange={(e) => onFormChange((p) => p && ({ ...p, coordinators: e.target.value }))} placeholder="쉼표 구분" />
          ) : (
            <span className="text-gray-500">{item.coordinators.join(", ")}</span>
          )}
        </td>

        {/* 관리 */}
        <td className={`${cellCls} text-center`}>
          {isEditing ? (
            <div className="flex justify-center gap-1">
              <button onClick={() => onSaveEdit(item)} disabled={inlineSaving} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-50">
                {inlineSaving ? "…" : "저장"}
              </button>
              <button onClick={onCancelEdit} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500">
                취소
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-0.5">
              <button onClick={() => onStartEdit(item)} className="px-2 py-1 text-xs text-blue-600 hover:underline">수정</button>
              <button onClick={() => onDelete(item)} className="px-2 py-1 text-xs text-red-500 hover:underline">삭제</button>
            </div>
          )}
        </td>
      </tr>
    );
  }

  function renderPatientHeader(group: PatientGroup) {
    const isEditing = patientEditId === group.patientKey;
    const pf = patientEditForm;

    const birthInfo = getReservationBirthInfo({
      birth: group.birth,
      birthInput: group.birthInput,
      gender: group.gender,
    } as Parameters<typeof getReservationBirthInfo>[0]);

    // 라이브 윈도우(45일)와 무관한 정확한 배지: 전체 이력 로딩 전에는 group.reservations로
    // fallback(0/빈 값 깜빡임 방지), 로딩 완료 시 전체 이력으로 교체.
    const pid = group.patientId || group.patientKey;
    const fullList = fullHistory[pid] ?? group.reservations;

    const surgeryReserved = fullList.some((r) => r.surgeryReserved);
    const consultAreas = getConsultAreas(fullList, "상담");
    const surgeryAreas = getConsultAreas(fullList, "수술");

    const makeKey = (r: typeof fullList[0]) => [
      (r.hospital || "").trim().toLowerCase(),
      (r.consultArea || "").trim().toLowerCase(),
      (r.doctors || []).map((d) => d.trim().toLowerCase()).sort().join(","),
    ].join("|");

    const depositRows = (() => {
      const seen = new Set<string>();
      return [...fullList]
        .sort((a, b) => (b.depositAmount ? 1 : 0) - (a.depositAmount ? 1 : 0))
        .filter((r) => {
          if (!r.depositAmount) return false;
          const key = makeKey(r);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((r) => ({ id: r.id, date: r.reservationDate || "", hospital: r.hospital || "", amount: r.depositAmount || "" }));
    })();
    const surgeryRows = (() => {
      const seen = new Set<string>();
      return [...fullList]
        .sort((a, b) => (b.surgeryCost ? 1 : 0) - (a.surgeryCost ? 1 : 0))
        .filter((r) => {
          if (!r.surgeryCost) return false;
          const key = makeKey(r);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((r) => ({ id: r.id, date: r.reservationDate || "", hospital: r.hospital || "", amount: r.surgeryCost || "" }));
    })();

    const depositPopoverOpen = amountPopover?.groupKey === group.patientKey && amountPopover.type === "deposit";
    const surgeryPopoverOpen = amountPopover?.groupKey === group.patientKey && amountPopover.type === "surgery";

    if (isEditing && pf) {
      return (
        <tr key={`patient-edit-${group.patientKey}`} className="bg-blue-50">
          <td colSpan={8} className="border-y border-blue-200 px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="h-7 w-[100px] rounded-lg border border-[#dfe3e8] bg-white px-2 text-xs font-bold focus:border-[#1d9e75] focus:outline-none"
                value={pf.name}
                placeholder="이름"
                onChange={(e) => onPatientFormChange((p) => p && ({ ...p, name: e.target.value }))}
              />
              <input
                className="h-7 w-[120px] rounded-lg border border-[#dfe3e8] bg-white px-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                value={pf.birthInput}
                placeholder="생년월일 (891210-1)"
                onChange={(e) => onPatientFormChange((p) => p && ({ ...p, birthInput: e.target.value }))}
              />
              <select
                className="h-7 w-[70px] rounded-lg border border-[#dfe3e8] bg-white px-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                value={pf.gender}
                onChange={(e) => onPatientFormChange((p) => p && ({ ...p, gender: e.target.value }))}
              >
                <option value="">성별</option>
                <option value="남">남</option>
                <option value="여">여</option>
              </select>
              <input
                className="h-7 w-[130px] rounded-lg border border-[#dfe3e8] bg-white px-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                value={pf.phone}
                placeholder="연락처"
                onChange={(e) => onPatientFormChange((p) => p && ({ ...p, phone: e.target.value }))}
              />
              <input
                className="h-7 w-[90px] rounded-lg border border-[#dfe3e8] bg-white px-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                value={pf.nationality}
                placeholder="국적"
                onChange={(e) => onPatientFormChange((p) => p && ({ ...p, nationality: e.target.value }))}
              />
              <div className="ml-auto flex gap-1">
                <button
                  onClick={() => onSavePatientEdit(group)}
                  disabled={patientEditSaving}
                  className="rounded-lg bg-emerald-600 px-3 py-1 text-xs text-white disabled:opacity-50"
                >
                  {patientEditSaving ? "…" : "저장"}
                </button>
                <button onClick={onCancelPatientEdit} className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-500">
                  취소
                </button>
              </div>
            </div>
          </td>
        </tr>
      );
    }

    return (
      <tr key={`patient-${group.patientKey}`} className="bg-blue-50">
        <td colSpan={8} className="border-y border-blue-100 px-4 py-2">
          {/* 1행: 환자 기본 정보 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mb-1.5">
            <span className="text-sm font-bold text-gray-900">{group.name}</span>
            {birthInfo.birthDisplay && (
              <span className="text-xs text-gray-500">{birthInfo.birthDisplay} ({birthInfo.ageText})</span>
            )}
            {group.gender && <span className="text-xs text-gray-500">{group.gender}</span>}
            {group.phone && <span className="text-xs text-gray-500">{group.phone}</span>}
            {group.nationality && <span className="text-xs text-gray-400">{group.nationality}</span>}
          </div>

          {/* 2행: 집계 정보 + 버튼 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {consultAreas !== "—" && (
              <span className="text-xs text-gray-600">
                <span className="font-medium text-blue-700">상담</span> {consultAreas}
              </span>
            )}
            {surgeryAreas !== "—" && (
              <span className="text-xs text-gray-600">
                <span className="font-medium text-red-600">수술</span> {surgeryAreas}
              </span>
            )}
            <span className={`text-xs font-medium ${surgeryReserved ? "text-purple-700" : "text-gray-400"}`}>
              수술예약 {surgeryReserved ? "✓" : "✗"}
            </span>

            {/* 예약금 버튼 + 팝오버 */}
            <div className="relative">
              <button
                onClick={() => toggleAmountPopover(group.patientKey, "deposit")}
                className={`rounded-md border px-2 py-0.5 text-xs transition ${depositRows.length > 0 ? "border-blue-200 bg-white text-blue-600 hover:bg-blue-50" : "border-gray-200 bg-white text-gray-400"}`}
              >
                예약금{depositRows.length > 0 ? ` (${depositRows.length})` : ""}
              </button>
              {depositPopoverOpen && (
                <AmountPopover
                  label="예약금"
                  rows={depositRows}
                  onClose={() => setAmountPopover(null)}
                  onSave={(id, v) => onSaveAmount(id, "depositAmount", v)}
                />
              )}
            </div>

            {/* 수술비용 버튼 + 팝오버 */}
            <div className="relative">
              <button
                onClick={() => toggleAmountPopover(group.patientKey, "surgery")}
                className={`rounded-md border px-2 py-0.5 text-xs transition ${surgeryRows.length > 0 ? "border-orange-200 bg-white text-orange-600 hover:bg-orange-50" : "border-gray-200 bg-white text-gray-400"}`}
              >
                수술비용{surgeryRows.length > 0 ? ` (${surgeryRows.length})` : ""}
              </button>
              {surgeryPopoverOpen && (
                <AmountPopover
                  label="수술비용"
                  rows={surgeryRows}
                  onClose={() => setAmountPopover(null)}
                  onSave={(id, v) => onSaveAmount(id, "surgeryCost", v)}
                />
              )}
            </div>

            {(() => {
              const pid = group.patientId || group.patientKey;
              const cnt = invoiceCounts[pid];
              return (
                <button
                  onClick={() => setInvoiceModal({ patientId: pid, patientName: group.name, reservations: group.reservations })}
                  className={`rounded-md border px-2 py-0.5 text-xs transition ${cnt !== undefined && cnt > 0 ? "border-emerald-200 bg-white text-[#1d9e75] hover:bg-emerald-50" : "border-gray-200 bg-white text-gray-400 hover:bg-gray-50"}`}
                >
                  인보이스{cnt !== undefined && cnt > 0 ? ` (${cnt})` : ""}
                </button>
              );
            })()}

            <div className="ml-auto flex items-center gap-1.5">
              {onOpenPatientHistory && (
                <button
                  onClick={() => onOpenPatientHistory(group.patientId, group.name)}
                  className="rounded-md border border-purple-200 bg-white px-2 py-0.5 text-xs text-purple-600 hover:bg-purple-50"
                >
                  전체 이력
                </button>
              )}
              <button
                onClick={() => onOpenPatientMemo(group)}
                className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                메모
              </button>
              <button
                onClick={() => onStartPatientEdit(group)}
                className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
              >
                수정
              </button>
              <button
                onClick={() => onAddReservation(group)}
                className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-emerald-600 hover:bg-emerald-50"
              >
                추가
              </button>
              <button
                onClick={() => onDeletePatient(group)}
                className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
              >
                삭제
              </button>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                총 {fullList.length}건
              </span>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  function renderBody() {
    if (loading) {
      return (
        <tr>
          <td colSpan={8} className="py-12 text-center text-gray-400">데이터 로딩 중...</td>
        </tr>
      );
    }
    if (patientGroups.length === 0) {
      return (
        <tr>
          <td colSpan={8} className="py-12 text-center text-gray-400">고객이 없습니다.</td>
        </tr>
      );
    }

    const rows: ReactNode[] = [];

    patientGroups.forEach((group) => {
      rows.push(renderPatientHeader(group));
    });

    return rows;
  }

  return (
    <>
    {invoiceModal && (
      <PatientInvoiceModal
        patientId={invoiceModal.patientId}
        patientName={invoiceModal.patientName}
        reservations={invoiceModal.reservations}
        onClose={() => setInvoiceModal(null)}
        onCountLoaded={handleCountLoaded}
      />
    )}
    <div className="-mx-6 lg:-mx-8">
      <div className="overflow-x-auto border-y border-gray-100 bg-white">
        <table className="min-w-[900px] w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[100px]" />
            <col className="w-[60px]" />
            <col className="w-[100px]" />
            <col className="w-[90px]" />
            <col className="w-[60px]" />
            <col className="w-[110px]" />
            <col className="w-[90px]" />
            <col className="w-[120px]" />
          </colgroup>

          <tbody>{renderBody()}</tbody>
        </table>
      </div>
    </div>
    </>
  );
}
