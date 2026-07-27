"use client";

import { type LogRecord } from "@/lib/logs";
import { formatLogDate } from "@/features/reservations/ui/timelineUtils";

type Props = {
  logs: LogRecord[];
  loading: boolean;
  error: string;
  canLoadOlder?: boolean;
  onLoadOlder?: () => void;
};

export function LogsTab({ logs, loading, error, canLoadOlder, onLoadOlder }: Props) {
  if (loading) {
    return (
      <div className="rounded-[22px] bg-[#f6f7f5] p-4 text-sm text-[#8b93a1]">
        로그를 불러오는 중...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[22px] bg-red-50 p-4 text-sm text-red-500">
        {error}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="space-y-2">
        <div className="rounded-[22px] bg-[#f6f7f5] p-4 text-sm text-[#8b93a1]">
          최근 3일간 로그가 없습니다.
        </div>
        {canLoadOlder && onLoadOlder && (
          <button
            onClick={onLoadOlder}
            className="w-full rounded-[18px] bg-[#e3f2ee] py-2 text-xs font-semibold text-[#0f9b8e] transition active:scale-[0.99]"
          >
            이전 로그 보기
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <div key={log.id} className="rounded-[22px] bg-[#f8fbfa] p-3.5 text-sm shadow-[0_8px_18px_rgba(15,23,42,0.04)]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="rounded-full bg-[#e3f2ee] px-2.5 py-1 text-[10px] font-semibold text-[#0f9b8e]">
              {log.action || "LOG"}
            </span>
            <span className="text-[11px] text-[#98a2b3]">{formatLogDate(log.createdAt)}</span>
          </div>
          <div className="text-sm leading-6 text-[#344054]">{log.message || "로그 내용 없음"}</div>
          {log.staffName && (
            <div className="mt-1 text-[11px] text-[#98a2b3]">처리자: {log.staffName}</div>
          )}
        </div>
      ))}
      {canLoadOlder && onLoadOlder && (
        <button
          onClick={onLoadOlder}
          className="w-full rounded-[18px] bg-[#e3f2ee] py-2 text-xs font-semibold text-[#0f9b8e] transition active:scale-[0.99]"
        >
          이전 로그 보기
        </button>
      )}
    </div>
  );
}
