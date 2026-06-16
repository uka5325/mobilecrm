"use client";

import type { ConferenceMemo } from "@/lib/settings";
import { formatDateTime } from "@/lib/settingsUtils";
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
};

export function MemoPanel({ memoDate, memoText, memos, memoLoading, canEdit, saving, onDateChange, onTextChange, onAdd, onDelete }: Props) {
  return (
    <section className="space-y-4">
      <div className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
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
              className="h-11 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
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
              className="w-full resize-none rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onAdd}
            disabled={!canEdit || saving}
            className="rounded-xl bg-[#1d9e75] px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "저장 중..." : "메모 추가"}
          </button>
        </div>
      </div>

      <div className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
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
              return (
                <div key={memo.id} className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="text-xs text-gray-400">
                      {memo.createdByName || "시스템"}
                      {memoTime ? ` · ${memoTime}` : ""}
                    </div>

                    {canEdit && (
                      <button
                        onClick={() => onDelete(memo.id)}
                        disabled={saving}
                        className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-100 active:scale-95 disabled:opacity-50"
                      >
                        삭제
                      </button>
                    )}
                  </div>

                  <div className="whitespace-pre-line text-sm leading-6 text-gray-800">{memo.memoText}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
