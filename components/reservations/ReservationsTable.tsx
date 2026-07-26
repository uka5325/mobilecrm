"use client";

import { useState } from "react";
import type { ReservationRecord, AppointmentType } from "@/features/reservations/domain/reservationModels";
import { getReservationBirthInfo } from "@/features/reservations/domain/reservationUtils";
import { getInvoicesByPatientId, getInvoicesByPatientCache } from "@/features/invoices/data/client/invoices";
import { getCachedPatientSettlements, listPatientSettlements } from "@/features/settlements/data/client/settlements";
import { getLogsByReservationId, type LogRecord } from "@/lib/logs";
import { LogsTab } from "@/components/timeline/tabs/LogsTab";
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
  lastReservationTime?: string;
  hasMemo?: boolean;
  hasInvoice?: boolean;
};

export type PatientEditForm = {
  name: string;
  birthInput: string;
  phone: string;
  nationality: string;
  gender: string;
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

function recentReservationText(group: PatientGroup) {
  if (!group.lastReservationDate) return "최근 예약 없음";
  const timeText = group.lastReservationTime ? ` ${group.lastReservationTime}` : "";
  const reservation = group.reservations[0];
  const typeText = reservation?.appointmentType || "예약";

  return `${group.lastReservationDate}${timeText} · ${typeText}`;
}

export function ReservationsTable({
  patientGroups,
  loading,
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
  const [invoiceModal, setInvoiceModal] = useState<{ patientId: string; patientName: string } | null>(null);
  const [settlementModal, setSettlementModal] = useState<{ patientId: string; patientName: string } | null>(null);
  const [detailGroup, setDetailGroup] = useState<PatientGroup | null>(null);
  const [logModal, setLogModal] = useState<{ patientId: string; patientName: string } | null>(null);
  const [patientLogs, setPatientLogs] = useState<LogRecord[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");

  function prefetchInvoiceModal(patientId: string) {
    if (!patientId) return;
    if (!getInvoicesByPatientCache(patientId)) void getInvoicesByPatientId(patientId);
  }

  function prefetchSettlementModal(patientId: string) {
    if (!patientId || getCachedPatientSettlements(patientId)) return;
    void listPatientSettlements(patientId, { includeAppointments: false });
  }

  function openReservationList(group: PatientGroup) {
    onOpenPatientHistory?.(group.patientId, group.name);
  }

  async function openPatientLogs(group: PatientGroup) {
    setLogModal({ patientId: group.patientId, patientName: group.name });
    setPatientLogs([]);
    setLogsError("");
    setLogsLoading(true);

    try {
      const logs = await getLogsByReservationId("", "", group.patientId, { sinceDays: 0 });
      setPatientLogs(logs);
    } catch {
      setLogsError("로그를 불러오지 못했습니다.");
    } finally {
      setLogsLoading(false);
    }
  }

  function renderEditCard(group: PatientGroup) {
    const pf = patientEditForm;
    if (!pf) return null;

    return (
      <article key={group.patientKey} className="rounded-[24px] bg-white p-3 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            className="h-9 rounded-[16px] border border-[#dfe3e8] bg-white px-3 text-sm font-semibold text-[#101828] focus:border-[#0f9b8e] focus:outline-none"
            value={pf.name}
            placeholder="이름"
            onChange={(e) => onPatientFormChange((p) => p && ({ ...p, name: e.target.value }))}
          />
          <input
            className="h-9 rounded-[16px] border border-[#dfe3e8] bg-white px-3 text-sm text-[#344054] focus:border-[#0f9b8e] focus:outline-none"
            value={pf.birthInput}
            placeholder="생년월일"
            onChange={(e) => onPatientFormChange((p) => p && ({ ...p, birthInput: e.target.value }))}
          />
          <input
            className="h-9 rounded-[16px] border border-[#dfe3e8] bg-white px-3 text-sm text-[#344054] focus:border-[#0f9b8e] focus:outline-none"
            value={pf.phone}
            placeholder="연락처"
            onChange={(e) => onPatientFormChange((p) => p && ({ ...p, phone: e.target.value }))}
          />
          <input
            className="h-9 rounded-[16px] border border-[#dfe3e8] bg-white px-3 text-sm text-[#344054] focus:border-[#0f9b8e] focus:outline-none"
            value={pf.nationality}
            placeholder="국적"
            onChange={(e) => onPatientFormChange((p) => p && ({ ...p, nationality: e.target.value }))}
          />
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelPatientEdit}
            className="h-8 rounded-[16px] bg-[#f6f7f5] px-3 text-xs font-semibold text-[#667085] transition active:scale-95"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onSavePatientEdit(group)}
            disabled={patientEditSaving}
            className="h-8 rounded-[16px] bg-[#0f9b8e] px-3 text-xs font-semibold text-white transition active:scale-95 disabled:opacity-50"
          >
            {patientEditSaving ? "저장 중" : "저장"}
          </button>
        </div>
      </article>
    );
  }

  function renderPatientCard(group: PatientGroup) {
    const isEditing = patientEditId === group.patientKey;
    if (isEditing) return renderEditCard(group);

    const birthInfo = getReservationBirthInfo({
      birth: group.birth,
      birthInput: group.birthInput,
      gender: group.gender,
    } as Parameters<typeof getReservationBirthInfo>[0]);
    const pid = group.patientId || group.patientKey;
    const reservationCount = group.reservationCount ?? group.reservations.length;
    const settlementCount = group.settlementCount ?? 0;
    const invoiceCount = group.invoiceCount ?? 0;
    const memoCount = group.memoCount ?? 0;
    const metaItems = [
      birthInfo.birthDisplay ? `${birthInfo.birthDisplay}${birthInfo.ageText ? ` (${birthInfo.ageText})` : ""}` : "",
      group.gender,
      group.nationality,
      group.phone,
    ].filter(Boolean);

    return (
      <article key={group.patientKey} className="rounded-[24px] bg-white p-3 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-base font-bold tracking-[-0.04em] text-[#101828]">{group.name || "이름 없음"}</h3>
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-[#667085]">
              {metaItems.length > 0 ? metaItems.map((item) => <span key={item}>{item}</span>) : <span>기본 정보 없음</span>}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onAddReservation(group)}
            className="h-8 shrink-0 rounded-[16px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-3 text-xs font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition active:scale-95"
          >
            + 예약
          </button>
        </div>

        <div className="mt-2 border-t border-[#edf0f3] pt-2">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-[#667085]">{recentReservationText(group)}</div>
            </div>

            <div className="flex flex-wrap gap-1.5 lg:justify-end">
              <button
                type="button"
                onClick={() => onOpenPatientMemo(group)}
                className="h-7 rounded-[14px] bg-[#f6f7f5] px-2.5 text-[11px] font-semibold text-[#667085] transition active:scale-95"
              >
                메모{memoCount > 0 ? ` ${memoCount}` : ""}
              </button>
              <button
                type="button"
                onFocus={() => prefetchInvoiceModal(pid)}
                onMouseEnter={() => prefetchInvoiceModal(pid)}
                onClick={() => setInvoiceModal({ patientId: pid, patientName: group.name })}
                className="h-7 rounded-[14px] bg-[#e3f2ee] px-2.5 text-[11px] font-semibold text-[#0f9b8e] transition active:scale-95"
              >
                인보이스{invoiceCount > 0 ? ` ${invoiceCount}` : ""}
              </button>
              <button
                type="button"
                onFocus={() => prefetchSettlementModal(pid)}
                onMouseEnter={() => prefetchSettlementModal(pid)}
                onClick={() => setSettlementModal({ patientId: pid, patientName: group.name })}
                className="h-7 rounded-[14px] bg-[#eef4ff] px-2.5 text-[11px] font-semibold text-[#2563eb] transition active:scale-95"
              >
                정산{settlementCount > 0 ? ` ${settlementCount}` : ""}
              </button>
              {onOpenPatientHistory ? (
                <button
                  type="button"
                  onClick={() => openReservationList(group)}
                  className="h-7 rounded-[14px] bg-[#f6f7f5] px-2.5 text-[11px] font-semibold text-[#667085] transition active:scale-95"
                >
                  예약{reservationCount > 0 ? ` ${reservationCount}${group.reservationCountCapped ? "+" : ""}` : ""}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setDetailGroup(group)}
                className="h-7 rounded-[14px] bg-white px-2.5 text-[11px] font-semibold text-[#344054] shadow-[inset_0_0_0_1px_#dfe3e8] transition active:scale-95"
              >
                더 보기
              </button>
            </div>
          </div>
        </div>
      </article>
    );
  }

  function renderList() {
    if (loading && patientGroups.length === 0) {
      return <div className="rounded-[24px] bg-white p-8 text-center text-sm text-[#8b93a1] shadow-[0_10px_28px_rgba(15,23,42,0.05)]">데이터 로딩 중...</div>;
    }

    if (listError) {
      return (
        <div className="rounded-[24px] bg-white p-8 text-center shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
          <div className="text-sm text-red-500">{listError}</div>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-3 rounded-[18px] bg-[#e3f2ee] px-4 py-2 text-sm font-semibold text-[#0f9b8e]">
              다시 시도
            </button>
          )}
        </div>
      );
    }

    if (patientGroups.length === 0) {
      return <div className="rounded-[24px] bg-white p-8 text-center text-sm text-[#8b93a1] shadow-[0_10px_28px_rgba(15,23,42,0.05)]">고객이 없습니다.</div>;
    }

    return patientGroups.map((group) => renderPatientCard(group));
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

      {detailGroup && (
        <div className="fixed inset-0 z-[997] flex items-end justify-center bg-black/35 px-3 py-4 lg:items-center" onClick={() => setDetailGroup(null)}>
          <div className="w-full max-w-lg rounded-[28px] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.24)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-bold tracking-[0.14em] text-[#0f9b8e]">CUSTOMER DETAIL</div>
                <h2 className="mt-2 break-words text-2xl font-bold tracking-[-0.04em] text-[#101828]">{detailGroup.name}</h2>
                <p className="mt-2 text-sm leading-6 text-[#667085]">
                  고객 정보 수정, 로그 확인, 고객 삭제를 관리합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailGroup(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f6f7f5] text-xl text-[#667085]"
              >
                ×
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  onStartPatientEdit(detailGroup);
                  setDetailGroup(null);
                }}
                className="rounded-[18px] bg-[#e3f2ee] px-4 py-3 text-sm font-semibold text-[#0f9b8e] transition active:scale-95"
              >
                정보 수정
              </button>
              <button
                type="button"
                onClick={() => {
                  void openPatientLogs(detailGroup);
                  setDetailGroup(null);
                }}
                className="rounded-[18px] bg-[#f6f7f5] px-4 py-3 text-sm font-semibold text-[#344054] transition active:scale-95"
              >
                로그 보기
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeletePatient(detailGroup);
                  setDetailGroup(null);
                }}
                className="col-span-2 rounded-[18px] bg-red-50 px-4 py-3 text-sm font-semibold text-red-500 transition active:scale-95"
              >
                고객 삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {logModal && (
        <div className="fixed inset-0 z-[997] flex items-end justify-center bg-black/35 px-3 py-4 lg:items-center" onClick={() => setLogModal(null)}>
          <div className="w-full max-w-lg rounded-[28px] bg-[#f6f7f5] p-5 shadow-[0_24px_80px_rgba(15,23,42,0.24)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold tracking-[0.14em] text-[#0f9b8e]">CUSTOMER LOG</div>
                <h2 className="mt-2 text-xl font-bold tracking-[-0.04em] text-[#101828]">{logModal.patientName} 로그</h2>
              </div>
              <button
                type="button"
                onClick={() => setLogModal(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-xl text-[#667085]"
              >
                ×
              </button>
            </div>

            <div className="max-h-[62vh] overflow-y-auto">
              <LogsTab logs={patientLogs} loading={logsLoading} error={logsError} />
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2.5 px-1 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 lg:px-0">
        {renderList()}
      </div>
    </>
  );
}
