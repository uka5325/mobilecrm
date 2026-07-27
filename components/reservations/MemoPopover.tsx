"use client";

import { useState } from "react";
import type { ReservationNote, MutationResult } from "@/features/reservations/data/client/reservationNotes";
import type { ReservationRecord } from "@/features/reservations/domain/reservationModels";
import { toDate } from "@/lib/dateUtils";

export type MemoPopoverState = {
  item: ReservationRecord;
  notes: ReservationNote[];
  loading: boolean;
  error?: string;
} | null;

type Props = {
  memoPopover: MemoPopoverState;
  editingNoteId: string | null;
  editingNoteText: string;
  onClose: () => void;
  onEditStart: (noteId: string, text: string) => void;
  onEditCancel: () => void;
  onEditTextChange: (text: string) => void;
  onUpdate: (note: ReservationNote) => Promise<MutationResult>;
  onDelete: (note: ReservationNote) => Promise<MutationResult>;
  onAdd: (text: string) => Promise<MutationResult>;
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
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState("");
  const [page, setPage] = useState(1);

  if (!memoPopover) return null;

  const totalNotes = memoPopover.notes.length;
  const totalPages = Math.ceil(totalNotes / PAGE_SIZE);
  const pagedNotes = memoPopover.notes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function handleAdd() {
    if (!newText.trim()) return;
    setAdding(true);
    setMutationError("");
    try {
      const result = await onAdd(newText.trim());
      // 실패 시 입력을 지우지 않아 작성 내용을 보존한다.
      if (!result.success) { setMutationError(result.message); return; }
      setNewText("");
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "메모 저장에 실패했습니다.");
    } finally {
      setAdding(false);
    }
  }

  async function handleUpdate(note: ReservationNote) {
    setMutatingId(note.id);
    setMutationError("");
    try {
      const result = await onUpdate(note);
      if (!result.success) { setMutationError(result.message); return; }
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "메모 수정에 실패했습니다.");
    } finally {
      setMutatingId(null);
    }
  }

  async function handleDelete(note: ReservationNote) {
    setMutatingId(note.id);
    setMutationError("");
    try {
      const result = await onDelete(note);
      if (!result.success) { setMutationError(result.message); return; }
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "메모 삭제에 실패했습니다.");
    } finally {
      setMutatingId(null);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[9994] bg-black/35 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[9995] flex max-h-[calc(100dvh-64px)] w-[460px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[30px] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.26)]">
        <div className="flex shrink-0 items-center justify-between bg-white px-5 pb-3 pt-5">
          <div>
            <div className="font-bold text-[#101828]">{memoPopover.item.name} 메모</div>
            <div className="text-xs text-gray-400">전체 {totalNotes}건</div>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f6f7f5] text-[#667085] transition active:scale-95">✕</button>
        </div>

        <div className="shrink-0 bg-[#f8fbfa] px-5 py-3">
          <textarea
            rows={2}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="새 메모 입력..."
            className="w-full resize-none rounded-[16px] border border-[#dbe7e3] bg-white px-3 py-2 text-base focus:border-[#5bd5c8] focus:outline-none focus:ring-2 focus:ring-[#dff7f3] sm:text-sm"
          />
          {mutationError && (
            <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{mutationError}</div>
          )}
          <button
            onClick={handleAdd}
            disabled={adding || mutatingId !== null}
            className="mt-2 w-full rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,143,131,0.12)] transition active:scale-95 disabled:opacity-50"
          >
            {adding ? "추가 중..." : "메모 추가"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white p-5">
          {memoPopover.error && (
            <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{memoPopover.error}</div>
          )}
          {memoPopover.loading ? (
            <div className="rounded-[22px] bg-[#f8fbfa] px-4 py-8 text-center text-sm text-[#8b93a1] shadow-[0_8px_18px_rgba(15,23,42,0.035)]">메모 로딩 중...</div>
          ) : memoPopover.notes.length === 0 ? (
            // refetch 실패로 목록이 보존됐을 땐 위 에러 배너만, 초기 로드 실패면 배너만(빈목록 문구 숨김)
            memoPopover.error ? null : (
              <div className="rounded-[22px] bg-[#f8fbfa] px-4 py-8 text-center text-sm text-[#8b93a1] shadow-[0_8px_18px_rgba(15,23,42,0.035)]">등록된 메모가 없습니다.</div>
            )
          ) : (
            <div className="space-y-3">
              {pagedNotes.map((note) => (
                <div key={note.id} className="rounded-[22px] bg-[#f8fbfa] p-3.5 shadow-[0_8px_18px_rgba(15,23,42,0.04)]">
                  <div className="mb-1.5 flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded-full bg-[#e3f2ee] px-2.5 py-1 text-[10px] font-semibold text-[#0f9b8e]">
                      {note.createdBy || "알 수 없음"}
                    </span>
                    {editingNoteId === note.id ? (
                      <textarea
                        className="flex-1 resize-none rounded-[16px] border border-[#dbe7e3] bg-white px-3 py-2 text-sm transition focus:border-[#5bd5c8] focus:outline-none focus:ring-2 focus:ring-[#dff7f3]"
                        rows={2}
                        value={editingNoteText}
                        onChange={(e) => onEditTextChange(e.target.value)}
                      />
                    ) : (
                      <span className="flex-1 whitespace-pre-wrap text-sm leading-relaxed text-[#344054]">{note.memoText}</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      {editingNoteId === note.id ? (
                        <>
                          <button
                            disabled={mutatingId === note.id}
                            onClick={() => handleUpdate(note)}
                            className="text-xs font-semibold text-[#0f9b8e] hover:underline disabled:opacity-50"
                          >저장</button>
                          <button onClick={onEditCancel} className="text-xs text-gray-400 hover:underline">취소</button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => onEditStart(note.id, note.memoText)}
                            className="text-xs font-semibold text-[#0f9b8e] hover:underline"
                          >수정</button>
                          <button
                            disabled={mutatingId === note.id}
                            onClick={() => handleDelete(note)}
                            className="text-xs text-red-400 hover:underline disabled:opacity-50"
                          >삭제</button>
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
                className="rounded-full bg-[#e3f2ee] px-3 py-1 text-xs text-[#667085] disabled:opacity-40"
              >이전</button>
              <span className="text-xs text-gray-500">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-full bg-[#e3f2ee] px-3 py-1 text-xs text-[#667085] disabled:opacity-40"
              >다음</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
