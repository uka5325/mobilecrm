import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import type { ReservationApiPayload } from "@/lib/reservationApiContracts";
import {
  writeReservationLogInTx,
  type ReservationCommandContext,
} from "./support";

export async function toggleSurgeryCommand(
  payload: ReservationApiPayload<"toggleSurgery">,
  ctx: ReservationCommandContext
) {
  const reservationDocId = String(payload.reservationDocId || "").trim();
  if (!reservationDocId) {
    return NextResponse.json(
      { success: false, code: "RESERVATION_ID_REQUIRED", message: "reservationDocId가 필요합니다." },
      { status: 400 }
    );
  }

  const surgeryReserved = payload.surgeryReserved === true;
  const now = FieldValue.serverTimestamp();
  const reservationRef = adminDb.collection("reservations").doc(reservationDocId);

  const beforeData = await adminDb.runTransaction<Record<string, unknown> | null>(async (tx) => {
    const beforeSnap = await tx.get(reservationRef);
    if (!beforeSnap.exists) return null;

    const data = beforeSnap.data() as Record<string, unknown>;
    tx.update(reservationRef, {
      surgeryReserved,
      surgeryReservedAt: surgeryReserved ? new Date().toISOString() : "",
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    });
    writeReservationLogInTx(tx, ctx, {
      action: "reservation_update",
      targetId: String(data.reservationId || reservationDocId),
      patientId: String(data.patientId || ""),
      reservationId: String(data.reservationId || ""),
      message: `${ctx.name}님이 수술예약 상태를 ${surgeryReserved ? "예약" : "미예약"}으로 변경했습니다.`,
      before: { surgeryReserved: data.surgeryReserved ?? null },
      after: { surgeryReserved },
      now,
    });
    return data;
  });

  if (!beforeData) {
    return NextResponse.json(
      { success: false, code: "RESERVATION_NOT_FOUND", message: "예약을 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, patientId: String(beforeData.patientId || "") });
}
