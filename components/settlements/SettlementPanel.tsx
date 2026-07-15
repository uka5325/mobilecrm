
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSettlement,
  getCachedPatientSettlements,
  listPatientSettlements,
  updateSettlement,
  voidSettlement,
  type SettlementAppointment,
  type SettlementMutationInput,
  type SettlementRecord,
} from "@/lib/settlements";
import type {
  SettlementAggregate,
  SettlementCategory,
  SettlementDirection,
  SettlementPaymentMethod,
} from "@/lib/settlementMath";
import { todayString } from "@/lib/dateUtils";

const CATEGORY_LABELS: Record<SettlementCategory, string> = {
  deposit: "예약금",
  surgery_fee: "수술비 결제",
  procedure_fee: "시술비 결제",
  other: "기타 결제",
};
const METHOD_LABELS: Record<SettlementPaymentMethod, string> = {
  card: "카드",
  cash: "현금",
  bank_transfer: "계좌이체",
  foreign_card: "해외카드",
  other: "기타",
};
const EMPTY_AGGREGATE: SettlementAggregate = {
  count: 0,
  paymentCount: 0,
  refundCount: 0,
  totalPaid: 0,
  totalRefunded: 0,
  netAmount: 0,
  methodTotals: { card: 0, cash: 0, bank_transfer: 0, foreign_card: 0, other: 0 },
  cardAmount: 0,
  cashAmount: 0,
  commissionBase: 0,
  lastPaidAt: "",
};

type CurrentReservation = {
  id: string;
  reservationId: string;
  reservationDate: string;
  reservationTime?: string;
  appointmentType: string;
  hospital?: string;
  consultArea?: string;
};

type Props = {
  patientId: string;
  patientName?: string;
  currentReservation?: CurrentReservation;
  onMutated?: () => void;
};

type FormState = SettlementMutationInput;

function money(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

// 기본정보 탭 필드와 같은 40px 높이. min-w-0/max-w-full은 iOS date input의
// 고유 최소 너비가 2열 그리드를 밀어내지 않도록 모든 컨트롤에 공통 적용한다.
const FIELD_CLASS =
  "mt-1 h-10 min-w-0 max-w-full w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm text-gray-800 transition focus:border-[#1d9e75] focus:outline-none";

function categoryFor(appointment?: SettlementAppointment | CurrentReservation): SettlementCategory {
  if (appointment?.appointmentType === "수술") return "surgery_fee";
  if (appointment?.appointmentType === "시술") return "procedure_fee";
  return "deposit";
}

function defaultForm(patientId: string, current?: CurrentReservation): FormState {
  return {
    patientId,
    reservationDocId: current?.id || "",
    direction: "payment",
    category: categoryFor(current),
    amount: 0,
    paymentMethod: "card",
    paidAt: todayString(),
    memo: "",
  };
}

export function SettlementPanel({ patientId, patientName, currentReservation, onMutated }: Props) {
  const cached = getCachedPatientSettlements(patientId);
  const [settlements, setSettlements] = useState<SettlementRecord[]>(cached?.settlements ?? []);
  const [appointments, setAppointments] = useState<SettlementAppointment[]>(cached?.appointments ?? []);
  const [appointmentsLoaded, setAppointmentsLoaded] = useState(cached?.appointmentsLoaded ?? false);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [aggregate, setAggregate] = useState<SettlementAggregate>(cached?.aggregate ?? EMPTY_AGGREGATE);
  const [form, setForm] = useState<FormState>(() => defaultForm(patientId, currentReservation));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cached);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!getCachedPatientSettlements(patientId)) setLoading(true);
    setError("");
    try {
      const result = await listPatientSettlements(patientId, { includeAppointments: false });
      setSettlements(result.settlements);
      setAppointments(result.appointments);
      setAppointmentsLoaded(result.appointmentsLoaded);
      setAggregate(result.aggregate);
      setForm((prev) => ({
        ...prev,
        patientId,
        reservationDocId: prev.reservationDocId || currentReservation?.id || "",
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "정산 내역을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [patientId, currentReservation?.id]);

  useEffect(() => {
    setForm(defaultForm(patientId, currentReservation));
    setEditingId(null);
    void load();
  }, [patientId, currentReservation, load]);

  const selectedAppointment = useMemo(
    () => {
      const fromList = appointments.find((appointment) => appointment.id === form.reservationDocId);
      if (fromList) return fromList;
      if (currentReservation?.id === form.reservationDocId) return currentReservation;
      return undefined;
    },
    [appointments, currentReservation, form.reservationDocId]
  );

  async function ensureAppointmentsLoaded() {
    if (appointmentsLoaded || appointmentsLoading) return;
    setAppointmentsLoading(true);
    setError("");
    try {
      const result = await listPatientSettlements(patientId, { includeAppointments: true });
      setSettlements(result.settlements);
      setAppointments(result.appointments);
      setAppointmentsLoaded(result.appointmentsLoaded);
      setAggregate(result.aggregate);
      setForm((prev) => ({
        ...prev,
        reservationDocId: prev.reservationDocId || currentReservation?.id || result.appointments[0]?.id || "",
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결 일정을 불러오지 못했습니다.");
    } finally {
      setAppointmentsLoading(false);
    }
  }
  function resetForm() {
    setEditingId(null);
    setForm(defaultForm(patientId, currentReservation || appointments[0]));
  }

  function beginEdit(row: SettlementRecord) {
    setEditingId(row.id);
    setForm({
      patientId: row.patientId,
      reservationDocId: row.reservationDocId,
      direction: row.direction,
      category: row.category,
      amount: row.amount,
      paymentMethod: row.paymentMethod,
      paidAt: row.paidAt,
      memo: row.memo,
    });
    setMessage("");
    setError("");
  }

  async function save() {
    if (!form.reservationDocId) { setError("연결할 일정을 선택하세요."); return; }
    if (!Number.isFinite(Number(form.amount)) || Number(form.amount) <= 0) {
      setError("이번에 실제로 결제하거나 환불한 금액을 입력하세요.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    const payload = { ...form, amount: Math.round(Number(form.amount)) };
    try {
      const result = editingId
        ? await updateSettlement(editingId, payload)
        : await createSettlement(payload);
      if (!result.success) { setError(result.message || "정산 저장에 실패했습니다."); return; }
      setMessage(editingId ? "정산 내역을 수정했습니다." : "실제 결제 내역을 등록했습니다.");
      resetForm();
      const refreshed = await listPatientSettlements(patientId, { includeAppointments: false });
      setSettlements(refreshed.settlements);
      setAggregate(refreshed.aggregate);
      onMutated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "정산 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function voidRow(row: SettlementRecord) {
    const reason = window.prompt("무효 처리 사유를 입력하세요.", "오입력 정정");
    if (reason === null) return;
    setSaving(true);
    setError("");
    try {
      const result = await voidSettlement(row.id, reason);
      if (!result.success) { setError(result.message || "무효 처리에 실패했습니다."); return; }
      setMessage("정산 기록을 무효 처리했습니다.");
      if (editingId === row.id) resetForm();
      const refreshed = await listPatientSettlements(patientId, { includeAppointments: false });
      setSettlements(refreshed.settlements);
      setAggregate(refreshed.aggregate);
      onMutated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "무효 처리 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-bold text-gray-900">{patientName ? `${patientName} 정산` : "정산"}</div>
        <div className="mt-1 text-xs leading-5 text-gray-500">
          청구액이 아니라 이번에 실제로 받은 금액 또는 환불한 금액만 기록합니다. 정산 변경 시 연결된 모든 상태의 인보이스와 커미션이 자동 재계산됩니다.
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-emerald-50 p-3">
          <div className="text-[11px] text-emerald-700">순 실결제액</div>
          <div className="mt-1 text-sm font-bold text-emerald-800">{money(aggregate.netAmount)}</div>
        </div>
        <div className="rounded-xl bg-blue-50 p-3">
          <div className="text-[11px] text-blue-700">누적 결제</div>
          <div className="mt-1 text-sm font-bold text-blue-800">{money(aggregate.totalPaid)}</div>
        </div>
        <div className="rounded-xl bg-red-50 p-3">
          <div className="text-[11px] text-red-700">누적 환불</div>
          <div className="mt-1 text-sm font-bold text-red-800">{money(aggregate.totalRefunded)}</div>
        </div>
      </div>

      {aggregate.count === 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
          실제 결제·환불 내역만 정산에 등록해 주세요. 청구금액이나 견적금액은 필요한 경우 메모에 기록할 수 있습니다.
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 p-4">
        <div className="mb-3 text-sm font-semibold">{editingId ? "정산 수정" : "정산 등록"}</div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500">연결 일정</label>
            <select
              value={form.reservationDocId}
              onFocus={() => void ensureAppointmentsLoaded()}
              onMouseDown={() => void ensureAppointmentsLoaded()}
              onChange={(e) => {
                const appointment = appointments.find((item) => item.id === e.target.value)
                  || (currentReservation?.id === e.target.value ? currentReservation : undefined);
                setForm((prev) => ({ ...prev, reservationDocId: e.target.value, category: categoryFor(appointment) }));
              }}
              className={FIELD_CLASS}
            >
              <option value="">{appointmentsLoading ? "일정 불러오는 중..." : "일정 선택"}</option>
              {currentReservation && !appointments.some((appointment) => appointment.id === currentReservation.id) && (
                <option value={currentReservation.id}>
                  {currentReservation.reservationDate} · {currentReservation.appointmentType} · {currentReservation.hospital || "병원 미지정"} · {currentReservation.consultArea || "항목 미지정"}
                </option>
              )}
              {appointments.map((appointment) => (
                <option key={appointment.id} value={appointment.id}>
                  {appointment.reservationDate} · {appointment.appointmentType} · {appointment.hospital || "병원 미지정"} · {appointment.consultArea || "항목 미지정"}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <label className="text-xs text-gray-500">구분</label>
              <select
                value={form.direction}
                onChange={(e) => setForm((prev) => ({ ...prev, direction: e.target.value as SettlementDirection }))}
                className={FIELD_CLASS}
              >
                <option value="payment">결제</option>
                <option value="refund">환불</option>
              </select>
            </div>
            <div className="min-w-0">
              <label className="text-xs text-gray-500">항목</label>
              <select
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value as SettlementCategory }))}
                className={FIELD_CLASS}
              >
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <label className="text-xs text-gray-500">실제 금액</label>
              <input
                type="number"
                min={1}
                value={form.amount || ""}
                onChange={(e) => setForm((prev) => ({ ...prev, amount: Number(e.target.value) }))}
                placeholder="이번 결제액"
                className={FIELD_CLASS}
              />
            </div>
            <div className="min-w-0">
              <label className="text-xs text-gray-500">결제 방법</label>
              <select
                value={form.paymentMethod}
                onChange={(e) => setForm((prev) => ({ ...prev, paymentMethod: e.target.value as SettlementPaymentMethod }))}
                className={FIELD_CLASS}
              >
                {Object.entries(METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] gap-2">
            <div className="min-w-0">
              <label className="text-xs text-gray-500">결제·환불일</label>
              <input
                type="date"
                value={form.paidAt}
                onChange={(e) => setForm((prev) => ({ ...prev, paidAt: e.target.value }))}
                className={`${FIELD_CLASS} appearance-none`}
              />
            </div>
            <div className="min-w-0">
              <label className="text-xs text-gray-500">선택 일정</label>
              <div className="mt-1 flex h-10 min-w-0 items-center truncate rounded-xl bg-gray-50 px-3 text-xs text-gray-500">
                {selectedAppointment ? `${selectedAppointment.appointmentType} · ${selectedAppointment.consultArea || "항목 미지정"}` : "—"}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">메모</label>
            <input
              value={form.memo || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, memo: e.target.value }))}
              placeholder="예: 1차 예약금, 잔금 결제"
              className={FIELD_CLASS}
            />
          </div>

          <div className="flex gap-2">
            {editingId && (
              <button onClick={resetForm} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-600">취소</button>
            )}
            <button
              onClick={save}
              disabled={saving || loading}
              className="flex-1 rounded-xl bg-black py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "저장 중..." : editingId ? "수정 저장" : "정산 추가"}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {message && <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">정산 내역</div>
          <div className="text-xs text-gray-400">활성 {aggregate.count}건</div>
        </div>
        {loading ? (
          <div className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-400">불러오는 중...</div>
        ) : settlements.length === 0 ? (
          <div className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-400">등록된 정산이 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {settlements.map((row) => (
              <div key={row.id} className={`rounded-xl border p-3 ${row.status === "void" ? "border-gray-200 bg-gray-50 opacity-60" : "border-gray-200 bg-white"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${row.direction === "refund" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                        {row.direction === "refund" ? "환불" : "결제"}
                      </span>
                      <span className="font-semibold text-gray-800">{CATEGORY_LABELS[row.category]}</span>
                      {row.status === "void" && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-gray-600">무효</span>}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {row.paidAt} · {row.appointmentType} · {row.hospital || "병원 미지정"} · {METHOD_LABELS[row.paymentMethod]}
                    </div>
                    {row.consultArea && <div className="mt-0.5 truncate text-xs text-gray-400">{row.consultArea}</div>}
                    {row.memo && <div className="mt-1 text-xs text-gray-600">{row.memo}</div>}
                    {row.voidReason && <div className="mt-1 text-xs text-red-500">무효 사유: {row.voidReason}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`text-sm font-bold ${row.direction === "refund" ? "text-red-600" : "text-gray-900"}`}>
                      {row.direction === "refund" ? "-" : "+"}{money(row.amount)}
                    </div>
                    {row.status === "active" && (
                      <div className="mt-2 flex justify-end gap-2">
                        <button onClick={() => beginEdit(row)} disabled={saving} className="text-xs text-blue-600 hover:underline">수정</button>
                        <button onClick={() => void voidRow(row)} disabled={saving} className="text-xs text-red-500 hover:underline">무효</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
