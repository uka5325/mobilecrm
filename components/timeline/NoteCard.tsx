"use client";

import { useState } from "react";
import type { ReservationNote, MutationResult } from "@/features/reservations/data/client/reservationNotes";
import { formatLogDate } from "@/features/reservations/ui/timelineUtils";

type Props = {
  note: ReservationNote;
  compact?: boolean;
  onUpdate: (note: ReservationNote, newText: string) => Promise<MutationResult>;
  onDelete: (note: ReservationNote) => Promise<MutationResult>;
};

export function NoteCard({ note, compact = false, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(note.memoText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const result = await onUpdate(note, editText);
      if (!result.success) { setError(result.message); return; }
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "메모 수정에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    setError("");
    try {
      const result = await onDelete(note);
      if (!result.success) { setError(result.message); return; }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "메모 삭제에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function handleStartEdit() {
    setEditText(note.memoText);
    setError("");
    setEditing(true);
  }

  return (
    <div
      className={
        compact
          ? "rounded-[22px] bg-[#f8fbfa] px-4 py-3 text-sm shadow-[0_8px_18px_rgba(15,23,42,0.04)]"
          : "rounded-[22px] bg-[#f8fbfa] p-4 text-sm shadow-[0_8px_18px_rgba(15,23,42,0.04)]"
      }
    >
      {editing ? (
        <>
          <textarea
            rows={compact ? 2 : 3}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full resize-none rounded-[16px] border border-[#dbe7e3] bg-white px-3 py-2 text-base transition focus:border-[#5bd5c8] focus:outline-none focus:ring-2 focus:ring-[#dff7f3] sm:text-sm"
          />
          <div className="mt-2 flex justify-end gap-3 text-xs">
            <button disabled={saving} onClick={() => setEditing(false)} className="text-gray-500 hover:underline disabled:opacity-50">
              취소
            </button>
            <button disabled={saving} onClick={handleSave} className="font-semibold text-[#0f9b8e] hover:underline disabled:opacity-50">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate font-semibold text-[#0f9b8e]">
              {note.createdBy || "작성자"}
            </span>
            <span className="shrink-0 text-xs text-gray-400">{formatLogDate(note.createdAt)}</span>
          </div>
          <div className="whitespace-pre-line leading-6 text-gray-700">{note.memoText}</div>
          <div className="mt-2 flex justify-end gap-3 text-xs">
            <button disabled={saving} onClick={handleStartEdit} className="text-[#0f9b8e] hover:underline disabled:opacity-50">
              수정
            </button>
            <button disabled={saving} onClick={handleDelete} className="text-red-500 hover:underline disabled:opacity-50">
              삭제
            </button>
          </div>
        </>
      )}
      {error && <div className="mt-2 text-xs text-red-500">{error}</div>}
    </div>
  );
}
