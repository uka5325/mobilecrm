"use client";

import { type ReservationNote } from "@/lib/reservationNotes";
import { NoteCard } from "@/components/timeline/NoteCard";

type Props = {
  memoText: string;
  notes: ReservationNote[];
  onMemoTextChange: (text: string) => void;
  onAddMemo: () => void;
  onUpdateNote: (note: ReservationNote, text: string) => Promise<void>;
  onDeleteNote: (note: ReservationNote) => Promise<void>;
};

export function NotesTab({ memoText, notes, onMemoTextChange, onAddMemo, onUpdateNote, onDeleteNote }: Props) {
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

      <div className="mt-4 space-y-3">
        {notes.length === 0 ? (
          <div className="rounded-xl border border-[#edf0f3] bg-white p-4 text-sm text-gray-400">
            등록된 메모가 없습니다.
          </div>
        ) : (
          notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onUpdate={onUpdateNote}
              onDelete={onDeleteNote}
            />
          ))
        )}
      </div>
    </div>
  );
}
