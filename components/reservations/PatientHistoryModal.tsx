"use client";

import type { ReservationRecord } from "@/lib/reservations";
import { getCardStatus } from "@/lib/timelineUtils";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="mx-4 w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-base font-bold text-gray-800">{patientName} — 전체 예약 이력</span>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
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
            <div className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-100">
              {list.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
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
                      className="rounded border border-blue-200 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
                    >수정</button>
                    <button
                      onClick={() => onDelete(r)}
                      className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
                    >삭제</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-center gap-3 text-sm">
              <button
                onClick={onPrevPage}
                disabled={page <= 1 || loading}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-500 disabled:opacity-40"
              >
                ← 이전
              </button>
              <span className="text-xs text-gray-500">{page}</span>
              <button
                onClick={onNextPage}
                disabled={!hasNext || loading}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 disabled:opacity-40"
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
