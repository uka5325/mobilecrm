"use client";

import { useState } from "react";
import type { ConferenceMemo } from "@/features/settings/data/client/settings";
import { formatDateTime } from "@/features/settings/data/client/settingsUtils";
import { SectionHeader, EmptyBox } from "@/components/settings/ui";

type Props = {
  memoDate: string;
  memoText: string;
  memos: ConferenceMemo[];
  memoLoading: boolean;
  canEdit: boolean;
  saving: boolean;
  onDateChange: (date: string) => void;
  onTextChange: (text: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, text: string) => Promise<void>;
};

export function MemoPanel({ memoDate, memoText, memos, memoLoading, canEdit, saving, onDateChange, onTextChange, onAdd, onDelete, onUpdate }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  function startEdit(memo: ConferenceMemo) {
    setEditingId(memo.id);
    setEditText(memo.memoText);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText("");
  }

  async function submitEdit(id: string) {
    if (!editText.trim()) return;
    setEditSaving(true);
    try {
      await onUpdate(id, editText);
      setEditingId(null);
      setEditText("");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-[28px] bg-white p-5 shadow-[0_16px_50px_rgba(15,23,42,0.055)] lg:p-6">
        <SectionHeader
          title="오늘의 메모"
          description="선택한 날짜의 홈/타임라인에 표시할 운영 메모를 관리합니다."
          badge={canEdit ? "수정 가능" : "보기 전용"}
          badgeActive={canEdit}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <div>
            <label className="mb-1 block text-xs text-gray-500">메모 표시 날짜</label>
            <input
              type="date"
              value={memoDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="h-11 w-full rounded-[16px] border border-[#dbe7e3] bg-white px-3 text-sm outline-none transition focus:border-[#5bd5c8] focus:ring-2 focus:ring-[#dff7f3]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">메모 내용</label>
            <textarea
              rows={3}
              value={memoText}
              disabled={!canEdit || saving}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder="전체 공유 메모를 입력하세요."
              className="w-full resize-none rounded-[16px] border border-[#dbe7e3] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#5bd5c8] focus:ring-2 focus:ring-[#dff7f3] disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onAdd}
            disabled={!canEdit || saving}
            className="rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-5 py-3 text-sm font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition hover:-translate-y-0.5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "저장 중..." : "메모 추가"}
          </button>
        </div>
      </div>

      <div className="rounded-[28px] bg-white p-5 shadow-[0_16px_50px_rgba(15,23,42,0.055)] lg:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">선택 날짜 메모</h3>
          <span className="text-xs text-gray-400">{memos.length}개</span>
        </div>

        {memoLoading ? (
          <EmptyBox text="메모를 불러오는 중..." />
        ) : memos.length === 0 ? (
          <EmptyBox text="등록된 메모가 없습니다." />
        ) : (
          <div className="space-y-2">
            {memos.map((memo) => {
              const memoTime = formatDateTime(memo.createdAt);
              const isEditing = editingId === memo.id;

              return (
                <div key={memo.id} className="rounded-[22px] bg-[#f8fbfa] p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="text-xs text-gray-400">
                      {memo.createdByName || "시스템"}
                      {memoTime ? ` · ${memoTime}` : ""}
                    </div>

                    {canEdit && !isEditing && (
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => startEdit(memo)}
                          disabled={saving || editSaving}
                          className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 transition hover:bg-blue-100 active:scale-95 disabled:opacity-50"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => onDelete(memo.id)}
                          disabled={saving || editSaving}
                          className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-100 active:scale-95 disabled:opacity-50"
                        >
                          삭제
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        rows={3}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        disabled={editSaving}
                        className="w-full resize-none rounded-[16px] border border-[#dbe7e3] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#5bd5c8] focus:ring-2 focus:ring-[#dff7f3] disabled:opacity-50"
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={cancelEdit}
                          disabled={editSaving}
                          className="rounded-[14px] border border-[#dbe7e3] px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-gray-100 active:scale-95 disabled:opacity-50"
                        >
                          취소
                        </button>
                        <button
                          onClick={() => submitEdit(memo.id)}
                          disabled={editSaving || !editText.trim()}
                          className="rounded-lg bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-3 py-1.5 text-xs font-medium text-white transition hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {editSaving ? "저장 중..." : "저장"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="whitespace-pre-line text-sm leading-6 text-gray-800">{memo.memoText}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
