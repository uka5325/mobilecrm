export function KpiCard({
  label,
  value,
  sub,
  depositLines,
  compact,
}: {
  label: string;
  value?: string;
  sub: string;
  depositLines?: string[];
  compact?: boolean;
}) {
  return (
    <div className="flex min-h-[150px] flex-col rounded-[20px] border border-[#edf0f3] bg-white px-6 py-5 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
      <div className="text-base font-bold leading-tight text-gray-700">{label}</div>

      <div className={`flex flex-1 flex-col ${compact ? "justify-start pt-5" : "justify-center -translate-y-1"}`}>
        {depositLines ? (
          <div className="flex flex-col gap-0.5 text-lg font-extrabold leading-relaxed text-gray-900">
            {depositLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        ) : (
          <div className="text-[34px] font-black leading-none tracking-[-0.7px] text-gray-900">{value}</div>
        )}

        <div className={`${compact ? "mt-4" : "mt-3"} text-[13px] font-medium leading-relaxed text-gray-400`}>
          {sub}
        </div>
      </div>
    </div>
  );
}
