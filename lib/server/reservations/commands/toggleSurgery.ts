import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import {
  writeReservationLogInBatch,
  type ReservationCommandContext,
} from "./support";

export async function toggleSurgeryCommand(
  payload: Record<string, unknown>,
  ctx: ReservationCommandContext
) {
  const { reservationDocId, surgeryReserved } = payload as {
    reservationDocId: string;
    surgeryReserved: boolean;
  };

  const now = FieldValue.serverTimestamp();
  const reservationRef = adminDb.collection("reservations").doc(reservationDocId);
  const beforeSnap = await reservationRef.get();
  const beforeData = beforeSnap.exists
    ? (beforeSnap.data() as Record<string, unknown>)
    : {};

  const batch = adminDb.batch();
  batch.update(reservationRef, {
    surgeryReserved,
    surgeryReservedAt: surgeryReserved ? new Date().toISOString() : "",
    updatedAt: now,
    updatedBy: ctx.name,
    updatedByUid: ctx.uid,
  });
  writeReservationLogInBatch(batch, ctx, {
    action: "reservation_update",
    targetId: String(beforeData.reservationId || reservationDocId),
    patientId: String(beforeData.patientId || ""),
    reservationId: String(beforeData.reservationId || ""),
    message: `${ctx.name}님이 수술예약 상태를 ${surgeryReserved ? "예약" : "미예약"}으로 변경했습니다.`,
    before: { surgeryReserved: beforeData.surgeryReserved ?? null },
    after: { surgeryReserved },
    now,
  });
  await batch.commit();

  return NextResponse.json({ success: true });
}
