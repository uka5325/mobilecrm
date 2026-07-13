"use client";

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
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

// 예약관리 상단 툴바 — 검색 + 고객 등록 / 외부 링크 가져오기 / CSV 다운로드 드롭다운.
export function ReservationsToolbar({
  search,
  onSearchChange,
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
  return (
    <div className="-mx-6 mb-4 rounded-t-2xl border border-[#edf0f3] bg-[#ecfdf5] px-4 py-4 lg:-mx-8 lg:px-8">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="한글 이름 / 영문 성·이름 검색"
          className="h-10 min-w-0 flex-1 rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm outline-none focus:border-[#1d9e75]"
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={onAddCustomer}
          className="h-10 flex-1 whitespace-nowrap rounded-xl bg-black px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
        >
          + 고객 등록
        </button>
        <button
          onClick={onImport}
          className="h-10 flex-1 whitespace-nowrap rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm text-gray-700 transition hover:-translate-y-0.5 hover:bg-gray-50 active:scale-95"
        >
          🔗 외부 링크 가져오기
        </button>

        <div className="relative flex-1">
          <button
            onClick={onToggleDownload}
            className="h-10 w-full whitespace-nowrap rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm text-gray-700 transition hover:-translate-y-0.5 hover:bg-gray-50 active:scale-95"
          >
            📥 다운로드
          </button>

        {downloadOpen && (
          <>
            <div className="fixed inset-0 z-[9990]" onClick={onCloseDownload} />
            <div className="absolute right-0 top-full z-[9991] mt-2 w-[280px] rounded-2xl border border-[#edf0f3] bg-white p-4 shadow-xl">
              <div className="mb-3 text-sm font-bold text-gray-700">예약 데이터 다운로드</div>
              <div className="mb-2 text-xs text-gray-400">선택한 기간의 예약을 CSV로 내보냅니다.</div>
              <div className="mb-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">시작일</label>
                  <input
                    type="date"
                    value={dlStart}
                    onChange={(e) => onDlStartChange(e.target.value)}
                    className="w-full min-w-0 appearance-none rounded-xl border border-[#dfe3e8] px-2 py-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">종료일</label>
                  <input
                    type="date"
                    value={dlEnd}
                    onChange={(e) => onDlEndChange(e.target.value)}
                    className="w-full min-w-0 appearance-none rounded-xl border border-[#dfe3e8] px-2 py-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>
              </div>
              <div className="mb-3 text-xs text-gray-400">
                선택한 기간의 예약을 서버에서 조회해 내보냅니다.
              </div>
              <button
                onClick={onDownload}
                disabled={downloading}
                className="w-full rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {downloading ? "생성 중..." : "CSV 다운로드"}
              </button>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
