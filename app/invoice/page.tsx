"use client";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { InvoiceListTab } from "@/components/invoice/InvoiceListTab";

export default function InvoicePage() {
  const { currentUser, authReady } = useCurrentUser();

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
      <InvoiceListTab />
    </div>
  );
}
