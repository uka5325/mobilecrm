import type { InvoiceRecord } from "@/lib/invoices";
import { paymentMethodLabel } from "@/lib/commissionUtils";
import { formatMoney, INVOICE_STATUS_LABEL } from "@/components/invoices/invoiceUi";

// 커미션 페이지와 인보이스 목록 탭이 공유하는 인보이스 상세 모달.
// 제목만 다르고(정산 상세 / 인보이스 상세) 표시 필드·버튼 동작(onClose)은 동일하다.
type Props = {
  invoice: InvoiceRecord;
  title: string;
  onClose: () => void;
};

export function InvoiceDetailModal({ invoice, title, onClose }: Props) {
  const details: [string, string][] = [
    ["인보이스 ID", invoice.invoiceId],
    ["병원명", invoice.hospitalName || "-"],
    ["수술날짜", invoice.surgeryDate || "-"],
    ["담당원장", invoice.doctors?.join(", ") || "-"],
    ["수술/시술명", invoice.surgeryItems || "-"],
    ["담당자", invoice.commissionStaffName || "-"],
    ["결제방법", paymentMethodLabel(invoice.paymentMethod)],
    ["최종 수술비", formatMoney(invoice.totalAmount) + " KRW"],
    ["커미션 기준액", formatMoney(invoice.commissionBase) + " KRW"],
    ["커미션율", invoice.commissionRate !== undefined ? `${invoice.commissionRate}%` : "-"],
    ["커미션액", formatMoney(invoice.commissionAmount) + " KRW"],
    ["상태", INVOICE_STATUS_LABEL[invoice.status] || invoice.status],
    ["메모", invoice.memo || "-"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-bold">{invoice.patientName} {title}</div>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
        </div>
        <div className="space-y-2 text-sm">
          {details.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <span className="w-28 shrink-0 text-gray-500">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
