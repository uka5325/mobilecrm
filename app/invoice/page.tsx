"use client";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { InvoiceListTab } from "@/components/invoice/InvoiceListTab";

export default function InvoicePage() {
  const { currentUser, authReady } = useCurrentUser();

  if (!authReady) {
    return (
      <div className="flex h-64 items-center justify-center rounded-[28px] bg-white text-sm text-gray-400 shadow-[0_16px_50px_rgba(15,23,42,0.055)]">
        로딩 중...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex h-64 items-center justify-center rounded-[28px] bg-white text-sm text-gray-400 shadow-[0_16px_50px_rgba(15,23,42,0.055)]">
        로그인이 필요합니다.
      </div>
    );
  }

  return <InvoiceListTab />;
}
