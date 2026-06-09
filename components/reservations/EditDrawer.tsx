"use client";

import { useEffect, useMemo, useState } from "react";
import { updateReservationFull, type DoctorOption, type ReservationRecord } from "@/lib/reservations";
import { parseBirthInfo } from "@/lib/reservationUtils";
import type { StaffUser } from "@/lib/auth";
import { todayString } from "@/lib/dateUtils";

type Props = {
  open: boolean;
  onClose: () => void;
  reservation: ReservationRecord | null;
  doctors: DoctorOption[];
  currentUser: StaffUser;
};

export function EditDrawer({ open, onClose, reservation, doctors, currentUser }: Props) {
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [doctorsInput, setDoctorsInput] = useState("");
  const [form, setForm] = useState({
    name: "",
    birthInput: "",
    phone: "",
    nationality: "",
    consultArea: "",
    reservationDate: todayString(),
    reservationTime: "",
    coordinators: "",
    depositAmount: "",
  });

  useEffect(() => {
    if (open && reservation) {
      setForm({
        name: reservation.name || "",
        birthInput: reservation.birthInput || reservation.birth || "",
        phone: reservation.phone || "",
        nationality: reservation.nationality || "",
        consultArea: reservation.consultArea || "",
        reservationDate: reservation.reservationDate || todayString(),
        reservationTime: reservation.reservationTime || "",
        coordinators: reservation.coordinators.join(", "),
        depositAmount: reservation.depositAmount || "",
      });
      setDoctorsInput((reservation.doctors || []).join(", "));
      setErrorMessage("");
      setSaving(false);
    }
  }, [open, reservation]);

  const birthPreview = useMemo(() => parseBirthInfo(form.birthInput), [form.birthInput]);

  const parsedDoctors = doctorsInput.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);

  async function handleUpdate() {
    if (!reservation) return;
    if (!form.name.trim()) { setErrorMessage("이름을 입력하세요."); return; }
    if (!form.reservationDate) { setErrorMessage("예약날짜를 선택하세요."); return; }
    if (!parsedDoctors.length) { setErrorMessage("지정원장을 입력하세요."); return; }

    setSaving(true);
    setErrorMessage("");

    try {
      const result = await updateReservationFull(
        reservation.id,
        reservation.reservationId,
        reservation.patientId,
        {
          name: form.name,
          birthInput: form.birthInput,
          birth: form.birthInput,
          phone: form.phone,
          nationality: form.nationality,
          consultArea: form.consultArea,
          reservationDate: form.reservationDate,
          reservationTime: form.reservationTime,
          doctors: parsedDoctors,
          coordinators: form.coordinators.split(",").map((s) => s.trim()).filter(Boolean),
          depositAmount: form.depositAmount,
        },
        currentUser
      );

      if (!result.success) {
        setErrorMessage(result.message || "예약 수정에 실패했습니다.");
        return;
      }

      onClose();
    } catch {
      setErrorMessage("예약 수정 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!open || !reservation) return null;

  return (
    <>
      <div className="fixed inset-0 z-[998] bg-black/35" onClick={onClose} />

      <div className="fixed right-0 top-0 z-[999] flex h-screen w-[440px] max-w-full flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
        <div className="flex items-center justify-between border-b px-6 py-5">
          <div>
            <div className="text-xl font-bold">예약 정보 수정</div>
            <div className="mt-1 text-sm text-gray-500">{reservation.name} 님 예약 수정</div>
          </div>
          <button onClick={onClose} className="text-2xl text-gray-400">×</button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-6">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">이름 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500">생년월일</label>
              <input
                value={form.birthInput}
                onChange={(e) => setForm((p) => ({ ...p, birthInput: e.target.value }))}
                placeholder="891210-1 / 19891210-1"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
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
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500">국적</label>
              <input
                value={form.nationality}
                onChange={(e) => setForm((p) => ({ ...p, nationality: e.target.value }))}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">상담부위</label>
            <input
              value={form.consultArea}
              onChange={(e) => setForm((p) => ({ ...p, consultArea: e.target.value }))}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="text-xs text-gray-500">예약날짜 *</label>
              <input
                type="date"
                value={form.reservationDate}
                onChange={(e) => setForm((p) => ({ ...p, reservationDate: e.target.value }))}
                className="mt-1 min-w-0 w-full appearance-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
            </div>

            <div className="min-w-0">
              <label className="text-xs text-gray-500">예약시간</label>
              <input
                type="time"
                value={form.reservationTime}
                onChange={(e) => setForm((p) => ({ ...p, reservationTime: e.target.value }))}
                className="mt-1 min-w-0 w-full appearance-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">지정원장 * (쉼표로 2명 구분 가능)</label>
            <input
              value={doctorsInput}
              onChange={(e) => setDoctorsInput(e.target.value)}
              placeholder="예: 홍길동 / 홍길동, 김철수"
              className="mt-1 h-10 w-full rounded-xl border border-[#dfe3e8] px-3 text-sm outline-none transition focus:border-black"
            />
            {doctors.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {doctors.map((d) => (
                  <button
                    key={d.uid}
                    type="button"
                    onClick={() => {
                      const names = doctorsInput.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
                      if (!names.includes(d.displayName)) {
                        setDoctorsInput(names.concat(d.displayName).join(", "));
                      }
                    }}
                    className="rounded-lg border border-[#dfe3e8] px-2.5 py-1 text-xs text-gray-600 transition hover:-translate-y-0.5 active:scale-95"
                  >
                    {d.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-gray-500">담당 실장</label>
            <input
              value={form.coordinators}
              onChange={(e) => setForm((p) => ({ ...p, coordinators: e.target.value }))}
              placeholder="쉼표로 구분"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500">예약금</label>
            <input
              value={form.depositAmount}
              onChange={(e) => setForm((p) => ({ ...p, depositAmount: e.target.value }))}
              placeholder="100,000원 / 10,000엔"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
          </div>

          {errorMessage && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t p-4">
          <button onClick={onClose} className="flex-1 rounded-xl border py-3 text-sm">
            취소
          </button>
          <button
            onClick={handleUpdate}
            disabled={saving}
            className="flex-1 rounded-xl bg-black py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "저장 중..." : "수정 저장"}
          </button>
        </div>
      </div>
    </>
  );
}
