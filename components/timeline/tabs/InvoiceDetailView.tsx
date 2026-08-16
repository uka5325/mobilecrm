import type { InvoiceRecord } from "@/features/invoices/data/client/invoices";
import { paymentMethodLabel } from "@/lib/commissionUtils";
import { formatMoney, INVOICE_STATUS_CLASS, INVOICE_STATUS_LABEL } from "@/components/invoices/invoiceUi";

type Props = {
  invoice: InvoiceRecord;
  onEdit: () => void;
  onBack: () => void;
};

export function InvoiceDetailView({ invoice, onEdit, onBack }: Props) {
  const details: [string, string][] = [
    ["병원명", invoice.hospitalName || "-"],
    ["수술날짜", invoice.surgeryDate || "-"],
    ["수술/시술명", invoice.surgeryItems || "-"],
    ["담당원장", invoice.doctors?.join(", ") || "-"],
    ["담당자", invoice.coordinators?.join(", ") || "-"],
    ["수술비", invoice.totalAmount ? `₩${formatMoney(invoice.totalAmount)}` : "-"],
    ["결제방법", paymentMethodLabel(invoice.paymentMethod)],
    ["커미션율", invoice.commissionRate !== undefined ? `${invoice.commissionRate}%` : "-"],
    ["커미션액", invoice.commissionAmount ? `₩${formatMoney(invoice.commissionAmount)}` : "-"],
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

      <div className="space-y-2 rounded-[20px] bg-[#eaf8f3] p-4 text-sm shadow-[0_8px_18px_rgba(15,23,42,0.035)]">
        {details.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <span className="w-24 shrink-0 text-xs text-gray-500">{label}</span>
            <span className="text-xs font-medium text-gray-800">{value}</span>
          </div>
        ))}
      </div>

      <button onClick={onEdit} className="w-full rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,143,131,0.12)] transition active:scale-95">
        수정하기
      </button>
    </div>
  );
}
