"use client";

import { useEffect, useMemo, useState } from "react";
import { createReservation, type AppointmentType } from "@/lib/reservations";
import { parseBirthInfo } from "@/lib/reservationUtils";
import type { StaffUser } from "@/lib/auth";
import { todayString } from "@/lib/dateUtils";

type InitialPatient = {
  name?: string;
  birthInput?: string;
  phone?: string;
  nationality?: string;
  patientId?: string;
  hospital?: string;
  consultArea?: string;
  appointmentType?: AppointmentType;
  coordinators?: string;
  doctors?: string;
  depositAmount?: string;
  surgeryCost?: string;
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
  reservationDate: date,
});

export function CreateDrawer({ open, onClose, currentUser, initialDate, initialPatient, onCreated }: Props) {
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
          consultArea: "",
          reservationDate: form.reservationDate,
          reservationTime: "",
          hospital: "",
          doctors: [],
          appointmentType: "상담" as AppointmentType,
          coordinators: [],
          depositAmount: "",
          surgeryCost: "",
          patientId: initialPatient?.patientId,
        },
        currentUser
      );

      if (!result.success) {
        setErrorMessage(result.message || "등록에 실패했습니다.");
        return;
      }

      onCreated?.();
      onClose();
    } catch {
      setErrorMessage("등록 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[998] bg-black/35" onClick={onClose} />

      <div className="fixed right-0 top-0 z-[1001] flex h-[100dvh] w-[420px] max-w-[calc(100vw-12px)] flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
        <div className="flex shrink-0 items-center justify-between border-b border-[#edf0f3] px-6 py-5">
          <div>
            <div className="text-xl font-bold">
              {initialPatient?.name ? `${initialPatient.name} 추가 예약` : "고객 등록"}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              {initialPatient?.name ? "동일 환자 추가 예약" : "새 고객 기본 정보를 입력하세요"}
            </div>
          </div>
          <button onClick={onClose} className="text-2xl text-gray-400 transition hover:scale-110 hover:text-gray-700 active:scale-95">×</button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-6">
          <div>
            <label className="text-xs text-gray-500">이름 *</label>
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500">생년월일</label>
            <input
              value={form.birthInput}
              onChange={(e) => setForm((p) => ({ ...p, birthInput: e.target.value }))}
              placeholder="891210-1 / 19891210-1"
              className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
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
              className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500">국적</label>
            <input
              value={form.nationality}
              onChange={(e) => setForm((p) => ({ ...p, nationality: e.target.value }))}
              placeholder="몽골"
              className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
            />
          </div>

          {errorMessage && (
            <div className="text-sm text-red-500">{errorMessage}</div>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-[#edf0f3] p-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-[#dfe3e8] py-3 text-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
          >
            취소
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex-1 rounded-xl bg-black py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
          >
            {saving ? "저장 중..." : "등록"}
          </button>
        </div>
      </div>
    </>
  );
}
