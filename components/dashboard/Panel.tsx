export function Panel({ title, rightText, children }: { title: string; rightText?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-[#edf0f3] bg-white p-5 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        {rightText && <span className="text-xs text-gray-400">{rightText}</span>}
      </div>

      {children}
    </section>
  );
}
