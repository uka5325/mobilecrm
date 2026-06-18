"use client";

import { useState, useRef, useEffect } from "react";
import type { ReservationRecord, AppointmentType } from "@/lib/reservations";
import { APPOINTMENT_TYPES } from "@/lib/reservations";
import { getReservationBirthInfo } from "@/lib/reservationUtils";

export type PatientGroup = {
  patientKey: string;
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
  치료: "#16a34a",
  경과: "#f59e0b",
};

type InlineForm = {
  name: string; birthInput: string; phone: string; nationality: string;
  consultArea: string; reservationDate: string; reservationTime: string;
  coordinators: string; depositAmount: string; surgeryCost: string; hospital: string;
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
  onAddReservation: (item: ReservationRecord) => void;
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
};

function getConsultAreas(reservations: ReservationRecord[], type: AppointmentType): string {
  const areas = reservations
    .filter((r) => r.appointmentType === type && r.consultArea)
    .map((r) => r.consultArea);
  return [...new Set(areas)].join(", ") || "—";
}

function sumAmounts(amounts: string[]): string {
  let total = 0;
  const nonNumeric: string[] = [];
  for (const a of amounts) {
    const n = parseFloat(a.replace(/[^0-9.]/g, ""));
    if (a.trim() && !isNaN(n) && n > 0) total += n;
    else if (a.trim()) nonNumeric.push(a.trim());
  }
  const parts: string[] = [];
  if (total > 0) parts.push(total.toLocaleString());
  parts.push(...nonNumeric);
  return parts.join(" + ") || "—";
}

type AmountPopoverProps = {
  label: string;
  rows: { date: string; hospital: string; amount: string }[];
  onClose: () => void;
};

function AmountPopover({ label, rows, onClose }: AmountPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-50 mt-1 min-w-[260px] rounded-xl border border-gray-200 bg-white shadow-xl"
    >
      <div className="border-b border-gray-100 px-4 py-2.5 text-xs font-bold text-gray-700">{label} 내역</div>
      <div className="max-h-60 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-4 py-3 text-xs text-gray-400">내역 없음</div>
        ) : (
          rows.map((row, i) => (
            <div key={i} className="flex items-center justify-between gap-3 border-b border-gray-50 px-4 py-2 last:border-0">
              <span className="text-xs text-gray-500">{row.date || "—"}</span>
              <span className="text-xs text-gray-500 truncate max-w-[90px]">{row.hospital || "—"}</span>
              <span className="text-xs font-medium text-gray-800">{row.amount || "—"}</span>
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
}: Props) {
  const cellCls = "border-b border-gray-100 px-2 py-2";
  const inputCls = "w-full rounded-lg border border-[#dfe3e8] px-2 py-1 text-xs focus:border-[#1d9e75] focus:outline-none";

  type PopoverState = { groupKey: string; type: "deposit" | "surgery" } | null;
  const [amountPopover, setAmountPopover] = useState<PopoverState>(null);

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
            <input type="date" className={inputCls} value={f!.reservationDate} onChange={(e) => onFormChange((p) => p && ({ ...p, reservationDate: e.target.value }))} />
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
            <div className="flex justify-center gap-0.5">
              <button onClick={() => onStartEdit(item)} className="px-2 py-1 text-xs text-blue-600 hover:underline">수정</button>
              <button onClick={() => onAddReservation(item)} className="px-2 py-1 text-xs text-emerald-600 hover:underline">추가</button>
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

    const surgeryReserved = group.reservations.some((r) => r.surgeryReserved);
    const consultAreas = getConsultAreas(group.reservations, "상담");
    const surgeryAreas = getConsultAreas(group.reservations, "수술");

    const depositRows = group.reservations
      .filter((r) => r.depositAmount && r.depositAmount.trim())
      .map((r) => ({ date: r.reservationDate || "", hospital: r.hospital || "", amount: r.depositAmount || "" }));
    const surgeryRows = group.reservations
      .filter((r) => r.surgeryCost && r.surgeryCost.trim())
      .map((r) => ({ date: r.reservationDate || "", hospital: r.hospital || "", amount: r.surgeryCost || "" }));

    const depositPopoverOpen = amountPopover?.groupKey === group.patientKey && amountPopover.type === "deposit";
    const surgeryPopoverOpen = amountPopover?.groupKey === group.patientKey && amountPopover.type === "surgery";

    if (isEditing && pf) {
      return (
        <tr key={`patient-edit-${group.patientKey}`} className="bg-blue-50">
          <td colSpan={7} className="border-y border-blue-200 px-4 py-2">
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
        <td colSpan={7} className="border-y border-blue-100 px-4 py-2">
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
                />
              )}
            </div>

            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => onOpenPatientMemo(group)}
                className="rounded-md border border-emerald-200 bg-white px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50"
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
                onClick={() => onDeletePatient(group)}
                className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
              >
                삭제
              </button>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                총 {group.reservations.length}건
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
          <td colSpan={7} className="py-12 text-center text-gray-400">데이터 로딩 중...</td>
        </tr>
      );
    }
    if (patientGroups.length === 0) {
      return (
        <tr>
          <td colSpan={7} className="py-12 text-center text-gray-400">고객이 없습니다.</td>
        </tr>
      );
    }

    const rows: React.ReactNode[] = [];

    patientGroups.forEach((group) => {
      rows.push(renderPatientHeader(group));
      group.reservations.forEach((item) => {
        rows.push(renderReservationRow(item));
      });
    });

    return rows;
  }

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8">
      <div className="overflow-x-auto border-y border-gray-100 bg-white">
        <table className="min-w-[900px] w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[110px]" />
            <col className="w-[75px]" />
            <col className="w-[130px]" />
            <col className="w-[70px]" />
            <col className="w-[140px]" />
            <col className="w-[110px]" />
            <col className="w-[110px]" />
          </colgroup>

          <thead className="bg-gray-50">
            <tr>
              {["예약일", "시간", "병원명", "유형", "상담/수술항목", "담당자", "관리"].map((head) => (
                <th key={head} className="border-b border-gray-200 px-4 py-3 text-left text-xs font-semibold text-gray-500">
                  {head}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>{renderBody()}</tbody>
        </table>
      </div>
    </div>
  );
}
