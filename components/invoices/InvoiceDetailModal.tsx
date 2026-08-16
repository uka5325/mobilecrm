import type { InvoiceRecord } from "@/features/invoices/data/client/invoices";
import { paymentMethodLabel } from "@/lib/commissionUtils";
import { formatMoney, INVOICE_STATUS_CLASS, INVOICE_STATUS_LABEL } from "@/components/invoices/invoiceUi";

// 커미션 페이지와 인보이스 목록 탭이 공유하는 인보이스 상세 모달.
// 제목만 다르고(정산 상세 / 인보이스 상세) 표시 필드·버튼 동작(onClose)은 동일하다.
type Props = {
  invoice: InvoiceRecord;
  title: string;
  onClose: () => void;
  onEdit?: () => void;
};

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[18px] bg-[#f8fbfa] px-3 py-2.5 text-sm">
      <div className="text-[11px] font-semibold text-[#98a2b3]">{label}</div>
      <div className="mt-1 break-words font-semibold text-[#101828]">{value}</div>
    </div>
  );
}

export function InvoiceDetailModal({ invoice, title, onClose, onEdit }: Props) {
  const fullRows: [string, string][] = [
    ["인보이스 ID", invoice.invoiceId],
  ];
  const pairedRows: Array<[[string, string], [string, string]]> = [
    [["병원명", invoice.hospitalName || "-"], ["수술날짜", invoice.surgeryDate || "-"]],
    [["담당자", invoice.commissionStaffName || "-"], ["결제방법", paymentMethodLabel(invoice.paymentMethod)]],
    [["최종 수술비", formatMoney(invoice.totalAmount) + " KRW"], ["커미션 기준액", formatMoney(invoice.commissionBase) + " KRW"]],
    [["커미션율", invoice.commissionRate !== undefined ? `${invoice.commissionRate}%` : "-"], ["커미션액", formatMoney(invoice.commissionAmount) + " KRW"]],
    [["담당원장", invoice.doctors?.join(", ") || "-"], ["수술/시술명", invoice.surgeryItems || "-"]],
  ];
  const memoRows: [string, string][] = [
    ["메모", invoice.memo || "-"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 px-3 py-8 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div className="my-auto w-full max-w-lg rounded-[30px] bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.22)]" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold tracking-[0.24em] text-[#0f9b8e]">INVOICE</div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="min-w-0 text-xl font-extrabold leading-snug text-[#101828]">{invoice.patientName} {title}</h2>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${INVOICE_STATUS_CLASS[invoice.status] || "bg-gray-100 text-gray-500"}`}>
                {INVOICE_STATUS_LABEL[invoice.status] || invoice.status}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#f6f7f5] text-2xl leading-none text-[#667085] transition hover:bg-[#e3f2ee] hover:text-[#0f9b8e]"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="grid gap-2">
          {fullRows.map(([label, value]) => (
            <DetailField key={label} label={label} value={value} />
          ))}

          {pairedRows.map(([left, right]) => (
            <div key={left[0] + right[0]} className="grid grid-cols-2 gap-2">
              <DetailField label={left[0]} value={left[1]} />
              <DetailField label={right[0]} value={right[1]} />
            </div>
          ))}

          {memoRows.map(([label, value]) => (
            <DetailField key={label} label={label} value={value} />
          ))}
        </div>

        <button
          onClick={onEdit || onClose}
          className={onEdit
            ? "mt-5 h-11 w-full rounded-[20px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,143,131,0.12)] transition active:scale-95"
            : "mt-5 h-11 w-full rounded-[20px] bg-[#e3f2ee] text-sm font-bold text-[#0f9b8e] transition active:scale-95"}
        >
          {onEdit ? "수정하기" : "닫기"}
        </button>
      </div>
    </div>
  );
}
