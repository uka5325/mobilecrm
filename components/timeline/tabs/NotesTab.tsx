"use client";

import { useState } from "react";
import { type ReservationNote } from "@/lib/reservationNotes";
import { NoteCard } from "@/components/timeline/NoteCard";

const PAGE_SIZE = 10;

type Props = {
  memoText: string;
  notes: ReservationNote[];
  notesLoading?: boolean;
  memoError?: string;
  memoSuccess?: string;
  onMemoTextChange: (text: string) => void;
  onAddMemo: () => void;
  onUpdateNote: (note: ReservationNote, text: string) => Promise<void>;
  onDeleteNote: (note: ReservationNote) => Promise<void>;
};

export function NotesTab({ memoText, notes, notesLoading, memoError, memoSuccess, onMemoTextChange, onAddMemo, onUpdateNote, onDeleteNote }: Props) {
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
    <div>
      <textarea
        rows={3}
        value={memoText}
        onChange={(e) => onMemoTextChange(e.target.value)}
        className="w-full resize-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-emerald-500 focus:outline-none"
        placeholder="메모를 입력하세요..."
      />
      <button
        onClick={onAddMemo}
        className="mt-2 w-full rounded-xl bg-emerald-600 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
      >
        메모 추가
      </button>
      {memoError && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{memoError}</div>
      )}
      {memoSuccess && (
        <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{memoSuccess}</div>
      )}

      <div className="mt-4 space-y-3">
        {notesLoading ? (
          <div className="rounded-xl border border-[#edf0f3] bg-white p-4 text-sm text-gray-400">
            메모를 불러오는 중...
          </div>
        ) : notes.length === 0 ? (
          <div className="rounded-xl border border-[#edf0f3] bg-white p-4 text-sm text-gray-400">
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
          </>
        )}
      </div>
    </div>
  );
}
