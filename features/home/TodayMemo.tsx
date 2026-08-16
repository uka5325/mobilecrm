"use client";

import { useState } from "react";

export type HomeMemo = {
  id: string;
  memoText: string;
  createdByName?: string;
  createdAt?: unknown;
};

type TodayMemoProps = {
  memos: HomeMemo[];
  loading: boolean;
  onRefresh: () => void;
  formatTime: (value: unknown) => string;
};

export default function TodayMemo({ memos, loading, onRefresh, formatTime }: TodayMemoProps) {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-[28px] bg-[#e8f5f2] p-5 lg:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black tracking-[0.14em] text-[#0f8f83]">TODAY MEMO</div>
          <h2 className="mt-2 text-xl font-black tracking-[-0.04em] text-[#12151f]">오늘의 메모</h2>
          <p className="mt-2 text-sm leading-6 text-[#61706f]">오늘 공유된 운영 메모를 확인합니다.</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="h-9 rounded-full bg-white px-3 text-xs font-bold text-[#0f8f83] transition active:scale-95"
          >
            새로고침
          </button>
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-black text-[#0f8f83] transition active:scale-95"
          >
            {open ? "⌃" : "⌄"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-5 space-y-3">
          {loading && memos.length === 0 ? (
            <div className="rounded-2xl bg-white/70 p-4 text-sm text-[#61706f]">메모를 불러오는 중...</div>
          ) : memos.length === 0 ? (
            <div className="rounded-2xl bg-white/70 p-4 text-sm text-[#61706f]">등록된 메모가 없습니다.</div>
          ) : (
            memos.map((memo) => {
              const memoTime = formatTime(memo.createdAt);

              return (
                <article key={memo.id} className="rounded-2xl bg-white/78 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold text-[#0f8f83]">
                    <span>{memo.createdByName || "시스템"}</span>
                    {memoTime ? <span className="text-[#7b8a89]">{memoTime}</span> : null}
                  </div>
                  <p className="whitespace-pre-line text-sm leading-6 text-[#243032]">{memo.memoText}</p>
                </article>
              );
            })
          )}
        </div>
      ) : null}
    </section>
  );
}
