"use client";

import type { ReservationRecord } from "@/features/reservations/domain/reservationModels";
import { getAppointmentColor } from "@/features/reservations/ui/scheduleLayout";
import { getBirthGenderText } from "@/features/reservations/ui/timelineUtils";

type Props = {
  reservation: ReservationRecord;
  completed: boolean;
  cancelled: boolean;
  onClose: () => void;
  onCompletedToggle: () => void;
  onCancelledToggle: () => void;
  onSurgeryToggle: () => void;
  onAddReservation: () => void;
};

export function DetailDrawerHeader({
  reservation,
  completed,
  cancelled,
  onClose,
  onCompletedToggle,
  onCancelledToggle,
  onSurgeryToggle,
  onAddReservation,
}: Props) {
  const birthGenderText = getBirthGenderText(reservation);
  const typeColor = getAppointmentColor(reservation.appointmentType);
  const detailLabel = reservation.appointmentType === "상담" ? "상담 항목" : "예약 항목";

  return (
    <div className="shrink-0 bg-white px-5 pb-4 pt-5 sm:px-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ backgroundColor: `${typeColor}16`, color: typeColor }}
            >
              {reservation.appointmentType}
            </span>
            <span className="rounded-full bg-[#e3f2ee] px-2.5 py-1 text-[11px] font-semibold text-[#0f9b8e]">
              {reservation.reservationDate} {reservation.reservationTime?.slice(0, 5)}
            </span>
          </div>
          <h2 className="break-words text-2xl font-bold tracking-[-0.04em] text-[#101828]">
            {reservation.name || "이름 없음"}
          </h2>
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs font-normal text-[#667085]">
            {birthGenderText ? <span>{birthGenderText}</span> : null}
            {reservation.hospital ? <span>{reservation.hospital}</span> : null}
            {reservation.doctors?.length ? <span>{reservation.doctors.join(", ")}</span> : null}
          </div>
          {reservation.consultArea && (
            <div className="mt-2 truncate text-xs font-normal text-[#667085]">
              {detailLabel}: {reservation.consultArea}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f6f7f5] text-2xl leading-none text-[#667085] transition active:scale-95"
          aria-label="닫기"
        >
          ×
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onCompletedToggle}
          className={`h-8 rounded-full px-3 text-xs font-semibold transition active:scale-95 ${
            completed
              ? "bg-[#667085] text-white"
              : "bg-[#f6f7f5] text-[#667085]"
          }`}
        >
          완료 {completed ? "✓" : "—"}
        </button>
        <button
          type="button"
          onClick={onCancelledToggle}
          className={`h-8 rounded-full px-3 text-xs font-semibold transition active:scale-95 ${
            cancelled
              ? "bg-[#fff3c4] text-[#b7791f]"
              : "bg-[#f6f7f5] text-[#667085]"
          }`}
        >
          취소 {cancelled ? "✓" : "—"}
        </button>
        {reservation.appointmentType === "상담" && (
          <button
            type="button"
            onClick={onSurgeryToggle}
            className={`h-8 rounded-full px-3 text-xs font-semibold transition active:scale-95 ${
              reservation.surgeryReserved
                ? "bg-[#7c3aed] text-white"
                : "bg-[#f3edff] text-[#7c3aed]"
            }`}
          >
            수술예약 {reservation.surgeryReserved ? "✓" : "—"}
          </button>
        )}
        <button
          type="button"
          onClick={onAddReservation}
          className="h-8 rounded-full bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-3 text-xs font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition active:scale-95"
        >
          + 추가 예약
        </button>
      </div>
    </div>
  );
}
