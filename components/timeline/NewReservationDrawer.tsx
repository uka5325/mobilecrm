"use client";

import { useEffect, useMemo, useState } from "react";
import { APPOINTMENT_TYPES, type AppointmentType } from "@/features/reservations/domain/reservationModels";
import { createReservation } from "@/features/reservations/data/client";
import { parseBirthInfo } from "@/lib/birthUtils";
import type { StaffUser } from "@/lib/auth";
import { todayString } from "@/lib/dateUtils";

type InitialPatient = {
  name?: string;
  birthInput?: string;
  phone?: string;
  nationality?: string;
  patientId?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  currentUser: StaffUser;
  initialDate?: string;
  initialPatient?: InitialPatient;
  onCreated?: () => void;
};

const EMPTY_FORM = (date: string, patient?: InitialPatient) => ({
  name: patient?.name || "",
  birthInput: patient?.birthInput || "",
  phone: patient?.phone || "",
  nationality: patient?.nationality || "",
  consultArea: "",
  reservationDate: date,
  reservationTime: "",
  hospital: "",
  doctors: "",
  appointmentType: "상담" as AppointmentType,
  coordinators: "",
});

export function NewReservationDrawer({ open, onClose, currentUser, initialDate, initialPatient, onCreated }: Props) {
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState(EMPTY_FORM(initialDate || todayString(), initialPatient));

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM(initialDate || todayString(), initialPatient));
      setErrorMessage("");
      setSaving(false);
    }
  }, [open, initialDate, initialPatient]);

  const birthPreview = useMemo(() => parseBirthInfo(form.birthInput), [form.birthInput]);

  async function handleCreate() {
    if (!form.name.trim()) { setErrorMessage("이름을 입력하세요."); return; }
    if (!form.reservationDate) { setErrorMessage("예약날짜를 선택하세요."); return; }

    setSaving(true);
    setErrorMessage("");

    try {
      const result = await createReservation(
        {
          name: form.name,
          birthInput: form.birthInput,
          birth: form.birthInput,
          phone: form.phone,
          nationality: form.nationality,
          consultArea: form.consultArea,
          reservationDate: form.reservationDate,
          reservationTime: form.reservationTime,
          hospital: form.hospital,
          doctors: form.doctors.split(",").map((s) => s.trim()).filter(Boolean),
          appointmentType: form.appointmentType,
          coordinators: form.coordinators.split(",").map((s) => s.trim()).filter(Boolean),
          patientId: initialPatient?.patientId,
        },
        currentUser
      );

      if (!result.success) {
        setErrorMessage(result.message || "예약 등록에 실패했습니다.");
        return;
      }

      onCreated?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`저장 오류: ${msg}`);
      console.error("[NewReservationDrawer] save error:", (err as Error)?.message ?? "");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[1001] flex items-start justify-center overflow-y-auto bg-black/35 px-3 py-8 backdrop-blur-[2px] sm:items-center sm:p-8"
        onClick={onClose}
      >
        <div
          className="flex h-[calc(100dvh-64px)] max-h-[calc(100dvh-64px)] w-full max-w-[640px] flex-col overflow-hidden rounded-[30px] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.26)] sm:h-[min(720px,calc(100dvh-64px))]"
          onClick={(e) => e.stopPropagation()}
        >
        <div className="flex shrink-0 items-center justify-between bg-white px-5 pb-4 pt-5 sm:px-6">
          <div>
            <div className="text-xl font-bold">
              {initialPatient?.name ? `${initialPatient.name} 추가 예약` : "신규 예약 등록"}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              {initialPatient?.name ? "동일 환자 추가 예약" : "단일 예약 추가"}
            </div>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f6f7f5] text-2xl leading-none text-[#667085] transition active:scale-95">×</button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto bg-white px-5 pb-5 pt-3 sm:px-6">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">이름 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="mt-1 w-full rounded-[16px] bg-[#f8fbfa] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-[#bdeee8] sm:text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500">생년월일</label>
              <input
                value={form.birthInput}
                onChange={(e) => setForm((p) => ({ ...p, birthInput: e.target.value }))}
                placeholder="891210-1 / 19891210-1"
                className="mt-1 w-full rounded-[16px] bg-[#f8fbfa] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-[#bdeee8] sm:text-sm"
              />
              {form.birthInput && (
                <div className="mt-1 text-xs text-gray-500">
                  {birthPreview.birthDisplay && <span>{birthPreview.birthDisplay}</span>}
                  {birthPreview.ageText && <span> · {birthPreview.ageText}</span>}
                  {birthPreview.gender && <span> · {birthPreview.gender}</span>}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-gray-500">연락처</label>
              <input
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                className="mt-1 w-full rounded-[16px] bg-[#f8fbfa] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-[#bdeee8] sm:text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500">국적</label>
              <input
                value={form.nationality}
                onChange={(e) => setForm((p) => ({ ...p, nationality: e.target.value }))}
                placeholder="몽골"
                className="mt-1 w-full rounded-[16px] bg-[#f8fbfa] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-[#bdeee8] sm:text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">병원명</label>
              <input
                value={form.hospital}
                onChange={(e) => setForm((p) => ({ ...p, hospital: e.target.value }))}
                placeholder="예: 강남성형외과"
                className="mt-1 w-full rounded-[16px] bg-[#f8fbfa] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-[#bdeee8] sm:text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">담당 원장</label>
              <input
                value={form.doctors}
                onChange={(e) => setForm((p) => ({ ...p, doctors: e.target.value }))}
                placeholder="쉼표로 구분"
                className="mt-1 w-full rounded-[16px] bg-[#f8fbfa] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-[#bdeee8] sm:text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">예약 유형 *</label>
              <select
                value={form.appointmentType}
                onChange={(e) => setForm((p) => ({ ...p, appointmentType: e.target.value as AppointmentType }))}
                className="mt-1 w-full rounded-[16px] bg-[#f8fbfa] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-[#bdeee8] sm:text-sm"
              >
                {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">
                {form.appointmentType === "상담" ? "상담부위" : "수술항목"}
              </label>
              <input
                value={form.consultArea}
                onChange={(e) => setForm((p) => ({ ...p, consultArea: e.target.value }))}
                className="mt-1 w-full rounded-[16px] bg-[#f8fbfa] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-[#bdeee8] sm:text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="text-xs text-gray-500">예약날짜 *</label>
              <input
                type="date"
                value={form.reservationDate}
                onChange={(e) => setForm((p) => ({ ...p, reservationDate: e.target.value }))}
                className="mt-1 min-w-0 w-full appearance-none rounded-[16px] bg-[#f8fbfa] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-[#bdeee8] sm:text-sm"
              />
            </div>
            <div className="min-w-0">
              <label className="text-xs text-gray-500">예약시간</label>
              <input
                type="time"
                value={form.reservationTime}
                onChange={(e) => setForm((p) => ({ ...p, reservationTime: e.target.value }))}
                className="mt-1 min-w-0 w-full appearance-none rounded-[16px] bg-[#f8fbfa] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-[#bdeee8] sm:text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">담당자</label>
            <input
              value={form.coordinators}
              onChange={(e) => setForm((p) => ({ ...p, coordinators: e.target.value }))}
              placeholder="쉼표로 구분"
              className="mt-1 w-full rounded-[16px] bg-[#f8fbfa] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-[#bdeee8] sm:text-sm"
            />
          </div>


          {errorMessage && (
            <div className="text-sm text-red-500">{errorMessage}</div>
          )}
        </div>

        <div className="flex shrink-0 gap-2 bg-white p-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-[18px] bg-[#f6f7f5] py-3 text-sm font-semibold text-[#667085] transition active:scale-95"
          >
            취소
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex-1 rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition active:scale-95 disabled:opacity-50"
          >
            {saving ? "저장 중..." : "예약 등록"}
          </button>
        </div>
        </div>
      </div>
    </>
  );
}
