"use client";

import type { ReservationNote } from "@/lib/reservationNotes";
import type { ReservationRecord } from "@/lib/reservations";
import { toDate } from "@/lib/settingsUtils";

export type MemoPopoverState = {
  item: ReservationRecord;
  notes: ReservationNote[];
  loading: boolean;
} | null;

import { useState } from "react";

type Props = {
  memoPopover: MemoPopoverState;
  editingNoteId: string | null;
  editingNoteText: string;
  onClose: () => void;
  onEditStart: (noteId: string, text: string) => void;
  onEditCancel: () => void;
  onEditTextChange: (text: string) => void;
  onUpdate: (note: ReservationNote) => void;
  onDelete: (note: ReservationNote) => void;
  onAdd: (text: string) => Promise<void>;
};

const PAGE_SIZE = 10;

export function MemoPopover({
  memoPopover,
  editingNoteId,
  editingNoteText,
  onClose,
  onEditStart,
  onEditCancel,
  onEditTextChange,
  onUpdate,
  onDelete,
  onAdd,
}: Props) {
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);

  if (!memoPopover) return null;

  const totalNotes = memoPopover.notes.length;
  const totalPages = Math.ceil(totalNotes / PAGE_SIZE);
  const pagedNotes = memoPopover.notes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function handleAdd() {
    if (!newText.trim()) return;
    setAdding(true);
    try {
      await onAdd(newText.trim());
      setNewText("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[9994]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[9995] w-[460px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#edf0f3] bg-white shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-[#edf0f3] px-5 py-4 shrink-0">
          <div>
            <div className="font-bold text-gray-800">{memoPopover.item.name} 메모</div>
            <div className="text-xs text-gray-400">
              전체 {totalNotes}건
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="border-b border-[#edf0f3] px-5 py-3 shrink-0">
          <textarea
            rows={2}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="새 메모 입력..."
            className="w-full resize-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={handleAdd}
            disabled={adding}
            className="mt-2 w-full rounded-xl bg-emerald-600 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 disabled:opacity-50"
          >
            {adding ? "추가 중..." : "메모 추가"}
          </button>
        </div>

        <div className="overflow-y-auto p-5 flex-1">
          {memoPopover.loading ? (
            <div className="py-8 text-center text-sm text-gray-400">메모 로딩 중...</div>
          ) : memoPopover.notes.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">등록된 메모가 없습니다.</div>
          ) : (
            <div className="space-y-3">
              {pagedNotes.map((note) => (
                <div key={note.id} className="rounded-xl border border-[#edf0f3] bg-[#f8fafc] p-3">
                  <div className="mb-1.5 flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded-lg bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      {note.createdBy || "알 수 없음"}
                    </span>
                    {editingNoteId === note.id ? (
                      <textarea
                        className="flex-1 rounded-lg border border-[#dfe3e8] px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                        rows={2}
                        value={editingNoteText}
                        onChange={(e) => onEditTextChange(e.target.value)}
                      />
                    ) : (
                      <span className="flex-1 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">{note.memoText}</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      {editingNoteId === note.id ? (
                        <>
                          <button onClick={() => onUpdate(note)} className="text-xs text-emerald-600 hover:underline">저장</button>
                          <button onClick={onEditCancel} className="text-xs text-gray-400 hover:underline">취소</button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => onEditStart(note.id, note.memoText)}
                            className="text-xs text-blue-500 hover:underline"
                          >수정</button>
                          <button onClick={() => onDelete(note)} className="text-xs text-red-400 hover:underline">삭제</button>
                        </>
                      )}
                    </div>

                    <div className="text-xs text-gray-400">
                      {(() => {
                        const d = toDate(note.createdAt);
                        if (!d) return "";
                        return (
                          d.getFullYear() + "." +
                          String(d.getMonth() + 1).padStart(2, "0") + "." +
                          String(d.getDate()).padStart(2, "0") + " " +
                          String(d.getHours()).padStart(2, "0") + ":" +
                          String(d.getMinutes()).padStart(2, "0")
                        );
                      })()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-[#dfe3e8] px-3 py-1 text-xs text-gray-600 disabled:opacity-40"
              >
                이전
              </button>
              <span className="text-xs text-gray-500">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-[#dfe3e8] px-3 py-1 text-xs text-gray-600 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
