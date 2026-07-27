"use client";

import { useState } from "react";
import { type ReservationNote, type MutationResult } from "@/features/reservations/data/client/reservationNotes";
import { NoteCard } from "@/components/timeline/NoteCard";

const PAGE_SIZE = 10;

type Props = {
  memoText: string;
  notes: ReservationNote[];
  notesLoading?: boolean;
  notesError?: string;
  memoError?: string;
  memoSuccess?: string;
  onMemoTextChange: (text: string) => void;
  onAddMemo: () => void;
  onUpdateNote: (note: ReservationNote, text: string) => Promise<MutationResult>;
  onDeleteNote: (note: ReservationNote) => Promise<MutationResult>;
};

export function NotesTab({ memoText, notes, notesLoading, notesError, memoError, memoSuccess, onMemoTextChange, onAddMemo, onUpdateNote, onDeleteNote }: Props) {
  const [page, setPage] = useState(1);
  // 렌더 중 상태 조정(React 공식 패턴) — notes.length가 바뀌면(새 메모 추가/삭제)
  // effect 없이 이번 렌더에서 바로 1페이지로 되돌린다.
  const [prevNotesLength, setPrevNotesLength] = useState(notes.length);
  if (notes.length !== prevNotesLength) {
    setPrevNotesLength(notes.length);
    setPage(1);
  }

  const totalPages = Math.ceil(notes.length / PAGE_SIZE);
  const pagedNotes = notes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="rounded-[22px] bg-[#f8fbfa] p-3 shadow-[0_8px_18px_rgba(15,23,42,0.04)]">
      <textarea
        rows={3}
        value={memoText}
        onChange={(e) => onMemoTextChange(e.target.value)}
        className="w-full resize-none rounded-[18px] border border-[#dbe7e3] bg-white px-3 py-2 text-base transition focus:border-[#5bd5c8] focus:outline-none focus:ring-2 focus:ring-[#dff7f3] sm:text-sm"
        placeholder="메모를 입력하세요..."
      />
      <button
        onClick={onAddMemo}
        className="mt-2 w-full rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,143,131,0.12)] transition active:scale-95"
      >
        메모 추가
      </button>
      {memoError && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{memoError}</div>
      )}
      {memoSuccess && (
        <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-[#0f9b8e]">{memoSuccess}</div>
      )}
      </div>

      <div className="space-y-3">
        {notesLoading ? (
          <div className="rounded-[22px] bg-[#f6f7f5] p-4 text-sm text-[#8b93a1]">
            메모를 불러오는 중...
          </div>
        ) : notesError ? (
          <div className="rounded-[20px] bg-red-50 p-4 text-sm text-red-600">
            {notesError}
          </div>
        ) : notes.length === 0 ? (
          <div className="rounded-[22px] bg-[#f6f7f5] p-4 text-sm text-[#8b93a1]">
            등록된 메모가 없습니다.
          </div>
        ) : (
          <>
            {pagedNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onUpdate={onUpdateNote}
                onDelete={onDeleteNote}
              />
            ))}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-full bg-[#eaf8f3] px-3 py-1 text-xs text-[#667085] disabled:opacity-40"
                >
                  이전
                </button>
                <span className="text-xs text-gray-500">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded-full bg-[#eaf8f3] px-3 py-1 text-xs text-[#667085] disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
