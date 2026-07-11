import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { safeRecompute, updateReservationSummaryIncrementally } from "@/lib/patientSummary";
import type { ReservationApiPayload } from "@/lib/reservationApiContracts";
import {
  RESERVATION_LOCKS,
  isReservationActive,
  lockIdForReservation,
} from "@/lib/reservationLocks";
import {
  writeReservationLogInTx,
  type ReservationCommandContext,
} from "./support";

export async function deleteReservationCommand(
  payload: ReservationApiPayload<"delete">,
  ctx: ReservationCommandContext
) {
  if (ctx.role !== "admin") {
    return NextResponse.json(
      { success: false, message: "예약 삭제 권한이 없습니다." },
      { status: 403 }
    );
  }

  const reservationDocId = String(payload.reservationDocId || "").trim();
  if (!reservationDocId) {
    return NextResponse.json(
      { success: false, code: "RESERVATION_ID_REQUIRED", message: "reservationDocId가 필요합니다." },
      { status: 400 }
    );
  }

  const now = FieldValue.serverTimestamp();
  const reservationRef = adminDb.collection("reservations").doc(reservationDocId);

  const deletedData = await adminDb.runTransaction<Record<string, unknown> | null>(async (tx) => {
    const beforeSnap = await tx.get(reservationRef);
    if (!beforeSnap.exists) return null;

    const beforeData = beforeSnap.data() as Record<string, unknown>;
    const lockId = isReservationActive(beforeData)
      ? lockIdForReservation(beforeData)
      : "";
    let lockRef: FirebaseFirestore.DocumentReference | null = null;
    let deleteLock = false;

    if (lockId) {
      lockRef = adminDb.collection(RESERVATION_LOCKS).doc(lockId);
      const lockSnap = await tx.get(lockRef);
      if (
        lockSnap.exists &&
        String(lockSnap.data()?.reservationDocId || "") === reservationDocId
      ) {
        deleteLock = true;
      }
    }

    if (deleteLock && lockRef) tx.delete(lockRef);
    tx.update(reservationRef, {
      isDeleted: true,
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    });
    writeReservationLogInTx(tx, ctx, {
      action: "reservation_delete",
      targetId: String(beforeData.reservationId || reservationDocId),
      patientId: String(beforeData.patientId || ""),
      reservationId: String(beforeData.reservationId || ""),
      message: `${ctx.name}님이 예약을 삭제 처리했습니다.`,
      before: { isDeleted: beforeData.isDeleted ?? false },
      after: { isDeleted: true },
      now,
    });

    return beforeData;
  });

  if (!deletedData) {
    return NextResponse.json(
      { success: false, code: "RESERVATION_NOT_FOUND", message: "예약을 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  const patientId = String(deletedData.patientId || "");
  await safeRecompute(
    () => updateReservationSummaryIncrementally({
      patientId,
      reservationDocId,
      before: deletedData,
      after: null,
    }),
    "delete/reservation",
    patientId
  );

  return NextResponse.json({ success: true, patientId });
}
