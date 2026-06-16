"use client";

import { useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { InvoiceListTab } from "@/components/invoice/InvoiceListTab";
import { InvoiceTemplateTab } from "@/components/invoice/InvoiceTemplateTab";

type Tab = "list" | "template";

const TABS: { id: Tab; label: string }[] = [
  { id: "list", label: "인보이스 목록" },
  { id: "template", label: "템플릿 관리" },
];

export default function InvoicePage() {
  const { currentUser, authReady } = useCurrentUser();
  const [activeTab, setActiveTab] = useState<Tab>("list");

  if (!authReady) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        로딩 중...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        로그인이 필요합니다.
      </div>
    );
  }

  return (
    <div className="-mx-6 -mb-6 mt-5 flex flex-col gap-4 pb-8">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-2xl border border-[#edf0f3] bg-white p-1.5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold transition ${
              activeTab === tab.id
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "list" && <InvoiceListTab />}
      {activeTab === "template" && <InvoiceTemplateTab currentUser={currentUser} />}
    </div>
  );
}
