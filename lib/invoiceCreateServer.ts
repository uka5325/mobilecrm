import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { cleanText, docToObj } from "@/lib/adminUtils";
import { parseBirthInfo } from "@/lib/invoiceUtils";
import { recomputeInvoiceSummary, safeRecompute } from "@/lib/patientSummary";
import { aggregateSettlementRows } from "@/lib/settlementMath";
import {
  invoiceLog,
  isCoordinatorOf,
  type StaffContext,
} from "@/lib/invoiceConsistencyShared";

function makeInvoiceId(reservation: Record<string, unknown>) {
  const now = new Date();
  const date = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const name = cleanText(reservation.name || reservation.patientName || "고객")
    .replace(/[\/#?[\]*.]/g, " ")
    .replace(/\s+/g, "")
    .slice(0, 20);
  return `INV-${date}-${name}-${Date.now().toString(36)}`;
}

export async function createInvoiceAtomic(
  payload: Record<string, unknown>,
  ctx: StaffContext
) {
  const reservationDocId = cleanText(payload.reservationDocId);
  if (!reservationDocId) {
    return NextResponse.json({ success: false, message: "예약 정보가 없습니다." }, { status: 400 });
  }

  const invoices = adminDb.collection("invoices");
  const reservationRef = adminDb.collection("reservations").doc(reservationDocId);

  const result = await adminDb.runTransaction(async (tx) => {
    const reservationSnap = await tx.get(reservationRef);
    if (!reservationSnap.exists) return { kind: "missing" as const };
    const reservation = reservationSnap.data() as Record<string, unknown>;

    const existingSnap = await tx.get(
      invoices.where("reservationDocId", "==", reservationDocId)
    );
    const existing = existingSnap.docs.find((doc) => doc.data().isDeleted !== true);
    const settlementSnap = await tx.get(
      adminDb.collection("settlements").where("reservationDocId", "==", reservationDocId).limit(501)
    );
    const settlementAggregate = aggregateSettlementRows(
      settlementSnap.docs.map((doc) => doc.data() as Record<string, unknown>)
    );
    if (existing) {
      return {
        kind: "existing" as const,
        invoice: docToObj(existing),
      };
    }

    if (ctx.role !== "admin" && ctx.role !== "coordinator") {
      return { kind: "forbidden" as const, message: "코디네이터만 인보이스를 생성할 수 있습니다." };
    }
    if (ctx.role !== "admin" && !isCoordinatorOf(reservation, ctx)) {
      return { kind: "forbidden" as const, message: "담당 코디네이터만 인보이스를 생성할 수 있습니다." };
    }

    const rawBirth = cleanText(reservation.birthInput || reservation.birth);
    const birthInfo = parseBirthInfo(rawBirth, cleanText(reservation.gender));
    const invoiceId = makeInvoiceId(reservation);
    const invoiceRef = invoices.doc();
    const now = FieldValue.serverTimestamp();
    const invoiceData = {
      invoiceId,
      reservationDocId,
      reservationId: cleanText(reservation.reservationId),
      patientId: cleanText(reservation.patientId),
      patientName: cleanText(reservation.name || reservation.patientName),
      birth: birthInfo.birth,
      birthDisplay: birthInfo.birthDisplay,
      gender: birthInfo.gender,
      nationality: cleanText(reservation.nationality),
      phone: cleanText(reservation.phone),
      doctors: Array.isArray(reservation.doctors) ? reservation.doctors : [],
      coordinators: Array.isArray(reservation.coordinators) ? reservation.coordinators : [],
      coordinatorUids: Array.isArray(reservation.coordinatorUids) ? reservation.coordinatorUids : [],
      hospitalName: cleanText(reservation.hospital),
      surgeryItems: cleanText(reservation.consultArea),
      surgeryDate: cleanText(reservation.reservationDate),
      totalAmount: settlementAggregate.netAmount,
      paymentMethod: settlementAggregate.paymentMethod ?? null,
      cardAmount: settlementAggregate.cardAmount,
      cashAmount: settlementAggregate.cashAmount,
      bankTransferAmount: settlementAggregate.methodTotals.bank_transfer,
      foreignCardAmount: settlementAggregate.methodTotals.foreign_card,
      otherAmount: settlementAggregate.methodTotals.other,
      settlementPaidAmount: settlementAggregate.totalPaid,
      settlementRefundAmount: settlementAggregate.totalRefunded,
      settlementCount: settlementAggregate.count,
      commissionBase: settlementAggregate.commissionBase,
      commissionAmount: null,
      invoiceRevision: 0,
      updatedAfterConfirmation: false,
      memo: "",
      status: "draft",
      createdAt: now,
      createdBy: ctx.name,
      createdByUid: ctx.uid,
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
      isDeleted: false,
    };

    tx.set(invoiceRef, invoiceData);
    tx.update(reservationRef, {
      invoiceId,
      invoiceDocId: invoiceRef.id,
      invoiceStatus: "draft",
      invoiceUpdatedAt: now,
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    });
    tx.set(adminDb.collection("logs").doc(), invoiceLog(ctx, {
      action: "invoice_create",
      targetId: invoiceRef.id,
      patientId: cleanText(reservation.patientId),
      reservationId: cleanText(reservation.reservationId),
      message: `${ctx.name}님이 인보이스를 생성했습니다.`,
      after: { invoiceId, invoiceDocId: invoiceRef.id },
    }, now));

    return {
      kind: "created" as const,
      invoiceDocId: invoiceRef.id,
      patientId: cleanText(reservation.patientId),
    };
  });

  if (result.kind === "missing") {
    return NextResponse.json({ success: false, message: "예약 정보를 찾을 수 없습니다." }, { status: 404 });
  }
  if (result.kind === "forbidden") {
    return NextResponse.json({ success: false, message: result.message }, { status: 403 });
  }
  if (result.kind === "existing") {
    const invoice = result.invoice as Record<string, unknown>;
    if (!isCoordinatorOf(invoice, ctx)) {
      return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });
    }
    return NextResponse.json({ success: true, invoice, alreadyExists: true });
  }

  await safeRecompute(
    () => recomputeInvoiceSummary(result.patientId),
    "create/invoice",
    result.patientId
  );
  const invoiceSnap = await invoices.doc(result.invoiceDocId).get();
  return NextResponse.json({ success: true, invoice: docToObj(invoiceSnap), alreadyExists: false });
}
