import { memo } from "react";

export const Panel = memo(function Panel({ title, rightText, children }: { title: string; rightText?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[28px] bg-white shadow-[0_16px_50px_rgba(15,23,42,0.055)]">
      <div className="flex items-center justify-between px-5 py-4 lg:px-6">
        <h2 className="text-sm font-black tracking-[-0.02em] text-[#101828]">{title}</h2>
        {rightText && <span className="rounded-full bg-[#f6f7f5] px-3 py-1 text-[11px] font-semibold text-[#667085]">{rightText}</span>}
      </div>
      {children}
    </section>
  );
});
