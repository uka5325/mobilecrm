import { memo } from "react";

export const QuickButton = memo(function QuickButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-700 transition hover:-translate-y-0.5 hover:bg-gray-200 active:scale-95"
    >
      {children}
    </button>
  );
});
