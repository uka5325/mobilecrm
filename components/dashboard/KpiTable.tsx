import { memo, useState } from "react";

export const KpiTable = memo(function KpiTable({
  headers,
  rows,
  pageSize = 10,
}: {
  headers: string[];
  rows: string[][];
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = rows.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-[#edf0f3] bg-[#f8fafc]">
            <tr>
              {headers.map((header, i) => (
                <th
                  key={header}
                  className={`whitespace-nowrap px-4 py-3 text-xs font-semibold text-gray-500 ${i === 0 ? "pl-6 text-left lg:pl-8" : "text-right"}`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f1f3f5]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="py-8 text-center text-sm text-gray-400">
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              visibleRows.map((row, rowIndex) => (
                <tr key={page * pageSize + rowIndex} className="hover:bg-[#f8fafc]">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={`whitespace-nowrap px-4 py-3 ${cellIndex === 0 ? "pl-6 font-medium text-gray-800 lg:pl-8" : "text-right text-gray-600"}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 lg:px-8">
          <span className="text-[11px] text-gray-400">
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, rows.length)} / {rows.length}건
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-[#edf0f3] px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-50 disabled:opacity-30"
            >
              ‹
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-lg border border-[#edf0f3] px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-50 disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
