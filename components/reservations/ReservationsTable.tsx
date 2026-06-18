"use client";

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
  onSurgeryToggle: (item: ReservationRecord) => void;
  onOpenMemo: (item: ReservationRecord) => void;
  onStartEdit: (item: ReservationRecord) => void;
  onSaveEdit: (item: ReservationRecord) => void;
  onCancelEdit: () => void;
  onDelete: (item: ReservationRecord) => void;
  onAddReservation: (item: ReservationRecord) => void;
};

export function ReservationsTable({
  patientGroups,
  loading,
  inlineEditId,
  inlineForm,
  inlineSaving,
  onFormChange,
  onSurgeryToggle,
  onOpenMemo,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onAddReservation,
}: Props) {
  const cellCls = "border-b border-gray-100 px-2 py-2";
  const inputCls = "w-full rounded-lg border border-[#dfe3e8] px-2 py-1 text-xs focus:border-[#1d9e75] focus:outline-none";

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

        {/* 상담부위/수술항목 */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.consultArea} onChange={(e) => onFormChange((p) => p && ({ ...p, consultArea: e.target.value }))} />
          ) : item.consultArea}
        </td>

        {/* 담당자 */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.coordinators} onChange={(e) => onFormChange((p) => p && ({ ...p, coordinators: e.target.value }))} placeholder="쉼표 구분" />
          ) : (
            <span className="text-gray-500">{item.coordinators.join(", ")}</span>
          )}
        </td>

        {/* 수술예약 */}
        <td className={`${cellCls} text-center`}>
          <button
            onClick={() => onSurgeryToggle(item)}
            className={`rounded-full px-2 py-1 text-xs ${item.surgeryReserved ? "bg-purple-50 text-purple-700" : "bg-gray-100 text-gray-500"}`}
          >
            {item.surgeryReserved ? "예약" : "미예약"}
          </button>
        </td>

        {/* 예약금 */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.depositAmount} onChange={(e) => onFormChange((p) => p && ({ ...p, depositAmount: e.target.value }))} />
          ) : (
            <span className="text-gray-600">{item.depositAmount || "—"}</span>
          )}
        </td>

        {/* 수술비용 */}
        <td className={cellCls}>
          {isEditing ? (
            <input className={inputCls} value={f!.surgeryCost} onChange={(e) => onFormChange((p) => p && ({ ...p, surgeryCost: e.target.value }))} />
          ) : (
            <span className="text-gray-600">{item.surgeryCost || "—"}</span>
          )}
        </td>

        {/* 메모 */}
        <td className={`${cellCls} text-xs text-gray-500`}>
          <button onClick={() => onOpenMemo(item)} className="text-emerald-700 hover:underline">전체보기</button>
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

  function renderBody() {
    if (loading) {
      return (
        <tr>
          <td colSpan={11} className="py-12 text-center text-gray-400">데이터 로딩 중...</td>
        </tr>
      );
    }
    if (patientGroups.length === 0) {
      return (
        <tr>
          <td colSpan={11} className="py-12 text-center text-gray-400">고객이 없습니다.</td>
        </tr>
      );
    }

    const rows: React.ReactNode[] = [];

    patientGroups.forEach((group) => {
      const birthInfo = getReservationBirthInfo({
        birth: group.birth,
        birthInput: group.birthInput,
        gender: group.gender,
      } as Parameters<typeof getReservationBirthInfo>[0]);

      rows.push(
        <tr key={`patient-${group.patientKey}`} className="bg-blue-50">
          <td colSpan={11} className="border-y border-blue-100 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-sm font-bold text-gray-900">{group.name}</span>
              {birthInfo.birthDisplay && (
                <span className="text-xs text-gray-500">{birthInfo.birthDisplay} ({birthInfo.ageText})</span>
              )}
              {group.gender && (
                <span className="text-xs text-gray-500">{group.gender}</span>
              )}
              {group.phone && (
                <span className="text-xs text-gray-500">{group.phone}</span>
              )}
              {group.nationality && (
                <span className="text-xs text-gray-400">{group.nationality}</span>
              )}
              <span className="ml-auto rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                총 {group.reservations.length}건
              </span>
            </div>
          </td>
        </tr>
      );

      group.reservations.forEach((item) => {
        rows.push(renderReservationRow(item));
      });
    });

    return rows;
  }

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8">
      <div className="overflow-x-auto border-y border-gray-100 bg-white">
        <table className="min-w-[1300px] w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[110px]" />
            <col className="w-[80px]" />
            <col className="w-[120px]" />
            <col className="w-[70px]" />
            <col className="w-[130px]" />
            <col className="w-[100px]" />
            <col className="w-[80px]" />
            <col className="w-[100px]" />
            <col className="w-[100px]" />
            <col className="w-[65px]" />
            <col className="w-[110px]" />
          </colgroup>

          <thead className="bg-gray-50">
            <tr>
              {["예약일", "시간", "병원명", "유형", "상담부위/수술항목", "담당자", "수술예약", "예약금", "수술비용", "메모", "관리"].map((head) => (
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
