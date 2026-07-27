"use client";

import type { ReservationRecord } from "@/features/reservations/domain/reservationModels";
import { getCardStatus } from "@/features/reservations/ui/timelineUtils";

type Props = {
  patientName: string;
  list: ReservationRecord[];
  capped: boolean;
  loading: boolean;
  error: string;
  page: number;
  hasNext: boolean;
  onClose: () => void;
  onEdit: (r: ReservationRecord) => void;
  onDelete: (r: ReservationRecord) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
};

// 환자 전체 예약 이력 모달 — 페이지네이션 조회 결과를 표시하고 행 단위 편집/삭제를 노출한다.
export function PatientHistoryModal({
  patientName,
  list,
  capped,
  loading,
  error,
  page,
  hasNext,
  onClose,
  onEdit,
  onDelete,
  onPrevPage,
  onNextPage,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-3 py-8 backdrop-blur-[2px]" onClick={onClose}>
      <div className="mx-0 flex max-h-[calc(100dvh-64px)] w-full max-w-xl flex-col overflow-hidden rounded-[30px] bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.26)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-base font-bold text-[#101828]">{patientName} — 예약목록</span>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f6f7f5] text-xl leading-none text-[#667085]">×</button>
        </div>
        {error && <div className="mb-2 text-sm text-red-500">{error}</div>}
        {capped && (
          <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            이력이 300건을 초과하여 최신 300건만 표시됩니다. 더 보시려면 지원팀에 문의해주세요.
          </div>
        )}
        {loading && list.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">로딩 중...</div>
        ) : list.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">예약 이력이 없습니다.</div>
        ) : (
          <>
            <div className="max-h-[60dvh] space-y-2 overflow-y-auto rounded-[22px] bg-[#f8fbfa] p-2">
              {list.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-[18px] bg-white px-3 py-2.5 text-sm shadow-[0_8px_18px_rgba(15,23,42,0.035)]">
                  <span className="w-20 shrink-0 text-xs text-gray-400">{r.reservationDate}</span>
                  {r.reservationTime && <span className="shrink-0 text-xs text-gray-400">{r.reservationTime}</span>}
                  <span className="shrink-0 text-gray-700">{r.appointmentType}</span>
                  {r.consultArea && <span className="shrink-0 text-xs text-gray-500">{r.consultArea}</span>}
                  <span className="shrink-0 text-xs text-gray-400">{r.hospital}</span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {getCardStatus(r)}
                  </span>
                  <div className="ml-auto flex shrink-0 gap-1.5">
                    <button
                      onClick={() => onEdit(r)}
                      className="rounded-full bg-[#e3f2ee] px-2.5 py-1 text-xs font-semibold text-[#0f9b8e]"
                    >수정</button>
                    <button
                      onClick={() => onDelete(r)}
                      className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-500"
                    >삭제</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-center gap-3 text-sm">
              <button
                onClick={onPrevPage}
                disabled={page <= 1 || loading}
                className="rounded-full bg-[#e3f2ee] px-3 py-1 text-xs text-[#667085] disabled:opacity-40"
              >
                ← 이전
              </button>
              <span className="text-xs text-gray-500">{page}</span>
              <button
                onClick={onNextPage}
                disabled={!hasNext || loading}
                className="rounded-full bg-[#e3f2ee] px-3 py-1 text-xs text-[#667085] disabled:opacity-40"
              >
                다음 →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
