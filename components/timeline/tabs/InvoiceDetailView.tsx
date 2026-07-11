import type { InvoiceRecord } from "@/lib/invoices";
import { INVOICE_STATUS_CLASS, INVOICE_STATUS_LABEL } from "./invoiceTabUi";

type Props = {
  invoice: InvoiceRecord;
  onEdit: () => void;
  onBack: () => void;
};

const PAYMENT_LABEL: Record<string, string> = { cash: "현금", card: "카드", mixed: "혼합" };

export function InvoiceDetailView({ invoice, onEdit, onBack }: Props) {
  const details: [string, string][] = [
    ["병원명", invoice.hospitalName || "-"],
    ["수술날짜", invoice.surgeryDate || "-"],
    ["수술/시술명", invoice.surgeryItems || "-"],
    ["담당원장", invoice.doctors?.join(", ") || "-"],
    ["담당자", invoice.coordinators?.join(", ") || "-"],
    ["수술비", invoice.totalAmount ? `₩${Number(invoice.totalAmount).toLocaleString("ko-KR")}` : "-"],
    ["결제방법", PAYMENT_LABEL[invoice.paymentMethod ?? ""] || "-"],
    ["커미션율", invoice.commissionRate !== undefined ? `${invoice.commissionRate}%` : "-"],
    ["커미션액", invoice.commissionAmount ? `₩${Number(invoice.commissionAmount).toLocaleString("ko-KR")}` : "-"],
    ["메모", invoice.memo || "-"],
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-xs text-gray-500 hover:underline">← 목록</button>
        <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${INVOICE_STATUS_CLASS[invoice.status] || "bg-gray-100 text-gray-500"}`}>
          {INVOICE_STATUS_LABEL[invoice.status] || invoice.status}
        </span>
        <span className="text-xs text-gray-400">{invoice.invoiceId}</span>
      </div>

      <div className="space-y-2 rounded-xl border border-[#edf0f3] bg-white p-4 text-sm">
        {details.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <span className="w-24 shrink-0 text-xs text-gray-500">{label}</span>
            <span className="text-xs font-medium text-gray-800">{value}</span>
          </div>
        ))}
      </div>

      <button onClick={onEdit} className="w-full rounded-xl bg-[#1d9e75] px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95">
        수정하기
      </button>
    </div>
  );
}
