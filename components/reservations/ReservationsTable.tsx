"use client";

import { useState, type ReactNode } from "react";
import type { ReservationRecord, AppointmentType } from "@/lib/reservations";
import { APPOINTMENT_TYPES } from "@/lib/reservations";
import { getReservationBirthInfo } from "@/lib/reservationUtils";
import { PatientInvoiceModal } from "./PatientInvoiceModal";
import { SettlementModal } from "@/components/settlements/SettlementModal";

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
  reservationCountCapped?: boolean;
  settlementCount?: number;
  netSettlementAmount?: number;
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
  coordinators: string; hospital: string;
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
  onPatientMutated?: (patientId: string) => void;
  listError?: string | null;
  onRetry?: () => void;
};

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
  listError,
  onRetry,
}: Props) {
  const cellCls = "border-b border-gray-100 px-2 py-2";
  const inputCls = "w-full rounded-lg border border-[#dfe3e8] px-2 py-1 text-xs focus:border-[#1d9e75] focus:outline-none";

  const [invoiceModal, setInvoiceModal] = useState<{ patientId: string; patientName: string } | null>(null);
  const [settlementModal, setSettlementModal] = useState<{ patientId: string; patientName: string } | null>(null);

  // 행 단위 인라인 편집 렌더러 — 현재 화면에서 호출되지 않는 레거시 경로(환자 헤더 편집으로 대체됨).
  // 부모의 inline-edit 상태 체인과 함께 별도 정리 예정. (3단계 범위 밖 — 다중 파일 정리 리스크)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    const settlementCount = group.settlementCount ?? 0;
    const invoiceCount = group.invoiceCount ?? 0;

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
            {/* 정산 원장 — patients.settlementCount 배지, 상세는 공용 모달 */}
            <button
              onClick={() => setSettlementModal({ patientId: pid, patientName: group.name })}
              className={`rounded-md border px-2 py-0.5 text-xs transition ${settlementCount > 0 ? "border-blue-200 bg-white text-blue-600 hover:bg-blue-50" : "border-gray-200 bg-white text-gray-400 hover:bg-gray-50"}`}
            >
              정산{settlementCount > 0 ? ` (${settlementCount})` : ""}
            </button>

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
                title="고객 목록에서 숨깁니다(예약 soft delete). 의료기록·인보이스·사진·메모는 보존됩니다."
                className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
              >
                고객 삭제
              </button>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                총 {reservationCount}{group.reservationCountCapped ? "+" : ""}건
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
    if (listError) {
      return (
        <tr>
          <td colSpan={8} className="py-12 text-center">
            <div className="text-red-500">{listError}</div>
            {onRetry && (
              <button onClick={onRetry} className="mt-2 text-sm text-blue-600 underline hover:text-blue-800">다시 시도</button>
            )}
          </td>
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
    {settlementModal && (
      <SettlementModal
        patientId={settlementModal.patientId}
        patientName={settlementModal.patientName}
        onClose={() => setSettlementModal(null)}
        onMutated={() => onPatientMutated?.(settlementModal.patientId)}
      />
    )}
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
