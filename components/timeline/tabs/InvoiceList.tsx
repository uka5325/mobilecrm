import type { StaffUser } from "@/lib/auth";
import type { InvoiceRecord } from "@/features/invoices/data/client/invoices";
import { formatMoney, INVOICE_STATUS_CLASS, INVOICE_STATUS_LABEL } from "@/components/invoices/invoiceUi";

type Props = {
  invoices: InvoiceRecord[];
  reservationDocId: string;
  appointmentType?: string;
  coordinators?: string[];
  currentUser: StaffUser;
  creating: boolean;
  error: string;
  onCreate: () => void;
  onView: (invoice: InvoiceRecord) => void;
  onEdit: (invoice: InvoiceRecord) => void;
  onDelete: (invoice: InvoiceRecord) => void;
};

export function InvoiceList({
  invoices,
  reservationDocId,
  appointmentType,
  coordinators,
  currentUser,
  creating,
  error,
  onCreate,
  onView,
  onEdit,
  onDelete,
}: Props) {
  const reservationInvoice = invoices.find((invoice) => invoice.reservationDocId === reservationDocId);
  const canCreate = currentUser.role === "admin" || (coordinators ?? []).includes(currentUser.displayName);
  const eligibleAppointment = appointmentType === "수술" || appointmentType === "시술";

  return (
    <div className="space-y-3">
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-xs text-red-600">{error}</div>}

      {!reservationInvoice && (
        <div className="rounded-[24px] bg-[#eaf8f3] p-4 text-center shadow-[0_8px_18px_rgba(15,23,42,0.035)]">
          {eligibleAppointment ? (canCreate ? (
            <>
              <div className="text-sm text-gray-400">이 예약에 대한 인보이스가 없습니다.</div>
              <button onClick={onCreate} disabled={creating} className="mt-3 w-full rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,143,131,0.12)] transition active:scale-95 disabled:opacity-50">
                {creating ? "생성 중..." : "이 예약으로 인보이스 생성"}
              </button>
            </>
          ) : (
            <div className="text-sm text-gray-400">담당 코디네이터만 인보이스를 생성할 수 있습니다.</div>
          )) : (
            <div className="text-sm text-gray-400">수술·시술 예약 건만 인보이스를 생성할 수 있습니다.</div>
          )}
        </div>
      )}

      {invoices.length > 0 && (
        <div className="space-y-2">
          {invoices.length > 1 && <div className="text-xs font-semibold text-gray-500">이 환자의 인보이스 {invoices.length}건</div>}
          {invoices.map((invoice) => {
            const isCurrentReservation = invoice.reservationDocId === reservationDocId;
            return (
              <div key={invoice.id} className={`rounded-[20px] p-3 shadow-[0_8px_18px_rgba(15,23,42,0.035)] ${isCurrentReservation ? "bg-[#eaf8f3]" : "bg-[#f8fbfa]"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{invoice.hospitalName || "병원명 미입력"}</span>
                      {invoice.doctors?.length > 0 && <span className="text-xs text-gray-500">{invoice.doctors.join(", ")}</span>}
                      {isCurrentReservation && <span className="rounded-full bg-[#0f9b8e] px-1.5 py-0.5 text-[10px] font-bold text-white">이 예약</span>}
                    </div>
                    {invoice.surgeryItems && <div className="mt-0.5 truncate text-xs text-gray-500">{invoice.surgeryItems}</div>}
                    {invoice.surgeryDate && <div className="mt-0.5 text-xs text-gray-400">수술일: {invoice.surgeryDate}</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${INVOICE_STATUS_CLASS[invoice.status] || "bg-gray-100 text-gray-500"}`}>
                        {INVOICE_STATUS_LABEL[invoice.status] || invoice.status}
                      </span>
                      {invoice.totalAmount > 0 && <span className="text-xs text-gray-600">₩{formatMoney(invoice.totalAmount)}</span>}
                      {invoice.commissionAmount && <span className="text-xs text-[#0f9b8e]">커미션 ₩{formatMoney(invoice.commissionAmount)}</span>}
                    </div>
                    <div className="mt-0.5 text-[10px] text-gray-400">{invoice.invoiceId}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => onView(invoice)} className="rounded-full bg-[#e3f2ee] px-2.5 py-1 text-xs font-semibold text-[#0f9b8e]">보기</button>
                    <button onClick={() => onEdit(invoice)} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#667085]">수정</button>
                    <button onClick={() => onDelete(invoice)} className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">삭제</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {invoices.length === 0 && !reservationInvoice && <div className="py-4 text-center text-xs text-gray-400">인보이스가 없습니다.</div>}
    </div>
  );
}
