"use client";

import { type ReservationNote } from "@/lib/reservationNotes";
import { type AppointmentType, APPOINTMENT_TYPES } from "@/lib/reservations";
import { EditField } from "@/components/timeline/EditField";
import { NoteCard } from "@/components/timeline/NoteCard";

type DetailForm = {
  name: string;
  birthInput: string;
  phone: string;
  nationality: string;
  consultArea: string;
  reservationDate: string;
  reservationTime: string;
  hospital: string;
  appointmentType: AppointmentType;
  completed: boolean;
  coordinators: string;
  depositAmount: string;
};

type BirthPreview = {
  birthDisplay: string;
  ageText: string;
  gender: string;
};

type Props = {
  detailForm: DetailForm;
  birthPreview: BirthPreview;
  detailError: string;
  detailMessage: string;
  detailSaving: boolean;
  memoText: string;
  memoError?: string;
  memoSuccess?: string;
  recentNotes: ReservationNote[];
  onFormChange: (updates: Partial<DetailForm>) => void;
  onSave: () => void;
  onMemoTextChange: (text: string) => void;
  onAddMemo: () => void;
  onUpdateNote: (note: ReservationNote, text: string) => Promise<void>;
  onDeleteNote: (note: ReservationNote) => Promise<void>;
  onShowAllNotes: () => void;
};

const TYPE_COLORS: Record<string, string> = {
  상담: "#2563eb", 수술: "#ef4444", 치료: "#16a34a", 경과: "#f59e0b",
};

export function InfoTab({
  detailForm,
  birthPreview,
  detailError,
  detailMessage,
  detailSaving,
  memoText,
  memoError,
  memoSuccess,
  recentNotes,
  onFormChange,
  onSave,
  onMemoTextChange,
  onAddMemo,
  onUpdateNote,
  onDeleteNote,
  onShowAllNotes,
}: Props) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <EditField
          label="이름"
          value={detailForm.name}
          onChange={(value) => onFormChange({ name: value })}
        />

        <div>
          <label className="text-xs text-gray-500">생년월일</label>
          <input
            value={detailForm.birthInput}
            onChange={(e) => onFormChange({ birthInput: e.target.value })}
            className="mt-1 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
            placeholder="891210-1 / 19891210-1"
          />
          {detailForm.birthInput && (
            <div className="mt-1 text-xs text-gray-500">
              {birthPreview.birthDisplay}
              {birthPreview.ageText ? ` · ${birthPreview.ageText}` : ""}
              {birthPreview.gender ? ` · ${birthPreview.gender}` : ""}
            </div>
          )}
        </div>

        <EditField
          label="연락처"
          value={detailForm.phone}
          onChange={(value) => onFormChange({ phone: value })}
        />

        <EditField
          label="국적"
          value={detailForm.nationality}
          onChange={(value) => onFormChange({ nationality: value })}
        />
      </div>

      <div className="mt-3">
        <EditField
          label="병원명"
          value={detailForm.hospital}
          onChange={(value) => onFormChange({ hospital: value })}
        />
      </div>

      <div className="mt-3">
        <label className="text-xs text-gray-500">예약 유형</label>
        <div className="mt-2 flex gap-2 flex-wrap">
          {APPOINTMENT_TYPES.map((type) => {
            const active = detailForm.appointmentType === type;
            return (
              <button
                key={type}
                onClick={() => onFormChange({ appointmentType: type })}
                className="rounded-xl border px-3 py-1.5 text-sm font-semibold transition hover:-translate-y-0.5 active:scale-95"
                style={{
                  backgroundColor: active ? TYPE_COLORS[type] : "#f9fafb",
                  color: active ? "#fff" : "#374151",
                  borderColor: active ? TYPE_COLORS[type] : "#dfe3e8",
                }}
              >
                {type}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        <EditField
          label="상담부위"
          value={detailForm.consultArea}
          onChange={(value) => onFormChange({ consultArea: value })}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className="text-xs text-gray-500">예약날짜</label>
          <input
            type="date"
            value={detailForm.reservationDate}
            onChange={(e) => onFormChange({ reservationDate: e.target.value })}
            className="mt-1 min-w-0 w-full appearance-none rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
          />
        </div>

        <div className="min-w-0">
          <label className="text-xs text-gray-500">예약시간</label>
          <input
            type="time"
            step={1800}
            value={detailForm.reservationTime}
            onChange={(e) => onFormChange({ reservationTime: e.target.value })}
            className="mt-1 min-w-0 w-full appearance-none rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-3">
        <EditField
          label="담당자"
          value={detailForm.coordinators}
          onChange={(value) => onFormChange({ coordinators: value })}
        />
      </div>

      <div className="mt-3">
        <EditField
          label="예약금"
          value={detailForm.depositAmount}
          onChange={(value) => onFormChange({ depositAmount: value })}
        />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => onFormChange({ completed: !detailForm.completed })}
          className={`flex h-6 w-11 items-center rounded-full transition-colors ${detailForm.completed ? "bg-emerald-500" : "bg-gray-200"}`}
        >
          <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${detailForm.completed ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
        <label className="cursor-pointer text-sm text-gray-700" onClick={() => onFormChange({ completed: !detailForm.completed })}>
          완료 처리
        </label>
      </div>

      {detailError && (
        <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{detailError}</div>
      )}
      {detailMessage && (
        <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{detailMessage}</div>
      )}

      <button
        onClick={onSave}
        disabled={detailSaving}
        className="mt-4 w-full rounded-xl bg-black py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
      >
        {detailSaving ? "저장 중..." : "수정 저장"}
      </button>

      <div className="mt-5 border-t border-[#edf0f3] pt-4">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-semibold text-gray-500">최근 메모</label>
          <button
            onClick={onShowAllNotes}
            className="text-xs text-emerald-600 transition hover:underline active:scale-95"
          >
            전체보기
          </button>
        </div>

        <textarea
          rows={2}
          value={memoText}
          onChange={(e) => onMemoTextChange(e.target.value)}
          className="w-full resize-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-emerald-500 focus:outline-none"
          placeholder="기본정보에서 바로 메모 입력"
        />

        <button
          onClick={onAddMemo}
          className="mt-2 w-full rounded-xl bg-emerald-600 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
        >
          메모 추가
        </button>

        {memoError && (
          <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{memoError}</div>
        )}
        {memoSuccess && (
          <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{memoSuccess}</div>
        )}

        <div className="mt-3 space-y-2">
          {recentNotes.length === 0 ? (
            <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-400">
              등록된 메모가 없습니다.
            </div>
          ) : (
            recentNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                compact
                onUpdate={onUpdateNote}
                onDelete={onDeleteNote}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
