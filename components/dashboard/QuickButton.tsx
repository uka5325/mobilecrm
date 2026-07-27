import { memo } from "react";

type QuickButtonProps = {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  tall?: boolean;
};

export const QuickButton = memo(function QuickButton({ children, onClick, active = false, tall = false }: QuickButtonProps) {
  const heightClass = tall ? "h-10" : "h-8";
  const toneClass = active
    ? "bg-[#e3f2ee] text-[#0f9b8e]"
    : "text-[#667085] hover:bg-[#f6f7f5] hover:text-[#0f9b8e]";

  return (
    <button
      onClick={onClick}
      className={`${heightClass} min-w-0 rounded-[16px] px-3 text-[11px] font-semibold transition active:scale-95 ${toneClass}`}
    >
      {children}
    </button>
  );
});
