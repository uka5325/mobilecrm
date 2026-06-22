import { memo } from "react";

export const Panel = memo(function Panel({ title, rightText, children }: { title: string; rightText?: string; children: React.ReactNode }) {
  return (
    <section className="-mx-6 border-t border-[#edf0f3] bg-white lg:-mx-8">
      <div className="flex items-center justify-between px-6 py-4 lg:px-8">
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        {rightText && <span className="text-xs text-gray-400">{rightText}</span>}
      </div>
      {children}
    </section>
  );
});
