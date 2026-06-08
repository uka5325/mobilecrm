"use client";

import { useEffect, useMemo, useState } from "react";
import { createReservation, type DoctorOption } from "@/lib/reservations";
import { parseBirthInfo } from "@/lib/reservationUtils";
import { splitComma } from "@/lib/timelineUtils";
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

export function NewReservationDrawer({ open, onClose, doctors, currentUser, initialDate }: Props) {
  const [saving, setSaving] = useState(false);
  const [newError, setNewError] = useState("");
  const [newDoctors, setNewDoctors] = useState<string[]>([]);
  const [newForm, setNewForm] = useState(EMPTY_FORM(initialDate || todayString()));

  useEffect(() => {
    if (open) {
      setNewForm(EMPTY_FORM(initialDate || todayString()));
      setNewDoctors([]);
      setNewError("");
      setSaving(false);
    }
  }, [open, initialDate]);

  const birthPreview = useMemo(() => parseBirthInfo(newForm.birthInput), [newForm.birthInput]);

  function toggleDoctor(name: string) {
    setNewDoctors((prev) =>
      prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]
    );
  }

  async function handleCreate() {
    if (!newForm.name.trim()) { setNewError("이름을 입력하세요."); return; }
    if (!newForm.reservationDate) { setNewError("예약날짜를 선택하세요."); return; }
    if (!newDoctors.length) { setNewError("지정원장을 선택하세요."); return; }

    setSaving(true);
    setNewError("");

    try {
      const result = await createReservation(
        {
          name: newForm.name,
          birthInput: newForm.birthInput,
          birth: newForm.birthInput,
          phone: newForm.phone,
          nationality: newForm.nationality,
          consultArea: newForm.consultArea,
          reservationDate: newForm.reservationDate,
          reservationTime: newForm.reservationTime,
          doctors: newDoctors,
          coordinators: splitComma(newForm.coordinators),
          depositAmount: newForm.depositAmount,
        },
        currentUser
      );

      if (!result.success) {
        setNewError(result.message || "예약 등록에 실패했습니다.");
        return;
      }

      onClose();
    } catch {
      setNewError("예약 등록 중 오류가 발생했습니다.");
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
          <button
            onClick={onClose}
            className="text-2xl text-gray-400 transition hover:scale-110 hover:text-gray-700 active:scale-95"
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-6">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">이름 *</label>
              <input
                value={newForm.name}
                onChange={(e) => setNewForm((p) => ({ ...p, name: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500">생년월일</label>
              <input
                value={newForm.birthInput}
                onChange={(e) => setNewForm((p) => ({ ...p, birthInput: e.target.value }))}
                placeholder="900101-1"
                className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
              {newForm.birthInput && (
                <div className="mt-1 text-xs text-gray-500">
                  {birthPreview.birthDisplay}
                  {birthPreview.ageText ? ` · ${birthPreview.ageText}` : ""}
                  {birthPreview.gender ? ` · ${birthPreview.gender}` : ""}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-gray-500">연락처</label>
              <input
                value={newForm.phone}
                onChange={(e) => setNewForm((p) => ({ ...p, phone: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500">국적</label>
              <input
                value={newForm.nationality}
                onChange={(e) => setNewForm((p) => ({ ...p, nationality: e.target.value }))}
                placeholder="몽골"
                className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">상담부위</label>
            <input
              value={newForm.consultArea}
              onChange={(e) => setNewForm((p) => ({ ...p, consultArea: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-[3fr_2fr] gap-3">
            <div>
              <label className="text-xs text-gray-500">예약날짜 *</label>
              <input
                type="date"
                value={newForm.reservationDate}
                onChange={(e) => setNewForm((p) => ({ ...p, reservationDate: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">예약시간</label>
              <input
                type="time"
                step={1800}
                value={newForm.reservationTime}
                onChange={(e) => setNewForm((p) => ({ ...p, reservationTime: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-2 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">지정원장 *</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {doctors.map((doctor) => {
                const on = newDoctors.includes(doctor.displayName);
                return (
                  <button
                    key={doctor.uid}
                    onClick={() => toggleDoctor(doctor.displayName)}
                    className={`rounded-xl border px-3 py-2 text-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
                      on
                        ? "border-black bg-black text-white"
                        : "border-[#dfe3e8] bg-white text-gray-700"
                    }`}
                  >
                    {doctor.displayName}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">담당 실장</label>
            <input
              value={newForm.coordinators}
              onChange={(e) => setNewForm((p) => ({ ...p, coordinators: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500">예약금</label>
            <input
              value={newForm.depositAmount}
              onChange={(e) => setNewForm((p) => ({ ...p, depositAmount: e.target.value }))}
              placeholder="100,000원 / 10,000엔"
              className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
            />
          </div>

          {newError && <div className="text-sm text-red-500">{newError}</div>}
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
