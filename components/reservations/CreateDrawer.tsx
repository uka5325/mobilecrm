"use client";

import { useEffect, useMemo, useState } from "react";
import { createReservation, type DoctorOption } from "@/lib/reservations";
import { parseBirthInfo } from "@/lib/reservationUtils";
import type { StaffUser } from "@/lib/auth";
import { todayString } from "@/lib/dateUtils";

type Props = {
  open: boolean;
  onClose: () => void;
  doctors: DoctorOption[];
  currentUser: StaffUser;
  initialDate?: string;
};

const EMPTY_FORM = (date: string) => ({
  name: "",
  birthInput: "",
  phone: "",
  nationality: "",
  consultArea: "",
  reservationDate: date,
  reservationTime: "",
  coordinators: "",
  depositAmount: "",
});

export function CreateDrawer({ open, onClose, doctors, currentUser, initialDate }: Props) {
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedDoctors, setSelectedDoctors] = useState<string[]>([]);
  const [form, setForm] = useState(EMPTY_FORM(initialDate || todayString()));

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM(initialDate || todayString()));
      setSelectedDoctors([]);
      setErrorMessage("");
      setSaving(false);
    }
  }, [open, initialDate]);

  const birthPreview = useMemo(() => parseBirthInfo(form.birthInput), [form.birthInput]);

  function toggleDoctor(name: string) {
    setSelectedDoctors((prev) =>
      prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]
    );
  }

  async function handleCreate() {
    if (!form.name.trim()) { setErrorMessage("이름을 입력하세요."); return; }
    if (!form.reservationDate) { setErrorMessage("예약날짜를 선택하세요."); return; }
    if (!selectedDoctors.length) { setErrorMessage("지정원장을 선택하세요."); return; }

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
          doctors: selectedDoctors,
          coordinators: form.coordinators.split(",").map((s) => s.trim()).filter(Boolean),
          depositAmount: form.depositAmount,
        },
        currentUser
      );

      if (!result.success) {
        setErrorMessage(result.message || "예약 등록에 실패했습니다.");
        return;
      }

      onClose();
    } catch {
      setErrorMessage("예약 등록 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[998] bg-black/35" onClick={onClose} />

      <div className="fixed right-0 top-0 z-[1001] flex h-[100dvh] w-[390px] max-w-[calc(100vw-12px)] flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
        <div className="flex shrink-0 items-center justify-between border-b border-[#edf0f3] px-6 py-5">
          <div>
            <div className="text-xl font-bold">신규 예약 등록</div>
            <div className="mt-1 text-sm text-gray-500">단일 예약 추가</div>
          </div>
          <button onClick={onClose} className="text-2xl text-gray-400 transition hover:scale-110 hover:text-gray-700 active:scale-95">×</button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-6">
          <div className="grid grid-cols-2 gap-3">
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
          </div>

          <div>
            <label className="text-xs text-gray-500">상담부위</label>
            <input
              value={form.consultArea}
              onChange={(e) => setForm((p) => ({ ...p, consultArea: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">예약날짜 *</label>
              <input
                type="date"
                value={form.reservationDate}
                onChange={(e) => setForm((p) => ({ ...p, reservationDate: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-2 py-1.5 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">예약시간</label>
              <input
                type="time"
                value={form.reservationTime}
                onChange={(e) => setForm((p) => ({ ...p, reservationTime: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-2 py-1.5 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">지정원장 *</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {doctors.length === 0 ? (
                <p className="text-sm text-gray-400">등록된 원장이 없습니다.</p>
              ) : (
                doctors.map((doctor) => {
                  const on = selectedDoctors.includes(doctor.displayName);
                  return (
                    <button
                      key={doctor.uid}
                      onClick={() => toggleDoctor(doctor.displayName)}
                      className={`rounded-xl border px-3 py-2 text-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
                        on ? "border-black bg-black text-white" : "border-[#dfe3e8] bg-white text-gray-700"
                      }`}
                    >
                      {doctor.displayName}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">담당 실장</label>
            <input
              value={form.coordinators}
              onChange={(e) => setForm((p) => ({ ...p, coordinators: e.target.value }))}
              placeholder="쉼표로 구분"
              className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500">예약금</label>
            <input
              value={form.depositAmount}
              onChange={(e) => setForm((p) => ({ ...p, depositAmount: e.target.value }))}
              placeholder="100,000원 / 10,000엔"
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
            {saving ? "저장 중..." : "예약 등록"}
          </button>
        </div>
      </div>
    </>
  );
}
