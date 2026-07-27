import { memo } from "react";

export const QuickButton = memo(function QuickButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-8 min-w-0 rounded-[16px] px-3 text-[11px] font-semibold text-[#667085] transition hover:bg-[#f6f7f5] hover:text-[#0f9b8e] active:scale-95"
    >
      {children}
    </button>
  );
});
