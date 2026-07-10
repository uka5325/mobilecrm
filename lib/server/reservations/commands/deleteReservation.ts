import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { recomputeReservationSummary, safeRecompute } from "@/lib/patientSummary";
import {
  RESERVATION_LOCKS,
  isReservationActive,
  lockIdForReservation,
} from "@/lib/reservationLocks";
import { syncReservationAmountRowsInTx } from "@/lib/patientAmountRows";
import {
  writeReservationLogInTx,
  type ReservationCommandContext,
} from "./support";

export async function deleteReservationCommand(
  payload: Record<string, unknown>,
  ctx: ReservationCommandContext
) {
  if (ctx.role !== "admin") {
    return NextResponse.json(
      { success: false, message: "예약 삭제 권한이 없습니다." },
      { status: 403 }
    );
  }

  const { reservationDocId } = payload as { reservationDocId: string };
  const now = FieldValue.serverTimestamp();
  const reservationRef = adminDb.collection("reservations").doc(reservationDocId);
  let deletedData: Record<string, unknown> = {};

  await adminDb.runTransaction(async (tx) => {
    const beforeSnap = await tx.get(reservationRef);
    deletedData = beforeSnap.exists
      ? (beforeSnap.data() as Record<string, unknown>)
      : {};

    const lockId = isReservationActive(deletedData)
      ? lockIdForReservation(deletedData)
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

    if (beforeSnap.exists) {
      await syncReservationAmountRowsInTx(tx, adminDb, ctx, {
        patientId: String(deletedData.patientId || ""),
        reservationDocId,
        before: deletedData,
        after: null,
        now,
      });
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
      targetId: String(deletedData.reservationId || reservationDocId),
      patientId: String(deletedData.patientId || ""),
      reservationId: String(deletedData.reservationId || ""),
      message: `${ctx.name}님이 예약을 삭제 처리했습니다.`,
      before: { isDeleted: deletedData.isDeleted ?? false },
      after: { isDeleted: true },
      now,
    });
  });

  await safeRecompute(
    () => recomputeReservationSummary(String(deletedData.patientId || "")),
    "delete/reservation",
    String(deletedData.patientId || "")
  );

  return NextResponse.json({ success: true });
}
