"use client";

import { useEffect, useMemo, useState } from "react";
import { createPatientOnly, createReservation, type AppointmentType } from "@/lib/reservations";
import { parseBirthInfo } from "@/lib/reservationUtils";
import type { StaffUser } from "@/lib/auth";
import { todayString } from "@/lib/dateUtils";

const APPOINTMENT_TYPES: AppointmentType[] = ["상담", "수술", "치료", "경과", "진료", "검진"];

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
  mode?: "register" | "reservation";
};

const REGISTER_FORM = (patient?: InitialPatient) => ({
  name: patient?.name || "",
  birthInput: patient?.birthInput || "",
  phone: patient?.phone || "",
  nationality: patient?.nationality || "",
});

const RESERVATION_FORM = (date: string, patient?: InitialPatient) => ({
  name: patient?.name || "",
  birthInput: patient?.birthInput || "",
  phone: patient?.phone || "",
  nationality: patient?.nationality || "",
  reservationDate: date,
  reservationTime: "",
  hospital: patient?.hospital || "",
  appointmentType: (patient?.appointmentType || "상담") as AppointmentType,
  consultArea: patient?.consultArea || "",
  coordinators: patient?.coordinators || "",
  doctors: patient?.doctors || "",
  depositAmount: patient?.depositAmount || "",
  surgeryCost: patient?.surgeryCost || "",
});

export function CreateDrawer({ open, onClose, currentUser, initialDate, initialPatient, onCreated, mode = "register" }: Props) {
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [regForm, setRegForm] = useState(REGISTER_FORM(initialPatient));
  const [resForm, setResForm] = useState(RESERVATION_FORM(initialDate || todayString(), initialPatient));

  useEffect(() => {
    if (open) {
      setRegForm(REGISTER_FORM(initialPatient));
      setResForm(RESERVATION_FORM(initialDate || todayString(), initialPatient));
      setErrorMessage("");
      setSaving(false);
    }
  }, [open, initialDate, initialPatient]);

  const birthPreview = useMemo(() => parseBirthInfo(mode === "register" ? regForm.birthInput : resForm.birthInput), [mode, regForm.birthInput, resForm.birthInput]);

  async function handleCreate() {
    if (mode === "register") {
      if (!regForm.name.trim()) { setErrorMessage("이름을 입력하세요."); return; }
      setSaving(true);
      setErrorMessage("");
      try {
        const result = await createPatientOnly(
          { name: regForm.name, birthInput: regForm.birthInput, phone: regForm.phone, nationality: regForm.nationality, patientId: initialPatient?.patientId },
          currentUser
        );
        if (!result.success) { setErrorMessage(result.message || "등록에 실패했습니다."); return; }
        onCreated?.();
        onClose();
      } catch {
        setErrorMessage("등록 중 오류가 발생했습니다.");
      } finally {
        setSaving(false);
      }
    } else {
      if (!resForm.name.trim()) { setErrorMessage("이름을 입력하세요."); return; }
      if (!resForm.reservationDate) { setErrorMessage("예약날짜를 입력하세요."); return; }
      setSaving(true);
      setErrorMessage("");
      try {
        const result = await createReservation(
          {
            name: resForm.name,
            birthInput: resForm.birthInput,
            birth: resForm.birthInput,
            phone: resForm.phone,
            nationality: resForm.nationality,
            consultArea: resForm.consultArea,
            reservationDate: resForm.reservationDate,
            reservationTime: resForm.reservationTime,
            hospital: resForm.hospital,
            doctors: resForm.doctors ? resForm.doctors.split(",").map((s) => s.trim()).filter(Boolean) : [],
            appointmentType: resForm.appointmentType,
            coordinators: resForm.coordinators ? resForm.coordinators.split(",").map((s) => s.trim()).filter(Boolean) : [],
            depositAmount: resForm.depositAmount,
            surgeryCost: resForm.surgeryCost,
            patientId: initialPatient?.patientId,
          },
          currentUser
        );
        if (!result.success) { setErrorMessage(result.message || "등록에 실패했습니다."); return; }
        onCreated?.();
        onClose();
      } catch {
        setErrorMessage("등록 중 오류가 발생했습니다.");
      } finally {
        setSaving(false);
      }
    }
  }

  if (!open) return null;

  const isReservation = mode === "reservation";

  return (
    <>
      <div className="fixed inset-0 z-[998] bg-black/35" onClick={onClose} />

      <div className="fixed right-0 top-0 z-[1001] flex h-[100dvh] w-[420px] max-w-[calc(100vw-12px)] flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
        <div className="flex shrink-0 items-center justify-between border-b border-[#edf0f3] px-6 py-5">
          <div>
            <div className="text-xl font-bold">
              {isReservation ? `${initialPatient?.name || ""} 추가 예약` : "고객 등록"}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              {isReservation ? "예약 정보를 입력하세요" : "새 고객 기본 정보를 입력하세요"}
            </div>
          </div>
          <button onClick={onClose} className="text-2xl text-gray-400 transition hover:scale-110 hover:text-gray-700 active:scale-95">×</button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-6">
          {/* 이름 + 생년월일 */}
          <div className={isReservation ? "grid grid-cols-2 gap-3" : ""}>
            <div>
              <label className="text-xs text-gray-500">이름 *</label>
              <input
                value={isReservation ? resForm.name : regForm.name}
                onChange={(e) => isReservation
                  ? setResForm((p) => ({ ...p, name: e.target.value }))
                  : setRegForm((p) => ({ ...p, name: e.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">생년월일</label>
              <input
                value={isReservation ? resForm.birthInput : regForm.birthInput}
                onChange={(e) => isReservation
                  ? setResForm((p) => ({ ...p, birthInput: e.target.value }))
                  : setRegForm((p) => ({ ...p, birthInput: e.target.value }))
                }
                placeholder="891210-1 / 19891210-1"
                className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
              {(isReservation ? resForm.birthInput : regForm.birthInput) && (
                <div className="mt-1 text-xs text-gray-500">
                  {birthPreview.birthDisplay && <span>{birthPreview.birthDisplay}</span>}
                  {birthPreview.ageText && <span> · {birthPreview.ageText}</span>}
                  {birthPreview.gender && <span> · {birthPreview.gender}</span>}
                </div>
              )}
            </div>
          </div>

          {/* 연락처 + 국적 */}
          <div className={isReservation ? "grid grid-cols-2 gap-3" : ""}>
            <div>
              <label className="text-xs text-gray-500">연락처</label>
              <input
                value={isReservation ? resForm.phone : regForm.phone}
                onChange={(e) => isReservation
                  ? setResForm((p) => ({ ...p, phone: e.target.value }))
                  : setRegForm((p) => ({ ...p, phone: e.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">국적</label>
              <input
                value={isReservation ? resForm.nationality : regForm.nationality}
                onChange={(e) => isReservation
                  ? setResForm((p) => ({ ...p, nationality: e.target.value }))
                  : setRegForm((p) => ({ ...p, nationality: e.target.value }))
                }
                placeholder="몽골"
                className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
          </div>

          {/* 예약 전용 필드 */}
          {isReservation && (
            <>
              {/* 예약날짜 + 예약시간 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="text-xs text-gray-500">예약날짜 *</label>
                  <input
                    type="date"
                    value={resForm.reservationDate}
                    onChange={(e) => setResForm((p) => ({ ...p, reservationDate: e.target.value }))}
                    className="mt-1 min-w-0 w-full appearance-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">예약시간</label>
                  <input
                    value={resForm.reservationTime}
                    onChange={(e) => setResForm((p) => ({ ...p, reservationTime: e.target.value }))}
                    placeholder="10:00"
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>
              </div>

              {/* 병원명 + 담당원장 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">병원명</label>
                  <input
                    value={resForm.hospital}
                    onChange={(e) => setResForm((p) => ({ ...p, hospital: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">담당원장 (쉼표 구분)</label>
                  <input
                    value={resForm.doctors}
                    onChange={(e) => setResForm((p) => ({ ...p, doctors: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>
              </div>

              {/* 예약유형 + 상담/수술부위 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">예약유형</label>
                  <select
                    value={resForm.appointmentType}
                    onChange={(e) => setResForm((p) => ({ ...p, appointmentType: e.target.value as AppointmentType }))}
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  >
                    {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">
                    {resForm.appointmentType === "상담" ? "상담부위" : "수술항목"}
                  </label>
                  <input
                    value={resForm.consultArea}
                    onChange={(e) => setResForm((p) => ({ ...p, consultArea: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>
              </div>

              {/* 담당자 */}
              <div>
                <label className="text-xs text-gray-500">담당자 (쉼표 구분)</label>
                <input
                  value={resForm.coordinators}
                  onChange={(e) => setResForm((p) => ({ ...p, coordinators: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                />
              </div>

              {/* 예약금 + 수술비용 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">예약금</label>
                  <input
                    value={resForm.depositAmount}
                    onChange={(e) => setResForm((p) => ({ ...p, depositAmount: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">수술비용</label>
                  <input
                    value={resForm.surgeryCost}
                    onChange={(e) => setResForm((p) => ({ ...p, surgeryCost: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>
              </div>
            </>
          )}

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
            {saving ? "저장 중..." : isReservation ? "예약 등록" : "등록"}
          </button>
        </div>
      </div>
    </>
  );
}
