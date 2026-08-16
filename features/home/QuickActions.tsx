"use client";

import { useRouter } from "next/navigation";

const actions = [
  { label: "스케줄", href: "/schedule" },
  { label: "고객관리", href: "/reservations" },
  { label: "커미션", href: "/commission" },
];

export default function QuickActions() {
  const router = useRouter();

  return (
    <section>
      <h2 className="text-xl font-black tracking-[-0.04em] text-[#12151f]">빠른 메뉴</h2>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {actions.map((action) => (
          <button
            key={action.href}
            type="button"
            onClick={() => router.push(action.href)}
            className="min-h-[92px] rounded-[24px] bg-white px-3 py-5 text-center text-sm font-black text-[#12151f] shadow-[0_14px_40px_rgba(15,23,42,0.06)] transition active:scale-[0.98]"
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
