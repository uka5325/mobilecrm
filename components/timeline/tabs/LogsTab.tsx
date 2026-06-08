"use client";

import { type LogRecord } from "@/lib/logs";
import { formatLogDate, getLogBadgeClass } from "@/lib/timelineUtils";

type Props = {
  logs: LogRecord[];
  loading: boolean;
  error: string;
};

export function LogsTab({ logs, loading, error }: Props) {
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
      <div className="rounded-xl border border-[#edf0f3] bg-white p-4 text-sm text-gray-400">
        등록된 로그가 없습니다.
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
    </div>
  );
}
