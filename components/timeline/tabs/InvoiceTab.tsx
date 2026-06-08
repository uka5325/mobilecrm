"use client";

import { useRouter } from "next/navigation";

type Props = {
  reservationDocId: string;
  invoiceId: string;
  onDelete: () => void;
};

export function InvoiceTab({ reservationDocId, invoiceId, onDelete }: Props) {
  const router = useRouter();

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border-2 border-dashed border-[#dfe3e8] p-6 text-center">
        <div className="text-sm text-gray-400">
          이 고객의 인보이스를 생성하거나 확인할 수 있습니다.
        </div>
        <button
          onClick={() => router.push(`/invoices/${reservationDocId}`)}
          className="mt-4 w-full rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
        >
          {invoiceId ? "인보이스 열기" : "인보이스 생성"}
        </button>
      </div>

      {invoiceId && (
        <button
          onClick={onDelete}
          className="w-full rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-medium text-red-600 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
        >
          인보이스 삭제
        </button>
      )}
    </div>
  );
}
