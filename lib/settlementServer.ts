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
  const includeAppointments = payload.includeAppointments !== false;
  if (!patientId) return error("patientId가 없습니다.");

  const settlementSnap = await adminDb.collection("settlements")
    .where("patientId", "==", patientId)
    .limit(MAX_SETTLEMENTS_PER_PATIENT + 1)
    .get();

  const reservationSnap = includeAppointments
    ? await adminDb.collection("reservations")
      .where("patientId", "==", patientId)
      .limit(501)
      .get()
    : null;

  if (settlementSnap.docs.length > MAX_SETTLEMENTS_PER_PATIENT) {
    return error("정산 내역이 너무 많아 한 번에 처리할 수 없습니다.", 409, "SETTLEMENT_LIMIT_EXCEEDED");
  }

  const settlements: SettlementDoc[] = settlementSnap.docs
    .map((doc): SettlementDoc => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
    .sort((a, b) => `${String(b.paidAt || "")}\u0000${String(b.id || "")}`.localeCompare(`${String(a.paidAt || "")}\u0000${String(a.id || "")}`));
  const appointments = (reservationSnap?.docs ?? [])
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
      }];
    })
    .sort((a, b) => `${b.reservationDate} ${b.reservationTime}\u0000${b.id}`.localeCompare(`${a.reservationDate} ${a.reservationTime}\u0000${a.id}`));

  return NextResponse.json({
    success: true,
    settlements: toSerializable(settlements),
    appointments,
    appointmentsLoaded: includeAppointments,
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
