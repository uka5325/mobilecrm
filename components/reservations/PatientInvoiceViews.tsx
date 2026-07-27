import type { InvoiceRecord } from "@/features/invoices/data/client/invoices";
import type { ReservationRecord } from "@/features/reservations/domain/reservationModels";
import { paymentMethodLabel } from "@/lib/commissionUtils";
import { formatMoney, INVOICE_STATUS_CLASS, INVOICE_STATUS_LABEL } from "@/components/invoices/invoiceUi";

function InvoiceDetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[18px] bg-[#f8fbfa] px-3 py-2.5 text-sm">
      <div className="text-[11px] font-semibold text-[#98a2b3]">{label}</div>
      <div className="mt-1 break-words font-semibold text-[#101828]">{value}</div>
    </div>
  );
}

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
  const managerName = invoice.commissionStaffName || invoice.coordinators?.join(", ") || "-";
  const fullRows: [string, string][] = [
    ["인보이스 ID", invoice.invoiceId],
  ];
  const pairedRows: Array<[[string, string], [string, string]]> = [
    [["병원명", invoice.hospitalName || "-"], ["수술날짜", invoice.surgeryDate || "-"]],
    [["담당자", managerName], ["결제방법", paymentMethodLabel(invoice.paymentMethod)]],
    [["최종 수술비", invoice.totalAmount ? `₩${formatMoney(Number(invoice.totalAmount))}` : "-"], ["커미션 기준액", invoice.commissionBase ? `₩${formatMoney(Number(invoice.commissionBase))}` : "-"]],
    [["커미션율", invoice.commissionRate !== undefined ? `${invoice.commissionRate}%` : "-"], ["커미션액", invoice.commissionAmount ? `₩${formatMoney(Number(invoice.commissionAmount))}` : "-"]],
    [["담당원장", invoice.doctors?.join(", ") || "-"], ["수술/시술명", invoice.surgeryItems || "-"]],
  ];
  const memoRows: [string, string][] = [
    ["메모", invoice.memo || "-"],
  ];

  return (
    <div className="fixed inset-0 z-[1100] flex items-start justify-center overflow-y-auto bg-black/35 px-3 py-8 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div className="my-auto w-full max-w-lg rounded-[30px] bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.22)]" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button onClick={onBack} className="mb-2 rounded-full bg-[#e3f2ee] px-3 py-1.5 text-xs font-semibold text-[#0f9b8e]">← 목록</button>
            <div className="text-[11px] font-bold tracking-[0.24em] text-[#0f9b8e]">INVOICE</div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="min-w-0 text-xl font-extrabold leading-snug text-[#101828]">{patientName} 인보이스 상세</h2>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${INVOICE_STATUS_CLASS[invoice.status] || "bg-gray-100 text-gray-500"}`}>
                {INVOICE_STATUS_LABEL[invoice.status] || invoice.status}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#f6f7f5] text-xl text-[#667085] transition hover:bg-[#e3f2ee] hover:text-[#0f9b8e]" aria-label="닫기">✕</button>
        </div>

        <div className="grid gap-2">
          {fullRows.map(([label, value]) => (
            <InvoiceDetailField key={label} label={label} value={value} />
          ))}

          {pairedRows.map(([left, right]) => (
            <div key={left[0] + right[0]} className="grid grid-cols-2 gap-2">
              <InvoiceDetailField label={left[0]} value={left[1]} />
              <InvoiceDetailField label={right[0]} value={right[1]} />
            </div>
          ))}

          {memoRows.map(([label, value]) => (
            <InvoiceDetailField key={label} label={label} value={value} />
          ))}
        </div>

        <button onClick={onEdit} className="mt-5 h-11 w-full rounded-[20px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,143,131,0.12)] transition active:scale-95">
          수정하기
        </button>
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
    <div className="rounded-[22px] bg-[#f8fbfa] p-3.5 shadow-[0_8px_18px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{invoice.hospitalName || "병원명 미입력"}</span>
            {invoice.doctors?.length > 0 && <span className="text-xs text-gray-500">{invoice.doctors.join(", ")}</span>}
            {reservation && <span className="rounded-full bg-[#0f9b8e] px-2 py-0.5 text-[10px] font-bold text-white">이 예약</span>}
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
          <button onClick={onView} className="rounded-full bg-[#e3f2ee] px-2.5 py-1 text-xs font-semibold text-[#0f9b8e]">보기</button>
          <button onClick={onEdit} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#667085]">수정</button>
          <button onClick={onDelete} className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">삭제</button>
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
    return <div className="rounded-[22px] bg-[#f6f7f5] p-3 text-center text-xs text-[#8b93a1]">생성 가능한 일정을 불러오는 중...</div>;
  }
  if (!reservations.length) {
    return <div className="rounded-[22px] bg-[#f6f7f5] p-3 text-center text-xs text-[#8b93a1]">생성 가능한 수술/시술 일정이 없습니다.</div>;
  }
  return (
    <div className="space-y-2">
      {reservations.map((reservation) => (
        <div key={reservation.id} className="flex items-center justify-between rounded-[22px] bg-[#f8fbfa] p-3 shadow-[0_8px_18px_rgba(15,23,42,0.035)]">
          <div>
            <div className="text-xs font-medium text-gray-700">{reservation.reservationDate} {reservation.reservationTime}</div>
            <div className="text-xs text-gray-500">{reservation.hospital || "병원명 없음"} · {reservation.appointmentType}</div>
          </div>
          <button onClick={() => onCreate(reservation.id)} disabled={creatingId === reservation.id} className="rounded-full bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {creatingId === reservation.id ? "생성 중..." : "생성"}
          </button>
        </div>
      ))}
    </div>
  );
}
