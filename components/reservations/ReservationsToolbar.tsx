"use client";

import { useEffect, useState } from "react";
import type { CustomerFilterMode } from "@/hooks/useReservationsList";

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  filterMode: CustomerFilterMode;
  onFilterModeChange: (mode: CustomerFilterMode) => void;
  filterCounts: Record<CustomerFilterMode, number>;
  onAddCustomer: () => void;
  onImport: () => void;
  downloadOpen: boolean;
  onToggleDownload: () => void;
  onCloseDownload: () => void;
  dlStart: string;
  dlEnd: string;
  onDlStartChange: (value: string) => void;
  onDlEndChange: (value: string) => void;
  downloading: boolean;
  onDownload: () => void;
};

const FILTER_LABELS: Record<CustomerFilterMode, string> = {
  all: "전체",
  today: "오늘 예약",
  recent: "최근 예약",
};

const filterModes: CustomerFilterMode[] = ["all", "today", "recent"];
const summaryModes = filterModes.filter((mode) => mode !== "recent");

export function ReservationsToolbar({
  search,
  onSearchChange,
  filterMode,
  onFilterModeChange,
  filterCounts,
  onAddCustomer,
  onImport,
  downloadOpen,
  onToggleDownload,
  onCloseDownload,
  dlStart,
  dlEnd,
  onDlStartChange,
  onDlEndChange,
  downloading,
  onDownload,
}: Props) {
  const [query, setQuery] = useState(search);

  useEffect(() => {
    setQuery(search);
  }, [search]);

  function submitSearch() {
    onSearchChange(query.trim());
  }

  const chipClass = "flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-white/72 px-3 text-[11px] font-normal text-[#667085]";
  const actionChipClass = "h-7 shrink-0 rounded-full bg-white/72 px-3 text-[11px] font-semibold text-[#0f9b8e] transition active:scale-95";

  return (
    <section className="relative mb-4 h-[184px] overflow-visible rounded-[26px] bg-[#eaf8f3] p-5 shadow-[0_18px_50px_rgba(7,56,58,0.08)] lg:h-[196px] lg:p-6">
      <div className="flex h-full flex-col justify-between">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <div className="flex h-10 items-center gap-2 rounded-[20px] bg-white px-4">
            <span className="text-base text-[#98a2b3]">⌕</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="한글 이름 / 영문 성·이름 검색"
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-[#101828] outline-none placeholder:text-[#98a2b3]"
            />
          </div>
          <button
            type="button"
            onClick={submitSearch}
            className="h-10 rounded-[20px] bg-white px-4 text-xs font-semibold text-[#0f9b8e] transition active:scale-95"
          >
            검색
          </button>
        </div>

        <div className="rounded-[20px] bg-white p-1">
          <div className="grid grid-cols-4 gap-1">
            {filterModes.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onFilterModeChange(mode)}
                className={
                  filterMode === mode
                    ? "h-8 rounded-[16px] bg-[#e3f2ee] px-2 text-[11px] font-semibold text-[#0f9b8e]"
                    : "h-8 rounded-[16px] px-2 text-[11px] font-semibold text-[#667085] transition hover:bg-[#f6f7f5]"
                }
              >
                {FILTER_LABELS[mode]}
              </button>
            ))}
            <button
              type="button"
              onClick={onAddCustomer}
              className="h-8 whitespace-nowrap rounded-[16px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-2 text-[11px] font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.18)] transition active:scale-95"
            >
              + 고객등록
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2.5 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {summaryModes.map((mode) => (
            <span key={mode} className={chipClass}>
              <span className="h-2 w-2 rounded-full bg-[#0f9b8e]" />
              {FILTER_LABELS[mode]} {filterCounts[mode] || 0}
            </span>
          ))}
          <button
            type="button"
            onClick={onImport}
            className={actionChipClass}
          >
            외부 링크
          </button>
          <button
            type="button"
            onClick={onToggleDownload}
            className={actionChipClass}
          >
            CSV
          </button>
        </div>
      </div>

      {downloadOpen && (
        <>
          <div className="fixed inset-0 z-[9990]" onClick={onCloseDownload} />
          <div className="absolute right-5 top-[calc(100%-8px)] z-[9991] w-[280px] rounded-[24px] bg-white p-4 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
            <div className="mb-1 text-sm font-bold text-[#101828]">예약 데이터 다운로드</div>
            <div className="mb-3 text-xs text-[#667085]">선택한 기간의 예약을 CSV로 내보냅니다.</div>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#667085]">시작일</label>
                <input
                  type="date"
                  value={dlStart}
                  onChange={(e) => onDlStartChange(e.target.value)}
                  className="w-full min-w-0 appearance-none rounded-[16px] border border-[#dbe7e3] bg-white px-2 py-2 text-xs focus:border-[#5bd5c8] focus:outline-none focus:ring-2 focus:ring-[#dff7f3]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#667085]">종료일</label>
                <input
                  type="date"
                  value={dlEnd}
                  onChange={(e) => onDlEndChange(e.target.value)}
                  className="w-full min-w-0 appearance-none rounded-[16px] border border-[#dbe7e3] bg-white px-2 py-2 text-xs focus:border-[#5bd5c8] focus:outline-none focus:ring-2 focus:ring-[#dff7f3]"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading}
              className="mt-2 w-full rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,143,131,0.12)] transition active:scale-95 disabled:opacity-50"
            >
              {downloading ? "생성 중..." : "CSV 다운로드"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
