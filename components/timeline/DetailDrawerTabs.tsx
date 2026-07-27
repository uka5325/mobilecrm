"use client";

export type DetailTab = "info" | "settlement" | "files" | "notes" | "logs" | "invoice";

type Props = {
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
};

const TAB_LABELS: Record<DetailTab, string> = {
  info: "기본정보",
  settlement: "정산",
  files: "파일",
  notes: "메모",
  logs: "로그",
  invoice: "인보이스",
};

export function DetailDrawerTabs({ activeTab, onTabChange }: Props) {
  return (
    <div className="shrink-0 bg-white px-4 pb-3 sm:px-5">
      <div className="flex gap-1 overflow-x-auto rounded-[20px] bg-[#f6f7f5] p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {(Object.keys(TAB_LABELS) as DetailTab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={`h-8 shrink-0 rounded-[16px] px-3 text-center text-xs transition active:scale-[0.98] ${
              activeTab === key
                ? "bg-[#e3f2ee] font-semibold text-[#0f9b8e]"
                : "text-[#667085]"
            }`}
          >
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>
    </div>
  );
}
