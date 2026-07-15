import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { cleanText, docToObj } from "@/lib/adminUtils";
import { aggregateSettlementRows } from "@/lib/settlementMath";
import { calcCommission } from "@/lib/commissionUtils";
import {
  invoiceLog,
  invoiceReservationLinkError,
  invoiceReservationMatches,
  isCoordinatorOf,
  type StaffContext,
} from "@/lib/invoiceConsistencyShared";

const ALLOWED_INVOICE_STATUS = new Set(["draft", "confirmed", "void"]);

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  const numberValue = Number(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export async function updateInvoiceAtomic(
  payload: Record<string, unknown>,
  ctx: StaffContext
) {
  const invoiceDocId = cleanText(payload.invoiceDocId);
  if (!invoiceDocId) {
    return NextResponse.json({ success: false, message: "인보이스 식별자가 없습니다." }, { status: 400 });
  }
  if (payload.isDeleted !== undefined) {
    return NextResponse.json(
      { success: false, code: "DISALLOWED_FIELD", message: "허용되지 않은 필드입니다: isDeleted" },
      { status: 400 }
    );
  }
  if (payload.status !== undefined && !ALLOWED_INVOICE_STATUS.has(String(payload.status))) {
    return NextResponse.json({ success: false, message: "유효하지 않은 인보이스 상태입니다." }, { status: 400 });
  }

  const invoiceRef = adminDb.collection("invoices").doc(invoiceDocId);
  const result = await adminDb.runTransaction(async (tx) => {
    const invoiceSnap = await tx.get(invoiceRef);
    if (!invoiceSnap.exists) return { kind: "missing" as const };
    const current = invoiceSnap.data() as Record<string, unknown>;
    if (!isCoordinatorOf(current, ctx)) return { kind: "forbidden" as const };
    if (current.isDeleted === true) return { kind: "deleted" as const };

    const reservationDocId = cleanText(current.reservationDocId);
    if (!reservationDocId) return { kind: "linkMissing" as const };
    const reservationRef = adminDb.collection("reservations").doc(reservationDocId);
    const reservationSnap = await tx.get(reservationRef);
    if (!reservationSnap.exists) return { kind: "linkMissing" as const };
    const reservation = reservationSnap.data() as Record<string, unknown>;
    if (!invoiceReservationMatches(current, reservation)) return { kind: "linkMismatch" as const };
    const settlementSnap = await tx.get(
      adminDb.collection("settlements").where("reservationDocId", "==", reservationDocId).limit(501)
    );
    const settlementAggregate = aggregateSettlementRows(
      settlementSnap.docs.map((doc) => doc.data() as Record<string, unknown>)
    );
    const hasSettlements = settlementAggregate.count > 0;
    const commissionRate = payload.commissionRate !== undefined
      ? toNumber(payload.commissionRate)
      : current.commissionRate !== undefined && current.commissionRate !== null
        ? toNumber(current.commissionRate)
        : null;

    const now = FieldValue.serverTimestamp();
    const patch: Record<string, unknown> = {
      hospitalName: cleanText(payload.hospitalName),
      surgeryItems: cleanText(payload.surgeryItems),
      surgeryDate: cleanText(payload.surgeryDate ?? ""),
      totalAmount: hasSettlements ? settlementAggregate.netAmount : toNumber(payload.totalAmount),
      paymentMethod: hasSettlements ? (settlementAggregate.paymentMethod ?? null) : (payload.paymentMethod ?? null),
      cardAmount: hasSettlements ? settlementAggregate.cardAmount : (payload.cardAmount !== undefined ? toNumber(payload.cardAmount) : null),
      cashAmount: hasSettlements ? settlementAggregate.cashAmount : (payload.cashAmount !== undefined ? toNumber(payload.cashAmount) : null),
      bankTransferAmount: hasSettlements ? settlementAggregate.methodTotals.bank_transfer : (current.bankTransferAmount ?? null),
      foreignCardAmount: hasSettlements ? settlementAggregate.methodTotals.foreign_card : (current.foreignCardAmount ?? null),
      otherAmount: hasSettlements ? settlementAggregate.methodTotals.other : (current.otherAmount ?? null),
      settlementPaidAmount: hasSettlements ? settlementAggregate.totalPaid : (current.settlementPaidAmount ?? null),
      settlementRefundAmount: hasSettlements ? settlementAggregate.totalRefunded : (current.settlementRefundAmount ?? null),
      settlementCount: hasSettlements ? settlementAggregate.count : (current.settlementCount ?? 0),
      commissionRate,
      commissionStaffUid: payload.commissionStaffUid ?? null,
      commissionStaffName: payload.commissionStaffName ?? null,
      commissionBase: hasSettlements ? settlementAggregate.commissionBase : (payload.commissionBase !== undefined ? toNumber(payload.commissionBase) : null),
      commissionAmount: hasSettlements
        ? (commissionRate === null ? null : calcCommission(settlementAggregate.commissionBase, commissionRate))
        : (payload.commissionAmount !== undefined ? toNumber(payload.commissionAmount) : null),
      memo: cleanText(payload.memo),
      doctors: Array.isArray(payload.doctors)
        ? payload.doctors
        : (Array.isArray(current.doctors) ? current.doctors : []),
      status: payload.status || current.status || "draft",
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    };

    tx.update(invoiceRef, patch);
    tx.update(reservationRef, {
      invoiceId: current.invoiceId,
      invoiceDocId,
      invoiceStatus: patch.status,
      invoiceUpdatedAt: now,
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    });
    tx.set(adminDb.collection("logs").doc(), invoiceLog(ctx, {
      action: "invoice_update",
      targetId: cleanText(current.invoiceId),
      patientId: cleanText(current.patientId),
      reservationId: cleanText(current.reservationId),
      message: `${ctx.name}님이 인보이스를 수정했습니다.`,
      after: {
        invoiceId: current.invoiceId,
        totalAmount: patch.totalAmount,
        status: patch.status,
      },
    }, now));
    return { kind: "updated" as const };
  });

  if (result.kind === "missing") {
    return NextResponse.json({ success: false, message: "인보이스를 찾을 수 없습니다." }, { status: 404 });
  }
  if (result.kind === "forbidden") {
    return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });
  }
  if (result.kind === "deleted") {
    return NextResponse.json(
      { success: false, code: "INVOICE_DELETED", message: "삭제된 인보이스는 수정할 수 없습니다." },
      { status: 400 }
    );
  }
  if (result.kind === "linkMissing") return invoiceReservationLinkError("missing");
  if (result.kind === "linkMismatch") return invoiceReservationLinkError("mismatch");

  const updated = await invoiceRef.get();
  return NextResponse.json({ success: true, invoice: docToObj(updated) });
}
