import type { InvoiceRecord } from "@/lib/invoices";
import type { ReservationRecord } from "@/lib/reservations";
import { paymentMethodLabel } from "@/lib/commissionUtils";
import { formatMoney, INVOICE_STATUS_CLASS, INVOICE_STATUS_LABEL } from "@/components/invoices/invoiceUi";

export function PatientInvoiceDetailModal({
  invoice,
  patientName,
  onBack,
  onEdit,
  onClose,
}: {
  invoice: InvoiceRecord;
  patientName: string;
  onBack: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const details: [string, string][] = [
    ["인보이스 ID", invoice.invoiceId],
    ["병원명", invoice.hospitalName || "-"],
    ["수술날짜", invoice.surgeryDate || "-"],
    ["수술/시술명", invoice.surgeryItems || "-"],
    ["담당원장", invoice.doctors?.join(", ") || "-"],
    ["담당자", invoice.coordinators?.join(", ") || "-"],
    ["수술비", invoice.totalAmount ? `₩${formatMoney(Number(invoice.totalAmount))}` : "-"],
    ["결제방법", paymentMethodLabel(invoice.paymentMethod)],
    ["커미션율", invoice.commissionRate !== undefined ? `${invoice.commissionRate}%` : "-"],
    ["커미션액", invoice.commissionAmount ? `₩${formatMoney(Number(invoice.commissionAmount))}` : "-"],
    ["상태", INVOICE_STATUS_LABEL[invoice.status] || invoice.status],
    ["메모", invoice.memo || "-"],
  ];

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="relative mx-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
          <button onClick={onBack} className="text-xs text-gray-500 hover:underline">← 목록</button>
          <span className="text-sm font-bold">{patientName} — 인보이스 상세</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-5 text-sm">
          {details.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <span className="w-24 shrink-0 text-gray-500">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </div>
        <div className="shrink-0 border-t border-gray-100 p-4">
          <button onClick={onEdit} className="w-full rounded-xl bg-[#1d9e75] py-2.5 text-sm font-semibold text-white">수정하기</button>
        </div>
      </div>
    </div>
  );
}

export function PatientInvoiceCard({
  invoice,
  reservation,
  onView,
  onEdit,
  onDelete,
}: {
  invoice: InvoiceRecord;
  reservation?: ReservationRecord;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-[#edf0f3] bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{invoice.hospitalName || "병원명 미입력"}</span>
            {invoice.doctors?.length > 0 && <span className="text-xs text-gray-500">{invoice.doctors.join(", ")}</span>}
            {reservation && <span className="rounded-full bg-[#1d9e75] px-1.5 py-0.5 text-[10px] font-bold text-white">이 예약</span>}
          </div>
          {reservation && <div className="mt-0.5 text-xs text-gray-400">{reservation.reservationDate} {reservation.reservationTime}</div>}
          {invoice.surgeryItems && <div className="mt-0.5 truncate text-xs text-gray-500">{invoice.surgeryItems}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${INVOICE_STATUS_CLASS[invoice.status] || "bg-gray-100 text-gray-500"}`}>
              {INVOICE_STATUS_LABEL[invoice.status] || invoice.status}
            </span>
            {invoice.totalAmount > 0 && <span className="text-xs text-gray-600">₩{formatMoney(invoice.totalAmount)}</span>}
            {invoice.commissionAmount ? <span className="text-xs text-[#1d9e75]">커미션 ₩{formatMoney(invoice.commissionAmount)}</span> : null}
          </div>
          <div className="mt-0.5 text-[10px] text-gray-400">{invoice.invoiceId}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={onView} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-100">보기</button>
          <button onClick={onEdit} className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200">수정</button>
          <button onClick={onDelete} className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100">삭제</button>
        </div>
      </div>
    </div>
  );
}

export function PatientInvoiceCreatePanel({
  reservations,
  loading,
  creatingId,
  onCreate,
}: {
  reservations: ReservationRecord[];
  loading: boolean;
  creatingId: string | null;
  onCreate: (reservationId: string) => void;
}) {
  if (loading) {
    return <div className="rounded-xl bg-gray-50 p-3 text-center text-xs text-gray-400">생성 가능한 일정을 불러오는 중...</div>;
  }
  if (!reservations.length) {
    return <div className="rounded-xl bg-gray-50 p-3 text-center text-xs text-gray-400">생성 가능한 수술/시술 일정이 없습니다.</div>;
  }
  return (
    <div className="space-y-2">
      {reservations.map((reservation) => (
        <div key={reservation.id} className="flex items-center justify-between rounded-xl border border-dashed border-[#dfe3e8] p-3">
          <div>
            <div className="text-xs font-medium text-gray-700">{reservation.reservationDate} {reservation.reservationTime}</div>
            <div className="text-xs text-gray-500">{reservation.hospital || "병원명 없음"} · {reservation.appointmentType}</div>
          </div>
          <button onClick={() => onCreate(reservation.id)} disabled={creatingId === reservation.id} className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {creatingId === reservation.id ? "생성 중..." : "생성"}
          </button>
        </div>
      ))}
    </div>
  );
}
