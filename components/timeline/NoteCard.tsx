"use client";

import { useState } from "react";
import type { ReservationNote } from "@/lib/reservationNotes";
import { formatLogDate } from "@/lib/timelineUtils";

type Props = {
  note: ReservationNote;
  compact?: boolean;
  onUpdate: (note: ReservationNote, newText: string) => Promise<void>;
  onDelete: (note: ReservationNote) => Promise<void>;
};

export function NoteCard({ note, compact = false, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(note.memoText);

  async function handleSave() {
    await onUpdate(note, editText);
    setEditing(false);
  }

  function handleStartEdit() {
    setEditText(note.memoText);
    setEditing(true);
  }

  return (
    <div
      className={
        compact
          ? "rounded-xl bg-gray-50 px-4 py-3 text-sm"
          : "rounded-xl border border-[#edf0f3] bg-white p-4 text-sm"
      }
    >
      {editing ? (
        <>
          <textarea
            rows={compact ? 2 : 3}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full resize-none rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-emerald-500 focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-3 text-xs">
            <button onClick={() => setEditing(false)} className="text-gray-500 hover:underline">
              취소
            </button>
            <button onClick={handleSave} className="font-semibold text-blue-600 hover:underline">
              저장
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate font-semibold text-emerald-700">
              {note.createdBy || "작성자"}
            </span>
            <span className="shrink-0 text-xs text-gray-400">{formatLogDate(note.createdAt)}</span>
          </div>
          <div className="whitespace-pre-line leading-6 text-gray-700">{note.memoText}</div>
          <div className="mt-2 flex justify-end gap-3 text-xs">
            <button onClick={handleStartEdit} className="text-blue-500 hover:underline">
              수정
            </button>
            <button onClick={() => onDelete(note)} className="text-red-500 hover:underline">
              삭제
            </button>
          </div>
        </>
      )}
    </div>
  );
}
