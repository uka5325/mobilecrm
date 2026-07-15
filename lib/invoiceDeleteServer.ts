import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { cleanText } from "@/lib/adminUtils";
import { recomputeInvoiceSummary, safeRecompute } from "@/lib/patientSummary";
import {
  invoiceLog,
  invoiceReservationLinkError,
  invoiceReservationMatches,
  isCoordinatorOf,
  type StaffContext,
} from "@/lib/invoiceConsistencyShared";

export async function deleteInvoiceAtomic(
  payload: Record<string, unknown>,
  ctx: StaffContext
) {
  const invoiceDocId = cleanText(payload.invoiceDocId);
  if (!invoiceDocId) {
    return NextResponse.json({ success: false, message: "인보이스 식별자가 없습니다." }, { status: 400 });
  }

  const invoiceRef = adminDb.collection("invoices").doc(invoiceDocId);
  const result = await adminDb.runTransaction(async (tx) => {
    const invoiceSnap = await tx.get(invoiceRef);
    if (!invoiceSnap.exists) return { kind: "missing" as const };
    const current = invoiceSnap.data() as Record<string, unknown>;
    if (!isCoordinatorOf(current, ctx)) return { kind: "forbidden" as const };
    if (current.isDeleted === true) {
      return { kind: "alreadyDeleted" as const, patientId: cleanText(current.patientId) };
    }

    const reservationDocId = cleanText(current.reservationDocId);
    if (!reservationDocId) return { kind: "linkMissing" as const };
    const reservationRef = adminDb.collection("reservations").doc(reservationDocId);
    const reservationSnap = await tx.get(reservationRef);
    if (!reservationSnap.exists) return { kind: "linkMissing" as const };
    const reservation = reservationSnap.data() as Record<string, unknown>;
    if (!invoiceReservationMatches(current, reservation)) return { kind: "linkMismatch" as const };

    const now = FieldValue.serverTimestamp();
    tx.update(invoiceRef, {
      isDeleted: true,
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    });
    tx.update(reservationRef, {
      invoiceId: "",
      invoiceDocId: "",
      invoiceStatus: "",
      invoiceUpdatedAt: now,
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    });
    tx.set(adminDb.collection("logs").doc(), invoiceLog(ctx, {
      action: "invoice_delete",
      targetId: cleanText(current.invoiceId),
      patientId: cleanText(current.patientId),
      reservationId: cleanText(current.reservationId),
      message: `${ctx.name}님이 인보이스를 삭제했습니다.`,
      before: { invoiceId: current.invoiceId },
    }, now));
    return { kind: "deleted" as const, patientId: cleanText(current.patientId) };
  });

  if (result.kind === "missing") {
    return NextResponse.json({ success: false, message: "인보이스를 찾을 수 없습니다." }, { status: 404 });
  }
  if (result.kind === "forbidden") {
    return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });
  }
  if (result.kind === "alreadyDeleted") {
    return NextResponse.json({ success: true, alreadyDeleted: true });
  }
  if (result.kind === "linkMissing") return invoiceReservationLinkError("missing");
  if (result.kind === "linkMismatch") return invoiceReservationLinkError("mismatch");

  await safeRecompute(
    () => recomputeInvoiceSummary(result.patientId),
    "delete/invoice",
    result.patientId
  );
  return NextResponse.json({ success: true });
}
