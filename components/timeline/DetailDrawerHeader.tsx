"use client";

import type { ReservationRecord } from "@/lib/reservations";
import { getBirthGenderText } from "@/lib/timelineUtils";

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

  return (
    <div className="shrink-0 border-b border-[#edf0f3] px-5 py-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-xl font-bold">{reservation.name}</div>
          {birthGenderText && (
            <div className="mt-0.5 text-sm text-gray-500">{birthGenderText}</div>
          )}
          {(reservation.hospital || reservation.reservationTime || (reservation.doctors && reservation.doctors.length > 0)) && (
            <div className="mt-0.5 text-sm text-gray-500">
              {[
                reservation.hospital,
                reservation.doctors?.length ? reservation.doctors.join(", ") : null,
                reservation.reservationTime,
              ].filter(Boolean).join(" · ")}
            </div>
          )}
          {reservation.consultArea && (
            <div className="mt-0.5 text-xs text-gray-400">
              {reservation.appointmentType === "상담" ? "상담부위" : "수술항목"}: {reservation.consultArea}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="ml-3 shrink-0 text-2xl leading-none text-gray-400 transition hover:scale-110 hover:text-gray-700 active:scale-95"
        >
          ×
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onCompletedToggle}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
            completed
              ? "border-gray-500 bg-gray-500 text-white"
              : "border-gray-300 bg-white text-gray-600"
          }`}
        >
          완료 {completed ? "✓" : "—"}
        </button>
        <button
          onClick={onCancelledToggle}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
            cancelled
              ? "border-yellow-400 bg-yellow-100 text-yellow-800"
              : "border-gray-300 bg-white text-gray-600"
          }`}
        >
          취소 {cancelled ? "✓" : "—"}
        </button>
        {reservation.appointmentType === "상담" && (
          <button
            onClick={onSurgeryToggle}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
              reservation.surgeryReserved
                ? "border-purple-600 bg-purple-600 text-white"
                : "border-purple-400 bg-white text-purple-700"
            }`}
          >
            수술예약 {reservation.surgeryReserved ? "✓" : "—"}
          </button>
        )}
        <button
          onClick={onAddReservation}
          className="rounded-lg border border-emerald-500 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
        >
          + 추가 예약
        </button>
      </div>
    </div>
  );
}
