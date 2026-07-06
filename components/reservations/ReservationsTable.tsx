"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import type { ReservationRecord, AppointmentType } from "@/lib/reservations";
import { APPOINTMENT_TYPES, getPatientFullHistoryCached, invalidatePatientFullHistoryCache, updateReservationAmount } from "@/lib/reservations";
import { getReservationBirthInfo } from "@/lib/reservationUtils";
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
  // 고객관리 배지 요약(patients 문서 저장값). 백필 전엔 undefined → 배지 미표시/0.
  reservationCount?: number;
  depositCount?: number;
  surgeryCostCount?: number;
  invoiceCount?: number;
  memoCount?: number;
  lastReservationDate?: string;
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
  // 금액 저장/삭제 등 해당 환자 데이터가 바뀌었을 때 부모가 summary 행을 갱신하도록 알림.
  onPatientMutated?: (patientId: string) => void;
};

// 예약금/수술비 팝오버 한 줄(그룹 대표 예약). id=예약 문서 ID.
type AmountRow = { id: string; reservationId: string; patientId: string; date: string; hospital: string; amount: string };

type AmountPopoverProps = {
  label: string;
  loading?: boolean;
  rows: AmountRow[];
  onClose: () => void;
  onSave: (row: AmountRow, newAmount: string) => Promise<void>;
};

function AmountPopover({ label, loading, rows, onClose, onSave }: AmountPopoverProps) {
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

  async function handleSave(row: AmountRow) {
    setSaving(true);
    try {
      await onSave(row, editValue);
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
        {loading ? (
          <div className="px-4 py-3 text-xs text-gray-400">불러오는 중...</div>
        ) : rows.length === 0 ? (
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
                    onClick={() => handleSave(row)}
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
                      onClick={async () => { setSaving(true); try { await onSave(row, ""); setEditingId(null); } finally { setSaving(false); } }}
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
  onPatientMutated,
}: Props) {
  const cellCls = "border-b border-gray-100 px-2 py-2";
  const inputCls = "w-full rounded-lg border border-[#dfe3e8] px-2 py-1 text-xs focus:border-[#1d9e75] focus:outline-none";

  const [invoiceModal, setInvoiceModal] = useState<{ patientId: string; patientName: string } | null>(null);

  // 예약금/수술비 팝오버 — 배지 클릭 시 해당 환자 예약만 lazy-load해 그룹 팝오버로 표시.
  // (기존: 보이는 환자 전원의 전체 이력/인보이스 count를 미리 warm → summary 배지로 대체.)
  const [amountPopover, setAmountPopover] = useState<
    { groupKey: string; patientId: string; type: "deposit" | "surgery"; loading: boolean; rows: AmountRow[] } | null
  >(null);

  // ReservationsTable/patientSummary의 그룹 키와 동일 규칙(병원+부위+원장).
  const groupKeyOf = useCallback((r: ReservationRecord) => [
    (r.hospital || "").trim().toLowerCase(),
    (r.consultArea || "").trim().toLowerCase(),
    (r.doctors || []).map((d) => d.trim().toLowerCase()).sort().join(","),
  ].join("|"), []);

  const buildAmountRows = useCallback((list: ReservationRecord[], type: "deposit" | "surgery"): AmountRow[] => {
    const pick = (r: ReservationRecord) => (type === "deposit" ? r.depositAmount : r.surgeryCost) || "";
    const seen = new Set<string>();
    return [...list]
      .sort((a, b) => (pick(b) ? 1 : 0) - (pick(a) ? 1 : 0))
      .filter((r) => {
        if (!pick(r).trim()) return false;
        const key = groupKeyOf(r);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((r) => ({ id: r.id, reservationId: r.reservationId, patientId: r.patientId, date: r.reservationDate || "", hospital: r.hospital || "", amount: pick(r) }));
  }, [groupKeyOf]);

  const openAmountPopover = useCallback(async (group: PatientGroup, type: "deposit" | "surgery") => {
    const patientId = group.patientId || group.patientKey;
    let opening = false;
    setAmountPopover((prev) => {
      if (prev && prev.groupKey === group.patientKey && prev.type === type) return null; // 재클릭 → 닫기
      opening = true;
      return { groupKey: group.patientKey, patientId, type, loading: true, rows: [] };
    });
    if (!opening) return;
    try {
      const { reservations } = await getPatientFullHistoryCached(patientId);
      setAmountPopover((prev) => (prev && prev.groupKey === group.patientKey && prev.type === type
        ? { ...prev, loading: false, rows: buildAmountRows(reservations, type) } : prev));
    } catch {
      setAmountPopover((prev) => (prev && prev.groupKey === group.patientKey && prev.type === type
        ? { ...prev, loading: false, rows: [] } : prev));
    }
  }, [buildAmountRows]);

  const saveAmount = useCallback(async (row: AmountRow, value: string) => {
    const type = amountPopover?.type ?? "deposit";
    const field = type === "deposit" ? "depositAmount" as const : "surgeryCost" as const;
    await updateReservationAmount(row.id, row.reservationId, row.patientId, field, value);
    invalidatePatientFullHistoryCache(row.patientId);
    onPatientMutated?.(row.patientId);
    try {
      const { reservations } = await getPatientFullHistoryCached(row.patientId);
      setAmountPopover((prev) => (prev ? { ...prev, rows: buildAmountRows(reservations, prev.type) } : prev));
    } catch { /* 무시 */ }
  }, [amountPopover, buildAmountRows, onPatientMutated]);

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

    // 배지는 patients 문서의 저장된 summary로 표시(추가 조회 없음). 상세는 클릭 시 lazy-load.
    const pid = group.patientId || group.patientKey;
    const reservationCount = group.reservationCount ?? group.reservations.length;
    const depositCount = group.depositCount ?? 0;
    const surgeryCostCount = group.surgeryCostCount ?? 0;
    const invoiceCount = group.invoiceCount ?? 0;

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

          {/* 2행: summary 배지 + 버튼 (상세는 클릭 시 조회) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* 예약금 (묶음 그룹 수) — 클릭 시 해당 환자 예약 lazy-load */}
            <div className="relative">
              <button
                onClick={() => openAmountPopover(group, "deposit")}
                className={`rounded-md border px-2 py-0.5 text-xs transition ${depositCount > 0 ? "border-blue-200 bg-white text-blue-600 hover:bg-blue-50" : "border-gray-200 bg-white text-gray-400"}`}
              >
                예약금{depositCount > 0 ? ` (${depositCount})` : ""}
              </button>
              {depositPopoverOpen && amountPopover && (
                <AmountPopover
                  label="예약금"
                  loading={amountPopover.loading}
                  rows={amountPopover.rows}
                  onClose={() => setAmountPopover(null)}
                  onSave={saveAmount}
                />
              )}
            </div>

            {/* 수술비용 (묶음 그룹 수) */}
            <div className="relative">
              <button
                onClick={() => openAmountPopover(group, "surgery")}
                className={`rounded-md border px-2 py-0.5 text-xs transition ${surgeryCostCount > 0 ? "border-orange-200 bg-white text-orange-600 hover:bg-orange-50" : "border-gray-200 bg-white text-gray-400"}`}
              >
                수술비용{surgeryCostCount > 0 ? ` (${surgeryCostCount})` : ""}
              </button>
              {surgeryPopoverOpen && amountPopover && (
                <AmountPopover
                  label="수술비용"
                  loading={amountPopover.loading}
                  rows={amountPopover.rows}
                  onClose={() => setAmountPopover(null)}
                  onSave={saveAmount}
                />
              )}
            </div>

            {/* 인보이스 (건수) — summary */}
            <button
              onClick={() => setInvoiceModal({ patientId: pid, patientName: group.name })}
              className={`rounded-md border px-2 py-0.5 text-xs transition ${invoiceCount > 0 ? "border-emerald-200 bg-white text-[#1d9e75] hover:bg-emerald-50" : "border-gray-200 bg-white text-gray-400 hover:bg-gray-50"}`}
            >
              인보이스{invoiceCount > 0 ? ` (${invoiceCount})` : ""}
            </button>

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
                총 {reservationCount}건
              </span>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  function renderBody() {
    if (loading && patientGroups.length === 0) {
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
        onClose={() => setInvoiceModal(null)}
        onCountLoaded={() => { /* 배지는 summary로 표시 — count 콜백 불필요 */ }}
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
