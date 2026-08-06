"use client";

import { useState } from "react";
import { getReservationBirthInfo } from "@/features/reservations/domain/reservationUtils";
import { getInvoicesByPatientId, getInvoicesByPatientCache } from "@/features/invoices/data/client/invoices";
import { getCachedPatientSettlements, listPatientSettlements } from "@/features/settlements/data/client/settlements";
import { getLogsByReservationId, type LogRecord } from "@/lib/logs";
import { LogsTab } from "@/components/timeline/tabs/LogsTab";
import { PatientInvoiceModal } from "./PatientInvoiceModal";
import { SettlementModal } from "@/components/settlements/SettlementModal";
import type { PatientEditForm, PatientGroup } from "./ReservationsTable";

type Props = {
  patientGroups: PatientGroup[];
  loading: boolean;
  patientEditId: string | null;
  patientEditForm: PatientEditForm | null;
  patientEditSaving: boolean;
  onPatientFormChange: (updater: (prev: PatientEditForm | null) => PatientEditForm | null) => void;
  onStartPatientEdit: (group: PatientGroup) => void;
  onSavePatientEdit: (group: PatientGroup) => void;
  onCancelPatientEdit: () => void;
  onDeletePatient: (group: PatientGroup) => void;
  onAddReservation: (group: PatientGroup) => void;
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
  const typeText = group.lastAppointmentType || reservation?.appointmentType || "예약";
  return `${group.lastReservationDate}${timeText} · ${typeText}`;
}

export function DesktopReservationsList({ patientGroups, loading, patientEditId, patientEditForm, patientEditSaving, onPatientFormChange, onStartPatientEdit, onSavePatientEdit, onCancelPatientEdit, onDeletePatient, onAddReservation, onOpenPatientMemo, onOpenPatientHistory, onPatientMutated, listError, onRetry }: Props) {
  const [invoiceModal, setInvoiceModal] = useState<{ patientId: string; patientName: string } | null>(null);
  const [settlementModal, setSettlementModal] = useState<{ patientId: string; patientName: string } | null>(null);
  const [detailGroup, setDetailGroup] = useState<PatientGroup | null>(null);
  const [logModal, setLogModal] = useState<{ patientId: string; patientName: string } | null>(null);
  const [patientLogs, setPatientLogs] = useState<LogRecord[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");

  function prefetchInvoiceModal(patientId: string) { if (patientId && !getInvoicesByPatientCache(patientId)) void getInvoicesByPatientId(patientId); }
  function prefetchSettlementModal(patientId: string) { if (patientId && !getCachedPatientSettlements(patientId)) void listPatientSettlements(patientId, { includeAppointments: false }); }
  async function openPatientLogs(group: PatientGroup) {
    setLogModal({ patientId: group.patientId, patientName: group.name });
    setPatientLogs([]); setLogsError(""); setLogsLoading(true);
    try { setPatientLogs(await getLogsByReservationId("", "", group.patientId, { sinceDays: 0 })); }
    catch { setLogsError("로그를 불러오지 못했습니다."); }
    finally { setLogsLoading(false); }
  }

  if (loading && patientGroups.length === 0) return <div className="rounded-[18px] border border-[#dfe7e4] bg-white p-8 text-center text-sm text-[#8b93a1]">데이터 로딩 중...</div>;
  if (listError) return <div className="rounded-[18px] border border-[#dfe7e4] bg-white p-8 text-center"><div className="text-sm text-red-500">{listError}</div>{onRetry ? <button type="button" onClick={onRetry} className="mt-3 rounded-[18px] bg-[#e3f2ee] px-4 py-2 text-sm font-semibold text-[#0f9b8e]">다시 시도</button> : null}</div>;
  if (patientGroups.length === 0) return <div className="rounded-[18px] border border-[#dfe7e4] bg-white p-8 text-center text-sm text-[#8b93a1]">고객이 없습니다.</div>;

  return <>
    {settlementModal ? <SettlementModal patientId={settlementModal.patientId} patientName={settlementModal.patientName} onClose={() => setSettlementModal(null)} onMutated={() => onPatientMutated?.(settlementModal.patientId)} /> : null}
    {invoiceModal ? <PatientInvoiceModal patientId={invoiceModal.patientId} patientName={invoiceModal.patientName} onClose={() => setInvoiceModal(null)} onCountLoaded={() => {}} /> : null}

    {detailGroup ? <div className="fixed inset-0 z-[997] flex items-center justify-center bg-black/35 px-3 py-8 backdrop-blur-[2px]" onClick={() => setDetailGroup(null)}><div className="w-full max-w-lg rounded-[30px] bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.26)]" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="text-xs font-bold tracking-[0.14em] text-[#0f9b8e]">CUSTOMER DETAIL</div><h2 className="mt-2 break-words text-2xl font-bold tracking-[-0.04em] text-[#101828]">{detailGroup.name}</h2><p className="mt-2 text-sm leading-6 text-[#667085]">고객 정보 수정, 로그 확인, 고객 삭제를 관리합니다.</p></div><button type="button" onClick={() => setDetailGroup(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f6f7f5] text-xl text-[#667085]">×</button></div><div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => { onStartPatientEdit(detailGroup); setDetailGroup(null); }} className="rounded-[18px] bg-[#e3f2ee] px-4 py-3 text-sm font-semibold text-[#0f9b8e]">정보 수정</button><button type="button" onClick={() => { void openPatientLogs(detailGroup); setDetailGroup(null); }} className="rounded-[18px] bg-[#f8fbfa] px-4 py-3 text-sm font-semibold text-[#344054]">로그 보기</button><button type="button" onClick={() => { onDeletePatient(detailGroup); setDetailGroup(null); }} className="col-span-2 rounded-[18px] bg-red-50 px-4 py-3 text-sm font-semibold text-red-500">고객 삭제</button></div></div></div> : null}

    {logModal ? <div className="fixed inset-0 z-[997] flex items-center justify-center bg-black/35 px-3 py-8 backdrop-blur-[2px]" onClick={() => setLogModal(null)}><div className="w-full max-w-lg rounded-[30px] bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.26)]" onClick={(event) => event.stopPropagation()}><div className="mb-4 flex items-start justify-between gap-4"><div><div className="text-xs font-bold tracking-[0.14em] text-[#0f9b8e]">CUSTOMER LOG</div><h2 className="mt-2 text-xl font-bold tracking-[-0.04em] text-[#101828]">{logModal.patientName} 로그</h2></div><button type="button" onClick={() => setLogModal(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-xl text-[#667085]">×</button></div><div className="max-h-[calc(100dvh-220px)] overflow-y-auto"><LogsTab logs={patientLogs} loading={logsLoading} error={logsError} /></div></div></div> : null}

    <section className="overflow-hidden rounded-[18px] border border-[#dfe7e4] bg-white">
      <div className="grid min-h-11 grid-cols-[minmax(250px,1.35fr)_minmax(150px,.8fr)_minmax(190px,1fr)_minmax(330px,1.65fr)_88px] items-center gap-4 border-b border-[#dfe7e4] bg-[#fbfdfc] px-4 text-[11px] font-semibold text-[#667085]"><div>고객</div><div>연락처</div><div>최근 예약</div><div>업무 바로가기</div><div className="text-right">새 예약</div></div>
      {patientGroups.map((group) => {
        if (patientEditId === group.patientKey && patientEditForm) return <div key={group.patientKey} className="border-b border-[#edf2ef] p-3 last:border-b-0"><div className="grid grid-cols-4 gap-2"><input className="h-9 rounded-[16px] border border-[#dfe3e8] px-3 text-sm font-semibold focus:border-[#0f9b8e] focus:outline-none" value={patientEditForm.name} placeholder="이름" onChange={(event) => onPatientFormChange((prev) => prev && ({ ...prev, name: event.target.value }))} /><input className="h-9 rounded-[16px] border border-[#dfe3e8] px-3 text-sm focus:border-[#0f9b8e] focus:outline-none" value={patientEditForm.birthInput} placeholder="생년월일" onChange={(event) => onPatientFormChange((prev) => prev && ({ ...prev, birthInput: event.target.value }))} /><input className="h-9 rounded-[16px] border border-[#dfe3e8] px-3 text-sm focus:border-[#0f9b8e] focus:outline-none" value={patientEditForm.phone} placeholder="연락처" onChange={(event) => onPatientFormChange((prev) => prev && ({ ...prev, phone: event.target.value }))} /><input className="h-9 rounded-[16px] border border-[#dfe3e8] px-3 text-sm focus:border-[#0f9b8e] focus:outline-none" value={patientEditForm.nationality} placeholder="국적" onChange={(event) => onPatientFormChange((prev) => prev && ({ ...prev, nationality: event.target.value }))} /></div><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={onCancelPatientEdit} className="h-8 rounded-[16px] bg-[#f6f7f5] px-3 text-xs font-semibold text-[#667085]">취소</button><button type="button" onClick={() => onSavePatientEdit(group)} disabled={patientEditSaving} className="h-8 rounded-[16px] bg-[#0f9b8e] px-3 text-xs font-semibold text-white disabled:opacity-50">{patientEditSaving ? "저장 중" : "저장"}</button></div></div>;
        const birthInfo = getReservationBirthInfo({ birth: group.birth, birthInput: group.birthInput, gender: group.gender } as Parameters<typeof getReservationBirthInfo>[0]);
        const pid = group.patientId || group.patientKey;
        const reservationCount = group.reservationCount ?? group.reservations.length;
        const settlementCount = group.settlementCount ?? 0;
        const invoiceCount = group.invoiceCount ?? 0;
        const memoCount = group.memoCount ?? 0;
        const demographic = [birthInfo.birthDisplay ? `${birthInfo.birthDisplay}${birthInfo.ageText ? ` (${birthInfo.ageText})` : ""}` : "", group.gender, group.nationality].filter(Boolean).join(" · ");
        return <article key={group.patientKey} className="grid min-h-[76px] grid-cols-[minmax(250px,1.35fr)_minmax(150px,.8fr)_minmax(190px,1fr)_minmax(330px,1.65fr)_88px] items-center gap-4 border-b border-[#edf2ef] px-4 py-2.5 transition last:border-b-0 hover:bg-[#f3fbf8]"><div className="min-w-0"><h3 className="truncate text-[14px] font-bold tracking-[-0.04em] text-[#101828]">{group.name || "이름 없음"}</h3><div className="mt-1 truncate text-[11px] text-[#667085]">{demographic || "기본 정보 없음"}</div></div><div className="min-w-0 truncate text-[12px] text-[#475467]">{group.phone || "연락처 없음"}</div><div className="min-w-0"><div className="truncate text-[12px] font-semibold text-[#344054]">{recentReservationText(group)}</div><div className="mt-1 text-[10px] text-[#98a2b3]">최근 예약</div></div><div className="flex min-w-0 flex-wrap items-center gap-1.5"><button type="button" onClick={() => onOpenPatientMemo(group)} className="h-7 rounded-[13px] bg-[#f6f7f5] px-2.5 text-[10px] font-semibold text-[#667085]">메모{memoCount > 0 ? ` ${memoCount}` : ""}</button><button type="button" onFocus={() => prefetchInvoiceModal(pid)} onMouseEnter={() => prefetchInvoiceModal(pid)} onClick={() => setInvoiceModal({ patientId: pid, patientName: group.name })} className="h-7 rounded-[13px] bg-[#e3f2ee] px-2.5 text-[10px] font-semibold text-[#0f9b8e]">인보이스{invoiceCount > 0 ? ` ${invoiceCount}` : ""}</button><button type="button" onFocus={() => prefetchSettlementModal(pid)} onMouseEnter={() => prefetchSettlementModal(pid)} onClick={() => setSettlementModal({ patientId: pid, patientName: group.name })} className="h-7 rounded-[13px] bg-[#eef4ff] px-2.5 text-[10px] font-semibold text-[#2563eb]">정산{settlementCount > 0 ? ` ${settlementCount}` : ""}</button>{onOpenPatientHistory ? <button type="button" onClick={() => onOpenPatientHistory(group.patientId, group.name)} className="h-7 rounded-[13px] bg-[#f6f7f5] px-2.5 text-[10px] font-semibold text-[#667085]">예약{reservationCount > 0 ? ` ${reservationCount}${group.reservationCountCapped ? "+" : ""}` : ""}</button> : null}<button type="button" onClick={() => setDetailGroup(group)} className="h-7 rounded-[13px] bg-white px-2.5 text-[10px] font-semibold text-[#344054] shadow-[inset_0_0_0_1px_#dfe3e8]">더 보기</button></div><button type="button" onClick={() => onAddReservation(group)} className="h-8 justify-self-end rounded-[14px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-3 text-[10px] font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)]">+ 예약</button></article>;
      })}
    </section>
  </>;
}
