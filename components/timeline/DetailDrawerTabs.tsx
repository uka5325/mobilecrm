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
    <div className="flex shrink-0 border-b border-[#edf0f3]">
      {(Object.keys(TAB_LABELS) as DetailTab[]).map((key) => (
        <button
          key={key}
          onClick={() => onTabChange(key)}
          className={`flex-1 border-b-2 py-2 text-center text-xs transition hover:bg-gray-50 active:scale-[0.98] ${
            activeTab === key
              ? "border-[#1d9e75] font-semibold text-[#1d9e75]"
              : "border-transparent text-gray-500"
          }`}
        >
          {TAB_LABELS[key]}
        </button>
      ))}
    </div>
  );
}
