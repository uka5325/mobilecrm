import { memo } from "react";

export const QuickButton = memo(function QuickButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-9 shrink-0 rounded-[18px] bg-white px-4 text-xs font-semibold text-[#667085] shadow-[0_8px_18px_rgba(15,23,42,0.035)] transition hover:-translate-y-0.5 hover:bg-[#f8fbfa] hover:text-[#0f9b8e] active:scale-95"
    >
      {children}
    </button>
  );
});
