import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { safeRecompute, updateReservationSummaryIncrementally } from "@/lib/patientSummary";
import type { ReservationApiPayload } from "@/lib/reservationApiContracts";
import {
  RESERVATION_LOCKS,
  buildLockDoc,
  isLockStale,
  isReservationActive,
  lockIdForReservation,
} from "@/lib/reservationLocks";
import {
  ALLOWED_RESERVATION_UPDATE_FIELDS,
  splitPatch,
  writeReservationLog,
  writeReservationLogInTx,
  type ReservationCommandContext,
} from "./support";

export async function updateReservationCommand(
  payload: ReservationApiPayload<"update">,
  ctx: ReservationCommandContext
) {
  const { reservationDocId, reservationPatch } = payload;

  const { safe: safeReservationPatch, disallowed } = splitPatch(
    reservationPatch,
    ALLOWED_RESERVATION_UPDATE_FIELDS
  );

  if (disallowed.length) {
    return NextResponse.json(
      {
        success: false,
        code: "DISALLOWED_FIELD",
        message: `허용되지 않은 필드입니다: ${disallowed.join(", ")}`,
      },
      { status: 400 }
    );
  }
  if (!Object.keys(safeReservationPatch).length) {
    return NextResponse.json(
      { success: false, message: "변경할 필드가 없습니다." },
      { status: 400 }
    );
  }

  const now = FieldValue.serverTimestamp();
  const reservationRef = adminDb.collection("reservations").doc(reservationDocId);

  const outcome = await adminDb.runTransaction<
    | { kind: "not_found" }
    | { kind: "duplicate" }
    | { kind: "ownership_mismatch" }
    | {
        kind: "ok";
        canonicalPatientId: string;
        canonicalReservationId: string;
        staleLockRepaired: boolean;
        beforeData: Record<string, unknown>;
        afterData: Record<string, unknown>;
      }
  >(async (tx) => {
    const beforeSnap = await tx.get(reservationRef);
    if (!beforeSnap.exists) return { kind: "not_found" };

    const beforeData = beforeSnap.data() as Record<string, unknown>;
    const canonicalPatientId = String(beforeData.patientId || "");
    const canonicalReservationId = String(beforeData.reservationId || "");
    const effectiveNew = { ...beforeData, ...safeReservationPatch };
    const oldLockId = isReservationActive(beforeData)
      ? lockIdForReservation(beforeData)
      : "";
    const newLockId = isReservationActive(effectiveNew)
      ? lockIdForReservation(effectiveNew)
      : "";

    let createNewLock = false;
    let deleteOldLock = false;
    let staleLockRepaired = false;
    const newLockRef = newLockId
      ? adminDb.collection(RESERVATION_LOCKS).doc(newLockId)
      : null;
    const oldLockRef = oldLockId
      ? adminDb.collection(RESERVATION_LOCKS).doc(oldLockId)
      : null;

    if (newLockRef && newLockId !== oldLockId) {
      const newLockSnap = await tx.get(newLockRef);
      if (newLockSnap.exists) {
        const owner = String(newLockSnap.data()?.reservationDocId || "");
        if (owner !== reservationDocId) {
          let ownerData: Record<string, unknown> | null = null;
          if (owner) {
            const ownerSnap = await tx.get(
              adminDb.collection("reservations").doc(owner)
            );
            ownerData = ownerSnap.exists
              ? (ownerSnap.data() as Record<string, unknown>)
              : null;
          }
          if (!isLockStale(newLockId, ownerData)) return { kind: "duplicate" };
          staleLockRepaired = true;
        }
      }
      createNewLock = true;
    }

    if (oldLockRef && oldLockId !== newLockId) {
      const oldLockSnap = await tx.get(oldLockRef);
      if (oldLockSnap.exists) {
        const owner = String(oldLockSnap.data()?.reservationDocId || "");
        if (owner === reservationDocId) deleteOldLock = true;
        else return { kind: "ownership_mismatch" };
      }
    }

    const beforeChanged: Record<string, unknown> = {};
    for (const key of Object.keys(safeReservationPatch)) {
      beforeChanged[key] = beforeData[key] ?? null;
    }

    tx.update(reservationRef, {
      ...safeReservationPatch,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
      updatedAt: now,
    });

    if (deleteOldLock && oldLockRef) tx.delete(oldLockRef);
    if (createNewLock && newLockRef) {
      tx.set(
        newLockRef,
        buildLockDoc({
          reservationDocId,
          reservationId: canonicalReservationId,
          patientId: canonicalPatientId,
          lockId: newLockId,
          now,
        })
      );
    }

    writeReservationLogInTx(tx, ctx, {
      action: "reservation_update",
      targetId: canonicalReservationId || reservationDocId,
      patientId: canonicalPatientId,
      reservationId: canonicalReservationId,
      message: `${ctx.name}님이 예약 정보를 수정했습니다.`,
      before: beforeChanged,
      after: { ...safeReservationPatch },
      now,
    });

    return {
      kind: "ok",
      canonicalPatientId,
      canonicalReservationId,
      staleLockRepaired,
      beforeData,
      afterData: effectiveNew,
    };
  });

  if (outcome.kind === "not_found") {
    return NextResponse.json(
      { success: false, message: "예약을 찾을 수 없습니다." },
      { status: 400 }
    );
  }
  if (outcome.kind === "duplicate") {
    return NextResponse.json(
      {
        success: false,
        code: "DUPLICATE_RESERVATION",
        message: "동일 조합의 활성 예약이 이미 있어 저장하지 않았습니다.",
        duplicate: true,
      },
      { status: 409 }
    );
  }
  if (outcome.kind === "ownership_mismatch") {
    return NextResponse.json(
      {
        success: false,
        code: "LOCK_OWNERSHIP_MISMATCH",
        message: "예약 lock 소유권이 일치하지 않아 저장하지 않았습니다.",
      },
      { status: 409 }
    );
  }

  if (outcome.staleLockRepaired) {
    await writeReservationLog(ctx, {
      action: "STALE_LOCK_REPAIRED",
      targetId: outcome.canonicalReservationId || reservationDocId,
      patientId: outcome.canonicalPatientId,
      reservationId: outcome.canonicalReservationId,
      message: "수정 중 stale reservation lock을 정리하고 재사용했습니다.",
      before: null,
      after: { reservationDocId },
      now,
    });
  }

  await safeRecompute(
    () => updateReservationSummaryIncrementally({
      patientId: outcome.canonicalPatientId,
      reservationDocId,
      before: outcome.beforeData,
      after: outcome.afterData,
    }),
    "update/reservation",
    outcome.canonicalPatientId
  );

  return NextResponse.json({ success: true, patientId: outcome.canonicalPatientId });
}
