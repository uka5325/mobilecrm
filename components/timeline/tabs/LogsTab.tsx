"use client";

import { type LogRecord } from "@/lib/logs";
import { formatLogDate, getLogBadgeClass } from "@/lib/timelineUtils";

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
      <div className="rounded-xl border border-[#edf0f3] bg-white p-4 text-sm text-gray-400">
        로그를 불러오는 중...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-500">
        {error}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="space-y-2">
        <div className="rounded-xl border border-[#edf0f3] bg-white p-4 text-sm text-gray-400">
          최근 3일간 로그가 없습니다.
        </div>
        {canLoadOlder && onLoadOlder && (
          <button
            onClick={onLoadOlder}
            className="w-full rounded-xl border border-[#dfe3e8] py-2 text-xs text-gray-500 transition hover:bg-gray-50 active:scale-[0.99]"
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
        <div key={log.id} className="rounded-xl border border-[#edf0f3] bg-white p-3 text-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${getLogBadgeClass(String(log.action || ""))}`}>
              {log.action || "LOG"}
            </span>
            <span className="text-[11px] text-gray-400">{formatLogDate(log.createdAt)}</span>
          </div>
          <div className="text-sm leading-6 text-gray-700">{log.message || "로그 내용 없음"}</div>
          {log.staffName && (
            <div className="mt-1 text-[11px] text-gray-400">처리자: {log.staffName}</div>
          )}
        </div>
      ))}
      {canLoadOlder && onLoadOlder && (
        <button
          onClick={onLoadOlder}
          className="w-full rounded-xl border border-[#dfe3e8] py-2 text-xs text-gray-500 transition hover:bg-gray-50 active:scale-[0.99]"
        >
          이전 로그 보기
        </button>
      )}
    </div>
  );
}
