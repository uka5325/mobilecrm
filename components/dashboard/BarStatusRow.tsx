export function BarStatusRow({ label, count, percentage }: { label: string; count: number; percentage: number }) {
  const safePercentage = Math.min(Math.max(percentage, 0), 100);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-gray-500">{count.toLocaleString("ko-KR")}명 · {safePercentage}%</span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-[#1d9e75]" style={{ width: `${safePercentage}%` }} />
      </div>
    </div>
  );
}
