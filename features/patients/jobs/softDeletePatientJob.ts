import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { RESERVATION_LOCKS, lockIdForReservation } from "@/lib/reservationLocks";
import {
  CHUNK,
  MAX_BATCHES_PER_REQUEST,
  completedResponse,
  leaseFields,
  patientMutationJobId,
  queryAfter,
  releaseLease,
  type JobStep,
  type StaffContext,
} from "./patientJobShared";

export async function runPatientDeleteJob(
  payload: Record<string, unknown>,
  ctx: StaffContext
) {
  if (ctx.role !== "admin") {
    return NextResponse.json({ success: false, message: "환자 삭제 권한이 없습니다." }, { status: 403 });
  }

  const patientId = String(payload.patientId || "").trim();
  if (!patientId) {
    return NextResponse.json({ success: false, message: "patientId가 없습니다." }, { status: 400 });
  }

  const workerId = randomUUID();
  const jobRef = adminDb.collection("patientDeletionJobs").doc(patientMutationJobId("delete", patientId));

  const claim = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : {};
    if (String(data.status || "") === "completed") {
      return { kind: "completed" as const, data };
    }
    if (Number(data.leaseUntilMs || 0) > Date.now()) {
      return { kind: "busy" as const };
    }

    const common = {
      patientId,
      status: "in_progress",
      staffUid: ctx.uid,
      staffName: ctx.name,
      staffEmail: ctx.email,
      staffRole: ctx.role,
      staffCode: ctx.staffCode || "",
      error: null,
      ...leaseFields(workerId),
    };
    if (snap.exists) {
      tx.update(jobRef, common);
    } else {
      tx.set(jobRef, {
        ...common,
        step: "locks",
        lockCursor: "",
        reservationCursor: "",
        patientCursor: "",
        deletedLocks: 0,
        deletedReservations: 0,
        deletedPatients: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return { kind: "claimed" as const };
  });

  if (claim.kind === "completed") return completedResponse(claim.data);
  if (claim.kind === "busy") {
    return NextResponse.json(
      { success: false, code: "PATIENT_DELETE_IN_PROGRESS", message: "동일 환자 삭제 작업이 이미 진행 중입니다." },
      { status: 409 }
    );
  }

  try {
    for (let iteration = 0; iteration < MAX_BATCHES_PER_REQUEST; iteration += 1) {
      const jobSnap = await jobRef.get();
      const job = jobSnap.data() as Record<string, unknown>;
      const step = String(job.step || "locks") as JobStep;

      if (step === "locks") {
        const cursor = String(job.lockCursor || "");
        const snap = await queryAfter("reservations", patientId, cursor).get();
        const ownersByLock = new Map<string, Set<string>>();
        for (const doc of snap.docs) {
          const lockId = lockIdForReservation(doc.data() as Record<string, unknown>);
          if (!lockId) continue;
          const owners = ownersByLock.get(lockId) || new Set<string>();
          owners.add(doc.id);
          ownersByLock.set(lockId, owners);
        }

        const lockEntries = [...ownersByLock.entries()];
        const lockRefs = lockEntries.map(([lockId]) => adminDb.collection(RESERVATION_LOCKS).doc(lockId));
        const lockSnaps = lockRefs.length ? await adminDb.getAll(...lockRefs) : [];
        const batch = adminDb.batch();
        let deletedLocks = 0;
        lockSnaps.forEach((lockSnap, index) => {
          if (!lockSnap.exists) return;
          const reservationDocId = String(lockSnap.data()?.reservationDocId || "");
          if (lockEntries[index][1].has(reservationDocId)) {
            batch.delete(lockSnap.ref);
            deletedLocks += 1;
          }
        });

        const nextCursor = snap.docs.at(-1)?.id || cursor;
        const nextStep: JobStep = snap.size < CHUNK ? "reservations" : "locks";
        batch.update(jobRef, {
          step: nextStep,
          lockCursor: nextCursor,
          deletedLocks: Number(job.deletedLocks || 0) + deletedLocks,
          ...leaseFields(workerId),
        });
        await batch.commit();
        continue;
      }

      if (step === "reservations") {
        const cursor = String(job.reservationCursor || "");
        const snap = await queryAfter("reservations", patientId, cursor).get();
        const activeDocs = snap.docs.filter((doc) => doc.data().isDeleted !== true);
        const batch = adminDb.batch();
        for (const doc of activeDocs) {
          batch.update(doc.ref, {
            isDeleted: true,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: ctx.name,
            updatedByUid: ctx.uid,
          });
        }
        const nextCursor = snap.docs.at(-1)?.id || cursor;
        const nextStep: JobStep = snap.size < CHUNK ? "patients" : "reservations";
        batch.update(jobRef, {
          step: nextStep,
          reservationCursor: nextCursor,
          deletedReservations: Number(job.deletedReservations || 0) + activeDocs.length,
          ...leaseFields(workerId),
        });
        await batch.commit();
        continue;
      }

      if (step === "patients") {
        const cursor = String(job.patientCursor || "");
        const snap = await queryAfter("patients", patientId, cursor).get();
        const activeDocs = snap.docs.filter((doc) => doc.data().isDeleted !== true);
        const batch = adminDb.batch();
        for (const doc of activeDocs) {
          batch.update(doc.ref, {
            isDeleted: true,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: ctx.name,
            updatedByUid: ctx.uid,
          });
        }
        const nextCursor = snap.docs.at(-1)?.id || cursor;
        const nextStep: JobStep = snap.size < CHUNK ? "done" : "patients";
        batch.update(jobRef, {
          step: nextStep,
          patientCursor: nextCursor,
          deletedPatients: Number(job.deletedPatients || 0) + activeDocs.length,
          ...leaseFields(workerId),
        });
        await batch.commit();
        continue;
      }

      if (step === "done") {
        const latest = (await jobRef.get()).data() as Record<string, unknown>;
        const logRef = adminDb.collection("logs").doc(`patient-delete-${jobRef.id}`);
        const batch = adminDb.batch();
        batch.set(logRef, {
          action: "patient_delete",
          targetType: "patient",
          targetId: patientId,
          staffUid: ctx.uid,
          staffName: ctx.name,
          staffEmail: ctx.email,
          staffRole: ctx.role,
          staffCode: ctx.staffCode || "",
          patientId,
          reservationId: "",
          invoiceId: "",
          message: `${ctx.name}님이 환자와 전체 예약을 삭제했습니다.`,
          before: null,
          after: {
            deletedLocks: Number(latest.deletedLocks || 0),
            deletedReservations: Number(latest.deletedReservations || 0),
            deletedPatients: Number(latest.deletedPatients || 0),
          },
          createdAt: FieldValue.serverTimestamp(),
        });
        batch.update(jobRef, {
          status: "completed",
          error: null,
          leaseOwner: "",
          leaseUntilMs: 0,
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        await batch.commit();
        return completedResponse(latest, false);
      }
    }

    await releaseLease(jobRef, workerId, { status: "in_progress" });
    return NextResponse.json(
      { success: false, code: "PATIENT_DELETE_CONTINUE", message: "환자 삭제 작업이 진행 중입니다. 다시 삭제하면 마지막 단계부터 이어서 처리됩니다." },
      { status: 202 }
    );
  } catch (error) {
    await releaseLease(jobRef, workerId, {
      status: "in_progress",
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    }).catch(() => {});
    throw error;
  }
}
