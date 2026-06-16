"use client";

import type { MouseEvent } from "react";
import type { ReservationRecord, ReservationStatus } from "@/lib/reservations";
import type { VisitStatusColorMap } from "@/lib/settings";
import { getReservationBirthInfo } from "@/lib/reservationUtils";
import { formatDateGroup, normalizeTimeText } from "@/lib/timelineUtils";
import { getStatusSelectStyle } from "@/lib/colorUtils";

const STATUS_LIST: ReservationStatus[] = [
  "내원전", "대기", "원상중", "후상중", "귀가", "부도",
];

type InlineForm = {
  name: string; birthInput: string; phone: string; nationality: string;
  consultArea: string; reservationDate: string; reservationTime: string;
  coordinators: string; depositAmount: string; doctors: string[];
} | null;

type Props = {
  items: ReservationRecord[];
  loading: boolean;
  filterDate: string;
  statusColors: VisitStatusColorMap;
  inlineEditId: string | null;
  inlineForm: InlineForm;
  inlineSaving: boolean;
  onFormChange: (updater: (prev: InlineForm) => InlineForm) => void;
  onStatusChange: (item: ReservationRecord, status: ReservationStatus) => void;
  onSurgeryToggle: (item: ReservationRecord) => void;
  onOpenMemo: (item: ReservationRecord) => void;
  onInvoiceButtonClick: (e: MouseEvent<HTMLButtonElement>, item: ReservationRecord) => void;
  onStartEdit: (item: ReservationRecord) => void;
  onSaveEdit: (item: ReservationRecord) => void;
  onCancelEdit: () => void;
  onDelete: (item: ReservationRecord) => void;
};

export function ReservationsTable({
  items,
  loading,
  filterDate,
  statusColors,
  inlineEditId,
  inlineForm,
  inlineSaving,
  onFormChange,
  onStatusChange,
  onSurgeryToggle,
  onOpenMemo,
  onInvoiceButtonClick,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: Props) {
  const cellCls = "border-b border-gray-100 px-2 py-2";
  const inputCls = "w-full rounded-lg border border-[#dfe3e8] px-2 py-1 text-xs focus:border-[#1d9e75] focus:outline-none";

  function renderBody() {
    if (loading) {
      return (
        <tr>
          <td colSpan={12} className="py-12 text-center text-gray-400">데이터 로딩 중...</td>
        </tr>
      );
    }
    if (items.length === 0) {
      return (
        <tr>
          <td colSpan={12} className="py-12 text-center text-gray-400">예약이 없습니다.</td>
        </tr>
      );
    }

    const rows: React.ReactNode[] = [];
    let lastDate = "";
    let lastTime = "";

    items.forEach((item) => {
      const date = item.reservationDate || "날짜 미정";
      const time = normalizeTimeText(item.reservationTime || "");
      const birthInfo = getReservationBirthInfo(item);
      const currentStatus = item.operationStatus || "내원전";

      if (!filterDate && date !== lastDate) {
        rows.push(
          <tr key={`date-${date}`} className="bg-gray-100">
            <td colSpan={12} className="border-y border-gray-200 px-6 py-3 text-sm font-bold text-gray-900">
              📅 {formatDateGroup(date)}
            </td>
          </tr>
        );
        lastDate = date;
        lastTime = "";
      }

      if (!filterDate && time !== lastTime) {
        rows.push(
          <tr key={`time-${date}-${time}`} className="bg-gray-50">
            <td colSpan={12} className="border-b border-gray-100 px-6 py-2 text-sm font-bold text-emerald-700">
              ⏰ {time}
            </td>
          </tr>
        );
        lastTime = time;
      }

      const isEditing = inlineEditId === item.id;
      const f = inlineForm;

      rows.push(
        <tr key={item.id} className={isEditing ? "bg-emerald-50" : "hover:bg-gray-50"}>
          {/* 이름 */}
          <td className={`${cellCls} px-4`}>
            {isEditing ? (
              <input className={inputCls} value={f!.name} onChange={(e) => onFormChange((p) => p && ({ ...p, name: e.target.value }))} />
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => onInvoiceButtonClick(e, item)}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold shadow-sm transition hover:shadow active:scale-95 ${item.invoiceId ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-gray-200 bg-gray-50 text-gray-400"}`}
                  title={item.invoiceId ? "인보이스 메뉴" : "인보이스 생성"}
                >
                  {item.invoiceId ? "🧾" : "+"}
                </button>
                <span className="truncate font-semibold text-gray-900">{item.name}</span>
              </div>
            )}
          </td>

          {/* 생년월일 */}
          <td className={cellCls}>
            {isEditing ? (
              <input className={inputCls} value={f!.birthInput} onChange={(e) => onFormChange((p) => p && ({ ...p, birthInput: e.target.value }))} placeholder="891210-1" />
            ) : (
              <span className="text-gray-500">{birthInfo.birthDisplay}</span>
            )}
          </td>

          {/* 국적 */}
          <td className={cellCls}>
            {isEditing ? (
              <input className={inputCls} value={f!.nationality} onChange={(e) => onFormChange((p) => p && ({ ...p, nationality: e.target.value }))} />
            ) : (
              <span className="text-gray-500">{item.nationality}</span>
            )}
          </td>

          {/* 상담부위 */}
          <td className={cellCls}>
            {isEditing ? (
              <input className={inputCls} value={f!.consultArea} onChange={(e) => onFormChange((p) => p && ({ ...p, consultArea: e.target.value }))} />
            ) : item.consultArea}
          </td>

          {/* 원장 */}
          <td className={cellCls}>
            {isEditing ? (
              <input
                className={inputCls}
                value={f!.doctors.join(", ")}
                onChange={(e) => onFormChange((p) => p && ({ ...p, doctors: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))}
                placeholder="쉼표 구분"
              />
            ) : item.doctors.join(", ")}
          </td>

          {/* 실장 */}
          <td className={cellCls}>
            {isEditing ? (
              <input className={inputCls} value={f!.coordinators} onChange={(e) => onFormChange((p) => p && ({ ...p, coordinators: e.target.value }))} placeholder="쉼표 구분" />
            ) : (
              <span className="text-gray-500">{item.coordinators.join(", ")}</span>
            )}
          </td>

          {/* 상태 */}
          <td className={cellCls}>
            <select
              value={currentStatus}
              onChange={(e) => onStatusChange(item, e.target.value as ReservationStatus)}
              className="rounded-full border px-2 py-1 text-xs font-semibold outline-none transition"
              style={getStatusSelectStyle(currentStatus, statusColors)}
            >
              {STATUS_LIST.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
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

          {/* 메모 */}
          <td className={`${cellCls} text-xs text-gray-500`}>
            <button onClick={() => onOpenMemo(item)} className="text-emerald-700 hover:underline">전체보기</button>
          </td>

          {/* 연락처 */}
          <td className={cellCls}>
            {isEditing ? (
              <input className={inputCls} value={f!.phone} onChange={(e) => onFormChange((p) => p && ({ ...p, phone: e.target.value }))} />
            ) : (
              <span className="text-gray-500">{item.phone}</span>
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
              <>
                <button onClick={() => onStartEdit(item)} className="px-2 py-1 text-xs text-blue-600 hover:underline">수정</button>
                <button onClick={() => onDelete(item)} className="px-2 py-1 text-xs text-red-500 hover:underline">삭제</button>
              </>
            )}
          </td>
        </tr>
      );
    });

    return rows;
  }

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8">
      <div className="overflow-x-auto border-y border-gray-100 bg-white">
        <table className="min-w-[1380px] w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[200px]" />
            <col className="w-[110px]" />
            <col className="w-[80px]" />
            <col className="w-[130px]" />
            <col className="w-[120px]" />
            <col className="w-[90px]" />
            <col className="w-[100px]" />
            <col className="w-[90px]" />
            <col className="w-[100px]" />
            <col className="w-[80px]" />
            <col className="w-[120px]" />
            <col className="w-[110px]" />
          </colgroup>

          <thead className="bg-gray-50">
            <tr>
              {["이름", "생년월일", "국적", "상담부위", "원장", "실장", "상태", "수술예약", "예약금", "메모", "연락처", "관리"].map((head) => (
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
