from pathlib import Path
import re

ROOT = Path('.')


def write(path: str, content: str) -> None:
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f"{path}: expected {count} exact matches, found {actual}: {old[:100]!r}")
    p.write_text(text.replace(old, new, count), encoding="utf-8")


def regex_replace(path: str, pattern: str, repl: str, count: int = 1, flags: int = 0) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    new_text, actual = re.subn(pattern, repl, text, count=count, flags=flags)
    if actual != count:
        raise RuntimeError(f"{path}: expected {count} regex matches, found {actual}: {pattern[:120]!r}")
    p.write_text(new_text, encoding="utf-8")


write("lib/settlementMath.ts", r'''
import { calcCommissionBase, type PaymentMethod } from "./commissionUtils";

export type SettlementDirection = "payment" | "refund";
export type SettlementCategory = "deposit" | "surgery_fee" | "procedure_fee" | "other";
export type SettlementPaymentMethod = "card" | "cash" | "bank_transfer" | "foreign_card" | "other";
export type SettlementStatus = "active" | "void";

export type SettlementMathRow = {
  direction?: unknown;
  amount?: unknown;
  paymentMethod?: unknown;
  status?: unknown;
  isDeleted?: unknown;
  paidAt?: unknown;
};

export type SettlementAggregate = {
  count: number;
  paymentCount: number;
  refundCount: number;
  totalPaid: number;
  totalRefunded: number;
  netAmount: number;
  methodTotals: Record<SettlementPaymentMethod, number>;
  cardAmount: number;
  cashAmount: number;
  paymentMethod?: PaymentMethod;
  commissionBase: number;
  lastPaidAt: string;
};

const PAYMENT_METHODS = new Set<SettlementPaymentMethod>([
  "card",
  "cash",
  "bank_transfer",
  "foreign_card",
  "other",
]);

export function settlementAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(Math.abs(value)) : 0;
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(Math.abs(parsed)) : 0;
}

export function isSettlementPaymentMethod(value: unknown): value is SettlementPaymentMethod {
  return PAYMENT_METHODS.has(String(value) as SettlementPaymentMethod);
}

export function aggregateSettlementRows(rows: SettlementMathRow[]): SettlementAggregate {
  const methodTotals: Record<SettlementPaymentMethod, number> = {
    card: 0,
    cash: 0,
    bank_transfer: 0,
    foreign_card: 0,
    other: 0,
  };

  let count = 0;
  let paymentCount = 0;
  let refundCount = 0;
  let totalPaid = 0;
  let totalRefunded = 0;
  let lastPaidAt = "";

  for (const row of rows) {
    if (row.isDeleted === true || row.status === "void") continue;
    const direction = row.direction === "refund" ? "refund" : "payment";
    const amount = settlementAmount(row.amount);
    if (amount <= 0) continue;
    const method = isSettlementPaymentMethod(row.paymentMethod) ? row.paymentMethod : "other";
    const sign = direction === "refund" ? -1 : 1;

    count += 1;
    if (direction === "refund") {
      refundCount += 1;
      totalRefunded += amount;
    } else {
      paymentCount += 1;
      totalPaid += amount;
    }
    methodTotals[method] += sign * amount;
    const paidAt = String(row.paidAt || "");
    if (paidAt > lastPaidAt) lastPaidAt = paidAt;
  }

  const netAmount = totalPaid - totalRefunded;
  const cardAmount = methodTotals.card + methodTotals.foreign_card;
  const cashAmount = methodTotals.cash + methodTotals.bank_transfer + methodTotals.other;
  const hasCard = cardAmount !== 0;
  const hasCash = cashAmount !== 0;
  const paymentMethod: PaymentMethod | undefined = hasCard && hasCash
    ? "mixed"
    : hasCard
      ? "card"
      : hasCash
        ? "cash"
        : undefined;
  const commissionBase = paymentMethod
    ? Math.max(0, calcCommissionBase(netAmount, paymentMethod, cardAmount, cashAmount))
    : 0;

  return {
    count,
    paymentCount,
    refundCount,
    totalPaid,
    totalRefunded,
    netAmount,
    methodTotals,
    cardAmount,
    cashAmount,
    paymentMethod,
    commissionBase,
    lastPaidAt,
  };
}
''')

write("lib/settlements.ts", r'''
import { auth } from "./firebase";
import { cleanText } from "./stringUtils";
import type {
  SettlementAggregate,
  SettlementCategory,
  SettlementDirection,
  SettlementPaymentMethod,
  SettlementStatus,
} from "./settlementMath";

export type SettlementRecord = {
  id: string;
  patientId: string;
  reservationDocId: string;
  reservationId: string;
  appointmentDate: string;
  appointmentType: string;
  hospital: string;
  consultArea: string;
  direction: SettlementDirection;
  category: SettlementCategory;
  amount: number;
  paymentMethod: SettlementPaymentMethod;
  paidAt: string;
  memo: string;
  status: SettlementStatus;
  voidReason?: string;
  createdAt?: unknown;
  createdBy?: string;
  updatedAt?: unknown;
  updatedBy?: string;
};

export type SettlementAppointment = {
  id: string;
  reservationId: string;
  patientId: string;
  reservationDate: string;
  reservationTime: string;
  appointmentType: string;
  hospital: string;
  consultArea: string;
  legacyDepositAmount: string;
  legacySurgeryCost: string;
};

export type SettlementMutationInput = {
  patientId: string;
  reservationDocId: string;
  direction: SettlementDirection;
  category: SettlementCategory;
  amount: number;
  paymentMethod: SettlementPaymentMethod;
  paidAt: string;
  memo?: string;
};

type SettlementListResult = {
  success: boolean;
  message?: string;
  settlements?: Record<string, unknown>[];
  appointments?: Record<string, unknown>[];
  aggregate?: SettlementAggregate;
};

async function callSettlementsApi(action: string, payload: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) return { success: false, message: "로그인이 필요합니다." } as SettlementListResult;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { success: false, message: "인터넷 연결을 확인해주세요." } as SettlementListResult;
  }
  try {
    const idToken = await user.getIdToken();
    const response = await fetch("/api/settlements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, action, payload }),
    });
    const body = await response.json().catch(() => ({})) as SettlementListResult;
    if (!response.ok) {
      return {
        ...body,
        success: false,
        message: body.message || `서버 오류가 발생했습니다. (${response.status})`,
      };
    }
    return body;
  } catch {
    return { success: false, message: "네트워크 오류가 발생했습니다." } as SettlementListResult;
  }
}

function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapSettlement(raw: Record<string, unknown>): SettlementRecord {
  return {
    id: cleanText(raw.id),
    patientId: cleanText(raw.patientId),
    reservationDocId: cleanText(raw.reservationDocId),
    reservationId: cleanText(raw.reservationId),
    appointmentDate: cleanText(raw.appointmentDate),
    appointmentType: cleanText(raw.appointmentType),
    hospital: cleanText(raw.hospital),
    consultArea: cleanText(raw.consultArea),
    direction: raw.direction === "refund" ? "refund" : "payment",
    category: (["deposit", "surgery_fee", "procedure_fee", "other"].includes(String(raw.category))
      ? raw.category
      : "other") as SettlementCategory,
    amount: numberValue(raw.amount),
    paymentMethod: (["card", "cash", "bank_transfer", "foreign_card", "other"].includes(String(raw.paymentMethod))
      ? raw.paymentMethod
      : "other") as SettlementPaymentMethod,
    paidAt: cleanText(raw.paidAt),
    memo: cleanText(raw.memo),
    status: raw.status === "void" ? "void" : "active",
    voidReason: cleanText(raw.voidReason) || undefined,
    createdAt: raw.createdAt,
    createdBy: cleanText(raw.createdBy),
    updatedAt: raw.updatedAt,
    updatedBy: cleanText(raw.updatedBy),
  };
}

function mapAppointment(raw: Record<string, unknown>): SettlementAppointment {
  return {
    id: cleanText(raw.id),
    reservationId: cleanText(raw.reservationId),
    patientId: cleanText(raw.patientId),
    reservationDate: cleanText(raw.reservationDate),
    reservationTime: cleanText(raw.reservationTime),
    appointmentType: cleanText(raw.appointmentType),
    hospital: cleanText(raw.hospital),
    consultArea: cleanText(raw.consultArea),
    legacyDepositAmount: cleanText(raw.legacyDepositAmount),
    legacySurgeryCost: cleanText(raw.legacySurgeryCost),
  };
}

export async function listPatientSettlements(patientId: string): Promise<{
  settlements: SettlementRecord[];
  appointments: SettlementAppointment[];
  aggregate: SettlementAggregate;
}> {
  const result = await callSettlementsApi("list", { patientId });
  if (!result.success) throw new Error(result.message || "정산 내역을 불러오지 못했습니다.");
  return {
    settlements: (result.settlements || []).map(mapSettlement),
    appointments: (result.appointments || []).map(mapAppointment),
    aggregate: result.aggregate || {
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
    },
  };
}

export async function createSettlement(input: SettlementMutationInput) {
  return callSettlementsApi("create", input as unknown as Record<string, unknown>);
}

export async function updateSettlement(settlementId: string, input: SettlementMutationInput) {
  return callSettlementsApi("update", { settlementId, ...input });
}

export async function voidSettlement(settlementId: string, reason: string) {
  return callSettlementsApi("void", { settlementId, reason });
}
''')

write("lib/settlementServer.ts", r'''
import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { cleanText, toSerializable } from "@/lib/adminUtils";
import { calcCommission } from "@/lib/commissionUtils";
import {
  aggregateSettlementRows,
  isSettlementPaymentMethod,
  settlementAmount,
  type SettlementCategory,
  type SettlementDirection,
  type SettlementMathRow,
} from "@/lib/settlementMath";
import type { requireActiveStaff } from "@/lib/apiAuth";

const MAX_SETTLEMENTS_PER_PATIENT = 500;
const CATEGORIES = new Set<SettlementCategory>(["deposit", "surgery_fee", "procedure_fee", "other"]);
const DIRECTIONS = new Set<SettlementDirection>(["payment", "refund"]);

type StaffContext = Awaited<ReturnType<typeof requireActiveStaff>>;
type SettlementDoc = Record<string, unknown> & { id?: string };

type NormalizedInput = {
  patientId: string;
  reservationDocId: string;
  direction: SettlementDirection;
  category: SettlementCategory;
  amount: number;
  paymentMethod: "card" | "cash" | "bank_transfer" | "foreign_card" | "other";
  paidAt: string;
  memo: string;
};

function error(message: string, status = 400, code = "INVALID_SETTLEMENT") {
  return NextResponse.json({ success: false, code, message }, { status });
}

function normalizeInput(payload: Record<string, unknown>): NormalizedInput | null {
  const patientId = cleanText(payload.patientId);
  const reservationDocId = cleanText(payload.reservationDocId);
  const direction = String(payload.direction) as SettlementDirection;
  const category = String(payload.category) as SettlementCategory;
  const paymentMethod = String(payload.paymentMethod);
  const amount = settlementAmount(payload.amount);
  const paidAt = cleanText(payload.paidAt);
  if (
    !patientId ||
    !reservationDocId ||
    !DIRECTIONS.has(direction) ||
    !CATEGORIES.has(category) ||
    !isSettlementPaymentMethod(paymentMethod) ||
    amount <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(paidAt)
  ) return null;
  return {
    patientId,
    reservationDocId,
    direction,
    category,
    amount,
    paymentMethod,
    paidAt,
    memo: cleanText(payload.memo),
  };
}

function buildAuditLog(
  ctx: StaffContext,
  params: {
    action: string;
    targetType: "settlement" | "invoice";
    targetId: string;
    patientId: string;
    reservationId: string;
    invoiceId?: string;
    message: string;
    before?: unknown;
    after?: unknown;
  },
  now: FirebaseFirestore.FieldValue
) {
  return {
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    staffUid: ctx.uid,
    staffName: ctx.name,
    staffEmail: ctx.email,
    staffRole: ctx.role,
    staffCode: ctx.staffCode || "",
    patientId: params.patientId,
    reservationId: params.reservationId,
    invoiceId: params.invoiceId || "",
    message: params.message,
    before: params.before ?? null,
    after: params.after ?? null,
    createdAt: now,
  };
}

function asMathRows(docs: SettlementDoc[]): SettlementMathRow[] {
  return docs.map((doc) => doc as SettlementMathRow);
}

function invoicePatch(
  current: Record<string, unknown>,
  aggregate: ReturnType<typeof aggregateSettlementRows>,
  ctx: StaffContext,
  now: FirebaseFirestore.FieldValue
): Record<string, unknown> {
  const hasRate = current.commissionRate !== undefined && current.commissionRate !== null && current.commissionRate !== "";
  const rate = hasRate ? Number(current.commissionRate) : 0;
  const commissionAmount = hasRate && Number.isFinite(rate)
    ? calcCommission(aggregate.commissionBase, rate)
    : null;
  return {
    totalAmount: aggregate.netAmount,
    paymentMethod: aggregate.paymentMethod ?? null,
    cardAmount: aggregate.cardAmount,
    cashAmount: aggregate.cashAmount,
    bankTransferAmount: aggregate.methodTotals.bank_transfer,
    foreignCardAmount: aggregate.methodTotals.foreign_card,
    otherAmount: aggregate.methodTotals.other,
    settlementPaidAmount: aggregate.totalPaid,
    settlementRefundAmount: aggregate.totalRefunded,
    settlementCount: aggregate.count,
    commissionBase: aggregate.commissionBase,
    commissionAmount,
    invoiceRevision: FieldValue.increment(1),
    updatedAfterConfirmation: current.status === "confirmed" ? true : current.updatedAfterConfirmation === true,
    lastSettlementSyncedAt: now,
    updatedAt: now,
    updatedBy: ctx.name,
    updatedByUid: ctx.uid,
  };
}

export async function listSettlements(payload: Record<string, unknown>) {
  const patientId = cleanText(payload.patientId);
  if (!patientId) return error("patientId가 없습니다.");

  const [settlementSnap, reservationSnap] = await Promise.all([
    adminDb.collection("settlements")
      .where("patientId", "==", patientId)
      .limit(MAX_SETTLEMENTS_PER_PATIENT + 1)
      .get(),
    adminDb.collection("reservations")
      .where("patientId", "==", patientId)
      .limit(501)
      .get(),
  ]);
  if (settlementSnap.docs.length > MAX_SETTLEMENTS_PER_PATIENT) {
    return error("정산 내역이 너무 많아 한 번에 처리할 수 없습니다.", 409, "SETTLEMENT_LIMIT_EXCEEDED");
  }

  const settlements = settlementSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
    .sort((a, b) => `${String(b.paidAt || "")}\u0000${b.id}`.localeCompare(`${String(a.paidAt || "")}\u0000${a.id}`));
  const appointments = reservationSnap.docs
    .flatMap((doc) => {
      const data = doc.data() as Record<string, unknown>;
      if (data.isDeleted === true) return [];
      return [{
        id: doc.id,
        reservationId: cleanText(data.reservationId),
        patientId: cleanText(data.patientId),
        reservationDate: cleanText(data.reservationDate),
        reservationTime: cleanText(data.reservationTime),
        appointmentType: cleanText(data.appointmentType) || "상담",
        hospital: cleanText(data.hospital),
        consultArea: cleanText(data.consultArea),
        legacyDepositAmount: cleanText(data.depositAmount),
        legacySurgeryCost: cleanText(data.surgeryCost),
      }];
    })
    .sort((a, b) => `${b.reservationDate} ${b.reservationTime}\u0000${b.id}`.localeCompare(`${a.reservationDate} ${a.reservationTime}\u0000${a.id}`));

  return NextResponse.json({
    success: true,
    settlements: toSerializable(settlements),
    appointments,
    aggregate: aggregateSettlementRows(asMathRows(settlements)),
  });
}

type MutationMode = "create" | "update" | "void";

async function mutateSettlement(mode: MutationMode, payload: Record<string, unknown>, ctx: StaffContext) {
  const settlements = adminDb.collection("settlements");
  const settlementId = mode === "create" ? settlements.doc().id : cleanText(payload.settlementId);
  if (!settlementId) return error("정산 식별자가 없습니다.");
  const settlementRef = settlements.doc(settlementId);

  const outcome = await adminDb.runTransaction(async (tx) => {
    const existingSnap = mode === "create" ? null : await tx.get(settlementRef);
    if (existingSnap && !existingSnap.exists) return { kind: "missing" as const };
    const existing = existingSnap?.data() as SettlementDoc | undefined;
    if (mode === "void" && existing?.status === "void") return { kind: "alreadyVoid" as const };

    if (mode === "update" && payload.patientId && cleanText(payload.patientId) !== cleanText(existing?.patientId)) {
      return { kind: "reservationMismatch" as const };
    }
    const patientId = mode === "create" ? cleanText(payload.patientId) : cleanText(existing?.patientId);
    const reservationDocId = mode === "void"
      ? cleanText(existing?.reservationDocId)
      : cleanText(payload.reservationDocId || existing?.reservationDocId);
    if (!patientId || !reservationDocId) return { kind: "invalid" as const };

    const reservationRef = adminDb.collection("reservations").doc(reservationDocId);
    const reservationSnap = await tx.get(reservationRef);
    if (!reservationSnap.exists) return { kind: "reservationMissing" as const };
    const reservation = reservationSnap.data() as Record<string, unknown>;
    if (reservation.isDeleted === true || cleanText(reservation.patientId) !== patientId) {
      return { kind: "reservationMismatch" as const };
    }

    const oldReservationDocId = cleanText(existing?.reservationDocId);
    const affectedReservationIds = [...new Set([oldReservationDocId, reservationDocId].filter(Boolean))];
    const patientSettlementSnap = await tx.get(
      settlements.where("patientId", "==", patientId).limit(MAX_SETTLEMENTS_PER_PATIENT + 1)
    );
    if (patientSettlementSnap.docs.length > MAX_SETTLEMENTS_PER_PATIENT) {
      return { kind: "limit" as const };
    }
    const patientSnap = await tx.get(
      adminDb.collection("patients").where("patientId", "==", patientId).limit(10)
    );
    if (patientSnap.empty) return { kind: "patientMissing" as const };

    const invoiceDocsByReservation = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (const id of affectedReservationIds) {
      const invoiceSnap = await tx.get(adminDb.collection("invoices").where("reservationDocId", "==", id));
      invoiceDocsByReservation.set(id, invoiceSnap.docs);
    }

    const normalized = mode === "void" ? null : normalizeInput({ ...payload, patientId, reservationDocId });
    if (mode !== "void" && !normalized) return { kind: "invalid" as const };
    const now = FieldValue.serverTimestamp();
    const next: SettlementDoc = mode === "void"
      ? {
          ...(existing || {}),
          id: settlementId,
          status: "void",
          voidReason: cleanText(payload.reason),
          voidedAt: now,
          voidedBy: ctx.name,
          voidedByUid: ctx.uid,
          updatedAt: now,
          updatedBy: ctx.name,
          updatedByUid: ctx.uid,
        }
      : {
          ...(existing || {}),
          ...normalized,
          id: settlementId,
          reservationId: cleanText(reservation.reservationId),
          appointmentDate: cleanText(reservation.reservationDate),
          appointmentType: cleanText(reservation.appointmentType) || "상담",
          hospital: cleanText(reservation.hospital),
          consultArea: cleanText(reservation.consultArea),
          status: "active",
          isDeleted: false,
          updatedAt: now,
          updatedBy: ctx.name,
          updatedByUid: ctx.uid,
          ...(mode === "create" ? {
            createdAt: now,
            createdBy: ctx.name,
            createdByUid: ctx.uid,
          } : {}),
        };

    const allRows: SettlementDoc[] = patientSettlementSnap.docs
      .filter((doc) => doc.id !== settlementId)
      .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }));
    allRows.push(next);
    const patientAggregate = aggregateSettlementRows(asMathRows(allRows));
    if (patientAggregate.netAmount < 0) return { kind: "negative" as const };

    const aggregatesByReservation = new Map<string, ReturnType<typeof aggregateSettlementRows>>();
    for (const id of affectedReservationIds) {
      const rows = allRows.filter((row) => cleanText(row.reservationDocId) === id);
      const aggregate = aggregateSettlementRows(asMathRows(rows));
      if (aggregate.netAmount < 0) return { kind: "negative" as const };
      aggregatesByReservation.set(id, aggregate);
    }

    const storedNext = { ...next };
    delete storedNext.id;
    if (mode === "create") tx.set(settlementRef, storedNext);
    else tx.update(settlementRef, storedNext);

    const patientPatch = {
      settlementCount: patientAggregate.count,
      totalSettlementPaid: patientAggregate.totalPaid,
      totalSettlementRefunded: patientAggregate.totalRefunded,
      netSettlementAmount: patientAggregate.netAmount,
      lastSettlementAt: patientAggregate.lastPaidAt,
      settlementUpdatedAt: now,
      summaryUpdatedAt: now,
    };
    for (const patientDoc of patientSnap.docs) tx.update(patientDoc.ref, patientPatch);

    for (const reservationId of affectedReservationIds) {
      const aggregate = aggregatesByReservation.get(reservationId) || aggregateSettlementRows([]);
      for (const invoiceDoc of invoiceDocsByReservation.get(reservationId) || []) {
        const invoice = invoiceDoc.data() as Record<string, unknown>;
        if (invoice.isDeleted === true) continue;
        const patch = invoicePatch(invoice, aggregate, ctx, now);
        tx.update(invoiceDoc.ref, patch);
        tx.set(adminDb.collection("logs").doc(), buildAuditLog(ctx, {
          action: "invoice_settlement_auto_sync",
          targetType: "invoice",
          targetId: invoiceDoc.id,
          patientId,
          reservationId: cleanText(invoice.reservationId),
          invoiceId: cleanText(invoice.invoiceId),
          message: `${ctx.name}님이 정산 변경에 따라 인보이스 실결제액과 커미션을 자동 재계산했습니다.`,
          before: {
            totalAmount: invoice.totalAmount,
            commissionBase: invoice.commissionBase,
            commissionAmount: invoice.commissionAmount,
            status: invoice.status,
          },
          after: {
            totalAmount: aggregate.netAmount,
            commissionBase: aggregate.commissionBase,
            settlementCount: aggregate.count,
            status: invoice.status,
          },
        }, now));
      }
    }

    const action = mode === "create" ? "settlement_create" : mode === "update" ? "settlement_update" : "settlement_void";
    tx.set(adminDb.collection("logs").doc(), buildAuditLog(ctx, {
      action,
      targetType: "settlement",
      targetId: settlementId,
      patientId,
      reservationId: cleanText(reservation.reservationId),
      message: mode === "void"
        ? `${ctx.name}님이 정산 기록을 무효 처리했습니다.`
        : `${ctx.name}님이 실제 결제 정산 기록을 ${mode === "create" ? "등록" : "수정"}했습니다.`,
      before: existing || null,
      after: next,
    }, now));

    return {
      kind: "ok" as const,
      settlementId,
      patientId,
      aggregate: patientAggregate,
    };
  });

  if (outcome.kind === "missing") return error("정산 기록을 찾을 수 없습니다.", 404, "SETTLEMENT_NOT_FOUND");
  if (outcome.kind === "alreadyVoid") return NextResponse.json({ success: true, alreadyVoid: true });
  if (outcome.kind === "invalid") return error("정산 입력값을 확인해주세요.");
  if (outcome.kind === "reservationMissing") return error("연결할 예약을 찾을 수 없습니다.", 404, "RESERVATION_NOT_FOUND");
  if (outcome.kind === "reservationMismatch") return error("예약과 환자 연결 정보가 일치하지 않습니다.", 409, "SETTLEMENT_RESERVATION_MISMATCH");
  if (outcome.kind === "patientMissing") return error("환자 정보를 찾을 수 없습니다.", 404, "PATIENT_NOT_FOUND");
  if (outcome.kind === "limit") return error("정산 내역이 너무 많아 처리할 수 없습니다.", 409, "SETTLEMENT_LIMIT_EXCEEDED");
  if (outcome.kind === "negative") return error("환불액은 해당 예약의 누적 실결제액을 초과할 수 없습니다.", 409, "SETTLEMENT_NEGATIVE_BALANCE");
  return NextResponse.json({
    success: true,
    settlementId: outcome.settlementId,
    patientId: outcome.patientId,
    aggregate: outcome.aggregate,
  });
}

export function createSettlementAtomic(payload: Record<string, unknown>, ctx: StaffContext) {
  return mutateSettlement("create", payload, ctx);
}

export function updateSettlementAtomic(payload: Record<string, unknown>, ctx: StaffContext) {
  return mutateSettlement("update", payload, ctx);
}

export function voidSettlementAtomic(payload: Record<string, unknown>, ctx: StaffContext) {
  return mutateSettlement("void", payload, ctx);
}
''')

write("app/api/settlements/route.ts", r'''
import { NextRequest, NextResponse } from "next/server";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import {
  createSettlementAtomic,
  listSettlements,
  updateSettlementAtomic,
  voidSettlementAtomic,
} from "@/lib/settlementServer";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      idToken?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    const ctx = await requireActiveStaff(String(body.idToken || ""), { checkRevoked: true });
    const payload = body.payload || {};
    if (body.action === "list") return listSettlements(payload);
    if (body.action === "create") return createSettlementAtomic(payload, ctx);
    if (body.action === "update") return updateSettlementAtomic(payload, ctx);
    if (body.action === "void") return voidSettlementAtomic(payload, ctx);
    return NextResponse.json(
      { success: false, code: "UNKNOWN_ACTION", message: "지원하지 않는 정산 요청입니다." },
      { status: 400 }
    );
  } catch (error) {
    const authResponse = toAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("[/api/settlements]", error);
    return NextResponse.json(
      { success: false, code: "INTERNAL_ERROR", message: "정산 처리 중 서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
''')

write("components/settlements/SettlementPanel.tsx", r'''
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSettlement,
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
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [appointments, setAppointments] = useState<SettlementAppointment[]>([]);
  const [aggregate, setAggregate] = useState<SettlementAggregate>(EMPTY_AGGREGATE);
  const [form, setForm] = useState<FormState>(() => defaultForm(patientId, currentReservation));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listPatientSettlements(patientId);
      setSettlements(result.settlements);
      setAppointments(result.appointments);
      setAggregate(result.aggregate);
      setForm((prev) => ({
        ...prev,
        patientId,
        reservationDocId: prev.reservationDocId || currentReservation?.id || result.appointments[0]?.id || "",
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
  }, [patientId, currentReservation?.id, load]);

  const selectedAppointment = useMemo(
    () => appointments.find((appointment) => appointment.id === form.reservationDocId),
    [appointments, form.reservationDocId]
  );
  const hasLegacyAmounts = appointments.some(
    (appointment) => appointment.legacyDepositAmount || appointment.legacySurgeryCost
  );

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
      await load();
      onMutated?.();
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
      await load();
      onMutated?.();
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

      {hasLegacyAmounts && aggregate.count === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          기존 예약의 예약금·수술비 필드가 남아 있습니다. 청구액과 실제 결제액을 구분하기 위해 자동 이전하지 않았으므로, 실제 수납 내역만 정산에 등록해 주세요.
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 p-4">
        <div className="mb-3 text-sm font-semibold">{editingId ? "정산 수정" : "정산 등록"}</div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500">연결 일정</label>
            <select
              value={form.reservationDocId}
              onChange={(e) => {
                const appointment = appointments.find((item) => item.id === e.target.value);
                setForm((prev) => ({ ...prev, reservationDocId: e.target.value, category: categoryFor(appointment) }));
              }}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            >
              <option value="">일정 선택</option>
              {appointments.map((appointment) => (
                <option key={appointment.id} value={appointment.id}>
                  {appointment.reservationDate} · {appointment.appointmentType} · {appointment.hospital || "병원 미지정"} · {appointment.consultArea || "항목 미지정"}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">구분</label>
              <select
                value={form.direction}
                onChange={(e) => setForm((prev) => ({ ...prev, direction: e.target.value as SettlementDirection }))}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="payment">결제</option>
                <option value="refund">환불</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">항목</label>
              <select
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value as SettlementCategory }))}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">실제 금액</label>
              <input
                type="number"
                min={1}
                value={form.amount || ""}
                onChange={(e) => setForm((prev) => ({ ...prev, amount: Number(e.target.value) }))}
                placeholder="이번 결제액"
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">결제 방법</label>
              <select
                value={form.paymentMethod}
                onChange={(e) => setForm((prev) => ({ ...prev, paymentMethod: e.target.value as SettlementPaymentMethod }))}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                {Object.entries(METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">결제·환불일</label>
              <input
                type="date"
                value={form.paidAt}
                onChange={(e) => setForm((prev) => ({ ...prev, paidAt: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">선택 일정</label>
              <div className="mt-1 min-h-[38px] rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
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
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
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
''')

write("components/settlements/SettlementModal.tsx", r'''
"use client";

import { SettlementPanel } from "./SettlementPanel";

type Props = {
  patientId: string;
  patientName: string;
  onClose: () => void;
  onMutated?: () => void;
};

export function SettlementModal({ patientId, patientName, onClose, onMutated }: Props) {
  return (
    <>
      <div className="fixed inset-0 z-[1100] bg-black/40" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[1101] flex max-h-[92vh] w-[760px] max-w-[calc(100vw-20px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <div className="text-lg font-bold">정산 관리</div>
            <div className="mt-0.5 text-xs text-gray-500">{patientName}</div>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <SettlementPanel patientId={patientId} patientName={patientName} onMutated={onMutated} />
        </div>
      </div>
    </>
  );
}
''')

write("docs/settlements-ledger.md", r'''
# Settlement ledger

## Source of truth

`settlements` is the source of truth for actual money received and refunded. Reservation fields such as `depositAmount` and `surgeryCost` are legacy quoted/entered values and are no longer edited by the schedule or patient-management UI.

Each settlement record is connected to one reservation and stores an actual payment or refund, its category, date, method, and audit metadata. Records are accumulated rather than overwritten. Incorrect records are voided instead of hard-deleted.

## Invoice synchronization

For every active invoice linked to the affected reservation, regardless of `draft`, `confirmed`, or `void` status:

- `totalAmount` is the net actual amount (`payments - refunds`).
- payment-method totals are rebuilt from the ledger.
- `commissionBase` is rebuilt using the existing VAT policy.
- `commissionAmount` is recalculated from the stored commission rate.
- the invoice status remains unchanged.
- confirmed invoices set `updatedAfterConfirmation=true` and every sync increments `invoiceRevision`.

## Patient summary

The patient document stores exact list-view summary values:

- `settlementCount`
- `totalSettlementPaid`
- `totalSettlementRefunded`
- `netSettlementAmount`
- `lastSettlementAt`

The customer-management page reads these fields for its settlement badge and opens the ledger only on demand.

## Legacy reservation amounts

Legacy reservation amount fields are not automatically migrated because a quoted or entered surgery cost is not proof of actual payment. The settlement UI warns when legacy values exist without ledger entries. Actual historical payments must be reviewed and entered explicitly before any migration is approved.
''')

replace(
    "firestore.rules",
    '    match /patientAmountRows/{id}         { allow read, write: if false; }\n',
    '    match /patientAmountRows/{id}         { allow read, write: if false; }\n    match /settlements/{id}                    { allow read, write: if false; }\n',
)

replace(
    "lib/patientSummary.ts",
    '    invoiceCount: 0,\n    hasInvoice: false,\n',
    '    invoiceCount: 0,\n    hasInvoice: false,\n    settlementCount: 0,\n    totalSettlementPaid: 0,\n    totalSettlementRefunded: 0,\n    netSettlementAmount: 0,\n    lastSettlementAt: "",\n',
)

replace(
    "lib/reservationsBase.ts",
    '  totalSurgeryCost?: number;\n  lastReservationDate?: string;\n',
    '  totalSurgeryCost?: number;\n  settlementCount?: number;\n  totalSettlementPaid?: number;\n  totalSettlementRefunded?: number;\n  netSettlementAmount?: number;\n  lastSettlementAt?: string;\n  lastReservationDate?: string;\n',
)
replace(
    "lib/reservationsBase.ts",
    '    totalSurgeryCost: num(p.totalSurgeryCost),\n    lastReservationDate: cleanText(p.lastReservationDate),\n',
    '    totalSurgeryCost: num(p.totalSurgeryCost),\n    settlementCount: num(p.settlementCount),\n    totalSettlementPaid: num(p.totalSettlementPaid),\n    totalSettlementRefunded: num(p.totalSettlementRefunded),\n    netSettlementAmount: num(p.netSettlementAmount),\n    lastSettlementAt: cleanText(p.lastSettlementAt),\n    lastReservationDate: cleanText(p.lastReservationDate),\n',
)
replace(
    "lib/reservations.ts",
    '        totalSurgeryCost: typeof patient.totalSurgeryCost === "number" ? patient.totalSurgeryCost : undefined,\n        lastReservationDate: cleanText(patient.lastReservationDate),\n',
    '        totalSurgeryCost: typeof patient.totalSurgeryCost === "number" ? patient.totalSurgeryCost : undefined,\n        settlementCount: typeof patient.settlementCount === "number" ? patient.settlementCount : undefined,\n        totalSettlementPaid: typeof patient.totalSettlementPaid === "number" ? patient.totalSettlementPaid : undefined,\n        totalSettlementRefunded: typeof patient.totalSettlementRefunded === "number" ? patient.totalSettlementRefunded : undefined,\n        netSettlementAmount: typeof patient.netSettlementAmount === "number" ? patient.netSettlementAmount : undefined,\n        lastSettlementAt: cleanText(patient.lastSettlementAt),\n        lastReservationDate: cleanText(patient.lastReservationDate),\n',
)

replace(
    "app/reservations/page.tsx",
    '        surgeryCostCount: p.surgeryCostCount,\n        invoiceCount: p.invoiceCount,\n',
    '        surgeryCostCount: p.surgeryCostCount,\n        settlementCount: p.settlementCount,\n        netSettlementAmount: p.netSettlementAmount,\n        invoiceCount: p.invoiceCount,\n',
)
replace(
    "app/reservations/page.tsx",
    '    coordinators: string; depositAmount: string; surgeryCost: string; hospital: string;\n',
    '    coordinators: string; hospital: string;\n',
)
replace("app/reservations/page.tsx", '      depositAmount: item.depositAmount || "",\n      surgeryCost: item.surgeryCost || "",\n', '')
replace("app/reservations/page.tsx", '          depositAmount: inlineForm.depositAmount,\n          surgeryCost: inlineForm.surgeryCost,\n', '')

replace("components/timeline/tabs/InfoTab.tsx", '  depositAmount: string;\n  surgeryCost: string;\n', '')
regex_replace(
    "components/timeline/tabs/InfoTab.tsx",
    r'\n      <div className="mt-3 grid grid-cols-2 gap-3">\n        <EditField\n          label="예약금".*?\n      </div>\n',
    '\n',
    flags=re.S,
)

replace(
    "components/timeline/DetailDrawer.tsx",
    'import { InvoiceTab } from "@/components/timeline/tabs/InvoiceTab";\n',
    'import { InvoiceTab } from "@/components/timeline/tabs/InvoiceTab";\nimport { SettlementPanel } from "@/components/settlements/SettlementPanel";\n',
)
replace(
    "components/timeline/DetailDrawer.tsx",
    'type DetailTab = "info" | "files" | "notes" | "logs" | "invoice";\n',
    'type DetailTab = "info" | "settlement" | "files" | "notes" | "logs" | "invoice";\n',
)
replace("components/timeline/DetailDrawer.tsx", '  depositAmount: string;\n  surgeryCost: string;\n', '')
replace(
    "components/timeline/DetailDrawer.tsx",
    '    coordinators: "", depositAmount: "", surgeryCost: "", doctors: "", completed: false, cancelled: false,\n',
    '    coordinators: "", doctors: "", completed: false, cancelled: false,\n',
)
replace("components/timeline/DetailDrawer.tsx", '      depositAmount: reservation.depositAmount || "",\n      surgeryCost: reservation.surgeryCost || "",\n', '')
replace("components/timeline/DetailDrawer.tsx", '          depositAmount: detailForm.depositAmount,\n          surgeryCost: detailForm.surgeryCost,\n', '', count=3)
replace("components/timeline/DetailDrawer.tsx", '        depositAmount: detailForm.depositAmount,\n        surgeryCost: detailForm.surgeryCost,\n', '')
replace("components/timeline/DetailDrawer.tsx", '    depositAmount: selectedReservation.depositAmount,\n    surgeryCost: selectedReservation.surgeryCost,\n', '')
replace(
    "components/timeline/DetailDrawer.tsx",
    '          {(["info", "files", "notes", "logs", "invoice"] as const).map((key) => {\n            const label = { info: "기본정보", files: "파일", notes: "메모", logs: "로그", invoice: "인보이스" }[key];\n',
    '          {(["info", "settlement", "files", "notes", "logs", "invoice"] as const).map((key) => {\n            const label = { info: "기본정보", settlement: "정산", files: "파일", notes: "메모", logs: "로그", invoice: "인보이스" }[key];\n',
)
replace(
    "components/timeline/DetailDrawer.tsx",
    '          {activeTab === "files" && selectedReservation && (\n',
    '          {activeTab === "settlement" && selectedReservation && (\n            <SettlementPanel\n              patientId={selectedReservation.patientId}\n              patientName={selectedReservation.name}\n              currentReservation={{\n                id: selectedReservation.id,\n                reservationId: selectedReservation.reservationId,\n                reservationDate: selectedReservation.reservationDate,\n                reservationTime: selectedReservation.reservationTime,\n                appointmentType: selectedReservation.appointmentType,\n                hospital: selectedReservation.hospital,\n                consultArea: selectedReservation.consultArea,\n              }}\n              onMutated={onRefresh}\n            />\n          )}\n\n          {activeTab === "files" && selectedReservation && (\n',
)

replace("components/reservations/CreateDrawer.tsx", '  depositAmount?: string;\n  surgeryCost?: string;\n', '')
replace("components/reservations/CreateDrawer.tsx", '  depositAmount: patient?.depositAmount || "",\n  surgeryCost: patient?.surgeryCost || "",\n', '')
replace("components/reservations/CreateDrawer.tsx", '            depositAmount: resForm.depositAmount,\n            surgeryCost: resForm.surgeryCost,\n', '')
regex_replace(
    "components/reservations/CreateDrawer.tsx",
    r'\n              \{\/\* 예약금 \+ 수술비용 \*\/\}\n              <div className="grid grid-cols-2 gap-3">.*?\n              </div>',
    '',
    flags=re.S,
)
replace("components/timeline/NewReservationDrawer.tsx", '  depositAmount: "",\n  surgeryCost: "",\n', '')
replace("components/timeline/NewReservationDrawer.tsx", '          depositAmount: form.depositAmount,\n          surgeryCost: form.surgeryCost,\n', '')
regex_replace(
    "components/timeline/NewReservationDrawer.tsx",
    r'\n          <div className="grid grid-cols-2 gap-3">\n            <div>\n              <label className="text-xs text-gray-500">예약금</label>.*?\n          </div>\n',
    '\n',
    flags=re.S,
)

replace(
    "components/reservations/ReservationsTable.tsx",
    'import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";\n',
    'import { useState, type ReactNode } from "react";\n',
)
replace(
    "components/reservations/ReservationsTable.tsx",
    'import { APPOINTMENT_TYPES, getPatientAmountRowsCached, invalidatePatientAmountRowsCache, invalidatePatientFullHistoryCache, updateReservationAmount } from "@/lib/reservations";\nimport type { AmountRow, AmountRowType } from "@/lib/reservationAmountRows";\n',
    'import { APPOINTMENT_TYPES } from "@/lib/reservations";\n',
)
replace(
    "components/reservations/ReservationsTable.tsx",
    'import { PatientInvoiceModal } from "./PatientInvoiceModal";\n',
    'import { PatientInvoiceModal } from "./PatientInvoiceModal";\nimport { SettlementModal } from "@/components/settlements/SettlementModal";\n',
)
replace(
    "components/reservations/ReservationsTable.tsx",
    '  surgeryCostCount?: number;\n  invoiceCount?: number;\n',
    '  surgeryCostCount?: number;\n  settlementCount?: number;\n  netSettlementAmount?: number;\n  invoiceCount?: number;\n',
)
replace(
    "components/reservations/ReservationsTable.tsx",
    '  coordinators: string; depositAmount: string; surgeryCost: string; hospital: string;\n',
    '  coordinators: string; hospital: string;\n',
)
regex_replace(
    "components/reservations/ReservationsTable.tsx",
    r'\nconst AMOUNT_POPOVER_TIMEOUT_MS = 8000;.*?\nexport function ReservationsTable',
    '\nexport function ReservationsTable',
    flags=re.S,
)
replace(
    "components/reservations/ReservationsTable.tsx",
    '  const [invoiceModal, setInvoiceModal] = useState<{ patientId: string; patientName: string } | null>(null);\n\n',
    '  const [invoiceModal, setInvoiceModal] = useState<{ patientId: string; patientName: string } | null>(null);\n  const [settlementModal, setSettlementModal] = useState<{ patientId: string; patientName: string } | null>(null);\n\n',
)
regex_replace(
    "components/reservations/ReservationsTable.tsx",
    r'  // 예약금/수술비 팝오버.*?\n  // 행 단위 인라인 편집 렌더러',
    '  // 행 단위 인라인 편집 렌더러',
    flags=re.S,
)
replace(
    "components/reservations/ReservationsTable.tsx",
    '    const depositCount = group.depositCount ?? 0;\n    const surgeryCostCount = group.surgeryCostCount ?? 0;\n    const invoiceCount = group.invoiceCount ?? 0;\n\n    const depositPopoverOpen = amountPopover?.groupKey === group.patientKey && amountPopover.type === "deposit";\n    const surgeryPopoverOpen = amountPopover?.groupKey === group.patientKey && amountPopover.type === "surgery";\n',
    '    const settlementCount = group.settlementCount ?? 0;\n    const invoiceCount = group.invoiceCount ?? 0;\n',
)
regex_replace(
    "components/reservations/ReservationsTable.tsx",
    r'            \{\/\* 예약금 \(묶음 그룹 수\).*?\n            \{\/\* 인보이스 \(건수\) — summary \*\/\}',
    '            {/* 정산 원장 — patients.settlementCount 배지, 상세는 공용 모달 */}\n            <button\n              onClick={() => setSettlementModal({ patientId: pid, patientName: group.name })}\n              className={`rounded-md border px-2 py-0.5 text-xs transition ${settlementCount > 0 ? "border-blue-200 bg-white text-blue-600 hover:bg-blue-50" : "border-gray-200 bg-white text-gray-400 hover:bg-gray-50"}`}\n            >\n              정산{settlementCount > 0 ? ` (${settlementCount})` : ""}\n            </button>\n\n            {/* 인보이스 (건수) — summary */}',
    flags=re.S,
)
replace(
    "components/reservations/ReservationsTable.tsx",
    '    {invoiceModal && (\n',
    '    {settlementModal && (\n      <SettlementModal\n        patientId={settlementModal.patientId}\n        patientName={settlementModal.patientName}\n        onClose={() => setSettlementModal(null)}\n        onMutated={() => onPatientMutated?.(settlementModal.patientId)}\n      />\n    )}\n    {invoiceModal && (\n',
)

replace(
    "lib/invoices.ts",
    '  cashAmount?: number;\n  commissionRate?: number;\n',
    '  cashAmount?: number;\n  bankTransferAmount?: number;\n  foreignCardAmount?: number;\n  otherAmount?: number;\n  settlementPaidAmount?: number;\n  settlementRefundAmount?: number;\n  settlementCount?: number;\n  invoiceRevision?: number;\n  updatedAfterConfirmation?: boolean;\n  lastSettlementSyncedAt?: unknown;\n  commissionRate?: number;\n',
)
replace(
    "lib/invoices.ts",
    '    cashAmount: data.cashAmount != null ? toNumber(data.cashAmount) : undefined,\n    commissionRate: data.commissionRate != null ? toNumber(data.commissionRate) : undefined,\n',
    '    cashAmount: data.cashAmount != null ? toNumber(data.cashAmount) : undefined,\n    bankTransferAmount: data.bankTransferAmount != null ? toNumber(data.bankTransferAmount) : undefined,\n    foreignCardAmount: data.foreignCardAmount != null ? toNumber(data.foreignCardAmount) : undefined,\n    otherAmount: data.otherAmount != null ? toNumber(data.otherAmount) : undefined,\n    settlementPaidAmount: data.settlementPaidAmount != null ? toNumber(data.settlementPaidAmount) : undefined,\n    settlementRefundAmount: data.settlementRefundAmount != null ? toNumber(data.settlementRefundAmount) : undefined,\n    settlementCount: data.settlementCount != null ? toNumber(data.settlementCount) : undefined,\n    invoiceRevision: data.invoiceRevision != null ? toNumber(data.invoiceRevision) : undefined,\n    updatedAfterConfirmation: data.updatedAfterConfirmation === true,\n    lastSettlementSyncedAt: data.lastSettlementSyncedAt,\n    commissionRate: data.commissionRate != null ? toNumber(data.commissionRate) : undefined,\n',
)

replace(
    "lib/invoiceConsistencyServer.ts",
    'import type { requireActiveStaff } from "@/lib/apiAuth";\n',
    'import type { requireActiveStaff } from "@/lib/apiAuth";\nimport { aggregateSettlementRows } from "@/lib/settlementMath";\nimport { calcCommission } from "@/lib/commissionUtils";\n',
)
replace(
    "lib/invoiceConsistencyServer.ts",
    '    const existing = existingSnap.docs.find((doc) => doc.data().isDeleted !== true);\n',
    '    const existing = existingSnap.docs.find((doc) => doc.data().isDeleted !== true);\n    const settlementSnap = await tx.get(\n      adminDb.collection("settlements").where("reservationDocId", "==", reservationDocId).limit(501)\n    );\n    const settlementAggregate = aggregateSettlementRows(\n      settlementSnap.docs.map((doc) => doc.data() as Record<string, unknown>)\n    );\n',
)
regex_replace(
    "lib/invoiceConsistencyServer.ts",
    r'      totalAmount: \(\(\) => \{.*?\}\)\(\),\n      memo: "",',
    '      totalAmount: settlementAggregate.netAmount,\n      paymentMethod: settlementAggregate.paymentMethod ?? null,\n      cardAmount: settlementAggregate.cardAmount,\n      cashAmount: settlementAggregate.cashAmount,\n      bankTransferAmount: settlementAggregate.methodTotals.bank_transfer,\n      foreignCardAmount: settlementAggregate.methodTotals.foreign_card,\n      otherAmount: settlementAggregate.methodTotals.other,\n      settlementPaidAmount: settlementAggregate.totalPaid,\n      settlementRefundAmount: settlementAggregate.totalRefunded,\n      settlementCount: settlementAggregate.count,\n      commissionBase: settlementAggregate.commissionBase,\n      commissionAmount: null,\n      invoiceRevision: 0,\n      updatedAfterConfirmation: false,\n      memo: "",',
    flags=re.S,
)
replace(
    "lib/invoiceConsistencyServer.ts",
    '    const reservation = reservationSnap.data() as Record<string, unknown>;\n    if (!invoiceReservationMatches(current, reservation)) return { kind: "linkMismatch" as const };\n\n    const now = FieldValue.serverTimestamp();\n    const patch: Record<string, unknown> = {\n',
    '    const reservation = reservationSnap.data() as Record<string, unknown>;\n    if (!invoiceReservationMatches(current, reservation)) return { kind: "linkMismatch" as const };\n    const settlementSnap = await tx.get(\n      adminDb.collection("settlements").where("reservationDocId", "==", reservationDocId).limit(501)\n    );\n    const settlementAggregate = aggregateSettlementRows(\n      settlementSnap.docs.map((doc) => doc.data() as Record<string, unknown>)\n    );\n    const hasSettlements = settlementAggregate.count > 0;\n    const commissionRate = payload.commissionRate !== undefined\n      ? toNumber(payload.commissionRate)\n      : current.commissionRate !== undefined && current.commissionRate !== null\n        ? toNumber(current.commissionRate)\n        : null;\n\n    const now = FieldValue.serverTimestamp();\n    const patch: Record<string, unknown> = {\n',
)
replace(
    "lib/invoiceConsistencyServer.ts",
    '      totalAmount: toNumber(payload.totalAmount),\n      paymentMethod: payload.paymentMethod ?? null,\n      cardAmount: payload.cardAmount !== undefined ? toNumber(payload.cardAmount) : null,\n      cashAmount: payload.cashAmount !== undefined ? toNumber(payload.cashAmount) : null,\n      commissionRate: payload.commissionRate !== undefined ? toNumber(payload.commissionRate) : null,\n',
    '      totalAmount: hasSettlements ? settlementAggregate.netAmount : toNumber(payload.totalAmount),\n      paymentMethod: hasSettlements ? (settlementAggregate.paymentMethod ?? null) : (payload.paymentMethod ?? null),\n      cardAmount: hasSettlements ? settlementAggregate.cardAmount : (payload.cardAmount !== undefined ? toNumber(payload.cardAmount) : null),\n      cashAmount: hasSettlements ? settlementAggregate.cashAmount : (payload.cashAmount !== undefined ? toNumber(payload.cashAmount) : null),\n      bankTransferAmount: hasSettlements ? settlementAggregate.methodTotals.bank_transfer : (current.bankTransferAmount ?? null),\n      foreignCardAmount: hasSettlements ? settlementAggregate.methodTotals.foreign_card : (current.foreignCardAmount ?? null),\n      otherAmount: hasSettlements ? settlementAggregate.methodTotals.other : (current.otherAmount ?? null),\n      settlementPaidAmount: hasSettlements ? settlementAggregate.totalPaid : (current.settlementPaidAmount ?? null),\n      settlementRefundAmount: hasSettlements ? settlementAggregate.totalRefunded : (current.settlementRefundAmount ?? null),\n      settlementCount: hasSettlements ? settlementAggregate.count : (current.settlementCount ?? 0),\n      commissionRate,\n',
)
replace(
    "lib/invoiceConsistencyServer.ts",
    '      commissionBase: payload.commissionBase !== undefined ? toNumber(payload.commissionBase) : null,\n      commissionAmount: payload.commissionAmount !== undefined ? toNumber(payload.commissionAmount) : null,\n',
    '      commissionBase: hasSettlements ? settlementAggregate.commissionBase : (payload.commissionBase !== undefined ? toNumber(payload.commissionBase) : null),\n      commissionAmount: hasSettlements\n        ? (commissionRate === null ? null : calcCommission(settlementAggregate.commissionBase, commissionRate))\n        : (payload.commissionAmount !== undefined ? toNumber(payload.commissionAmount) : null),\n',
)

replace(
    "tests/units.test.ts",
    'import { cleanText, toSerializable } from "../lib/adminUtils";\n',
    'import { cleanText, toSerializable } from "../lib/adminUtils";\nimport { aggregateSettlementRows } from "../lib/settlementMath";\n',
)
replace(
    "tests/units.test.ts",
    'test("cleanText: null/undefined 안전", () => {\n',
    '''test("settlement aggregate: 실제 결제-환불 및 결제수단별 합계", () => {\n  const result = aggregateSettlementRows([\n    { direction: "payment", amount: 550000, paymentMethod: "card", status: "active", paidAt: "2026-07-01" },\n    { direction: "payment", amount: 500000, paymentMethod: "cash", status: "active", paidAt: "2026-07-02" },\n    { direction: "refund", amount: 50000, paymentMethod: "cash", status: "active", paidAt: "2026-07-03" },\n  ]);\n  assert.equal(result.totalPaid, 1050000);\n  assert.equal(result.totalRefunded, 50000);\n  assert.equal(result.netAmount, 1000000);\n  assert.equal(result.cardAmount, 550000);\n  assert.equal(result.cashAmount, 450000);\n  assert.equal(result.paymentMethod, "mixed");\n  assert.equal(result.commissionBase, 950000);\n});\n\ntest("settlement aggregate: void 기록 제외", () => {\n  const result = aggregateSettlementRows([\n    { direction: "payment", amount: 100000, paymentMethod: "cash", status: "void" },\n    { direction: "payment", amount: 200000, paymentMethod: "bank_transfer", status: "active" },\n  ]);\n  assert.equal(result.count, 1);\n  assert.equal(result.netAmount, 200000);\n  assert.equal(result.methodTotals.bank_transfer, 200000);\n});\n\ntest("cleanText: null/undefined 안전", () => {\n''',
)

print("Settlement ledger refactor applied")
