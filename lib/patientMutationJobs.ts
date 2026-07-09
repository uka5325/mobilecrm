import { createHash, randomUUID } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { makePatientSearchTokens } from "@/lib/searchTokens";
import { identityKeyForPatient } from "@/lib/patientIdentity";
import { RESERVATION_LOCKS, lockIdForReservation } from "@/lib/reservationLocks";
import { deleteAllAmountRowsForPatient } from "@/lib/patientAmountRows";
import type { requireActiveStaff } from "@/lib/apiAuth";

type StaffContext = Awaited<ReturnType<typeof requireActiveStaff>>;
type JobStep = "patients" | "reservations" | "locks" | "amountRows" | "done";

const CHUNK = 400;
const MAX_BATCHES_PER_REQUEST = 20;
const LEASE_MS = 60_000;
const ALLOWED_PATIENT_FIELDS = new Set([
  "name",
  "birth",
  "birthInput",
  "gender",
  "phone",
  "nationality",
]);
const IGNORED_PATIENT_FIELDS = new Set(["updatedBy", "updatedByUid", "updatedAt"]);

function stableObjectHash(value: Record<string, unknown>): string {
  const ordered = Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]])
  );
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

export function patientMutationJobId(kind: "update" | "delete", patientId: string): string {
  const hash = createHash("sha256").update(patientId).digest("hex");
  return `${kind}_${hash}`;
}

function sanitizePatientPatch(raw: unknown): {
  safe: Record<string, unknown>;
  disallowed: string[];
} {
  const safe: Record<string, unknown> = {};
  const disallowed: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { safe, disallowed };

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (ALLOWED_PATIENT_FIELDS.has(key)) safe[key] = value;
    else if (!IGNORED_PATIENT_FIELDS.has(key)) disallowed.push(key);
  }
  return { safe, disallowed };
}

function queryAfter(
  collectionName: "patients" | "reservations",
  patientId: string,
  cursor: string
) {
  let query = adminDb
    .collection(collectionName)
    .where("patientId", "==", patientId)
    .orderBy(FieldPath.documentId())
    .limit(CHUNK);
  if (cursor) query = query.startAfter(cursor);
  return query;
}

function leaseFields(workerId: string) {
  return {
    leaseOwner: workerId,
    leaseUntilMs: Date.now() + LEASE_MS,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function releaseLease(
  jobRef: FirebaseFirestore.DocumentReference,
  workerId: string,
  extra: Record<string, unknown> = {}
) {
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists || String(snap.data()?.leaseOwner || "") !== workerId) return;
    tx.update(jobRef, {
      ...extra,
      leaseOwner: "",
      leaseUntilMs: 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

function completedResponse(data: Record<string, unknown>, resumed = true) {
  return NextResponse.json({
    success: true,
    resumed,
    updatedPatients: Number(data.updatedPatients || 0),
    updatedReservations: Number(data.updatedReservations || 0),
    deletedPatients: Number(data.deletedPatients || 0),
    deletedReservations: Number(data.deletedReservations || 0),
    deletedLocks: Number(data.deletedLocks || 0),
  });
}

export async function runPatientUpdateJob(
  payload: Record<string, unknown>,
  ctx: StaffContext
) {
  const patientId = String(payload.patientId || "").trim();
  if (!patientId) {
    return NextResponse.json({ success: false, message: "patientId가 없습니다." }, { status: 400 });
  }

  const { safe, disallowed } = sanitizePatientPatch(payload.patientPatch);
  if (disallowed.length) {
    return NextResponse.json(
      { success: false, code: "DISALLOWED_FIELD", message: `허용되지 않은 필드입니다: ${disallowed.join(", ")}` },
      { status: 400 }
    );
  }
  if (!Object.keys(safe).length) {
    return NextResponse.json({ success: false, message: "변경할 필드가 없습니다." }, { status: 400 });
  }

  const patientSnap = await adminDb
    .collection("patients")
    .where("patientId", "==", patientId)
    .limit(1)
    .get();
  if (patientSnap.empty) {
    return NextResponse.json({ success: false, message: "해당 환자를 찾을 수 없습니다." }, { status: 404 });
  }

  const identityBase = patientSnap.docs[0].data() as Record<string, unknown>;
  const mutationHash = stableObjectHash(safe);
  const workerId = randomUUID();
  const jobRef = adminDb.collection("patientUpdateJobs").doc(patientMutationJobId("update", patientId));

  const claim = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : {};
    const status = String(data.status || "");
    const existingHash = String(data.mutationHash || "");

    if (status === "completed" && existingHash === mutationHash) {
      return { kind: "completed" as const, data };
    }

    const activeLease = Number(data.leaseUntilMs || 0) > Date.now();
    if (activeLease && String(data.leaseOwner || "") !== workerId) {
      return { kind: "busy" as const };
    }

    if (snap.exists && status !== "completed" && existingHash && existingHash !== mutationHash) {
      return { kind: "conflict" as const };
    }

    const reset = !snap.exists || status === "completed" || existingHash !== mutationHash;
    const common = {
      patientId,
      mutationHash,
      patientPatch: safe,
      status: "in_progress",
      staffUid: ctx.uid,
      staffName: ctx.name,
      staffEmail: ctx.email,
      staffRole: ctx.role,
      staffCode: ctx.staffCode || "",
      ...leaseFields(workerId),
    };

    if (reset) {
      tx.set(jobRef, {
        ...common,
        step: "patients",
        patientCursor: "",
        reservationCursor: "",
        updatedPatients: 0,
        updatedReservations: 0,
        error: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.update(jobRef, { ...common, error: null });
    }
    return { kind: "claimed" as const };
  });

  if (claim.kind === "completed") return completedResponse(claim.data);
  if (claim.kind === "busy") {
    return NextResponse.json(
      { success: false, code: "PATIENT_UPDATE_IN_PROGRESS", message: "동일 환자 수정 작업이 이미 진행 중입니다." },
      { status: 409 }
    );
  }
  if (claim.kind === "conflict") {
    return NextResponse.json(
      { success: false, code: "PATIENT_UPDATE_PENDING", message: "이전 환자 수정 작업이 미완료 상태입니다. 같은 내용을 다시 저장해 복구한 뒤 재시도해 주세요." },
      { status: 409 }
    );
  }

  try {
    for (let iteration = 0; iteration < MAX_BATCHES_PER_REQUEST; iteration += 1) {
      const jobSnap = await jobRef.get();
      const job = jobSnap.data() as Record<string, unknown>;
      const step = String(job.step || "patients") as JobStep;
      const storedPatch = (job.patientPatch || safe) as Record<string, unknown>;
      const now = FieldValue.serverTimestamp();
      const audit = { updatedAt: now, updatedBy: ctx.name, updatedByUid: ctx.uid };

      if (step === "patients") {
        const cursor = String(job.patientCursor || "");
        const snap = await queryAfter("patients", patientId, cursor).get();
        const base = snap.docs[0]?.data() as Record<string, unknown> | undefined;
        const nextIdentityKey = identityKeyForPatient({ ...(base || identityBase), ...storedPatch });
        const patientUpdate = {
          ...storedPatch,
          ...(storedPatch.name !== undefined
            ? { searchTokens: makePatientSearchTokens(String(storedPatch.name || "")) }
            : {}),
          identityKey: nextIdentityKey,
          ...audit,
        };
        const batch = adminDb.batch();
        for (const doc of snap.docs) batch.update(doc.ref, patientUpdate);
        const nextCursor = snap.docs.at(-1)?.id || cursor;
        const nextStep: JobStep = snap.size < CHUNK ? "reservations" : "patients";
        batch.update(jobRef, {
          step: nextStep,
          patientCursor: nextCursor,
          updatedPatients: Number(job.updatedPatients || 0) + snap.size,
          ...leaseFields(workerId),
        });
        await batch.commit();
        continue;
      }

      if (step === "reservations") {
        const cursor = String(job.reservationCursor || "");
        const snap = await queryAfter("reservations", patientId, cursor).get();
        const reservationPatch: Record<string, unknown> = { ...storedPatch, ...audit };
        if (storedPatch.name !== undefined) reservationPatch.patientName = storedPatch.name;

        const activeDocs = snap.docs.filter((doc) => doc.data().isDeleted !== true);
        const batch = adminDb.batch();
        for (const doc of activeDocs) batch.update(doc.ref, reservationPatch);
        const nextCursor = snap.docs.at(-1)?.id || cursor;
        const nextStep: JobStep = snap.size < CHUNK ? "done" : "reservations";
        batch.update(jobRef, {
          step: nextStep,
          reservationCursor: nextCursor,
          updatedReservations: Number(job.updatedReservations || 0) + activeDocs.length,
          ...leaseFields(workerId),
        });
        await batch.commit();
        continue;
      }

      if (step === "done") {
        const latest = (await jobRef.get()).data() as Record<string, unknown>;
        const logRef = adminDb.collection("logs").doc(`patient-update-${jobRef.id}-${mutationHash}`);
        const batch = adminDb.batch();
        batch.set(logRef, {
          action: "patient_update",
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
          message: `${ctx.name}님이 환자 정보를 수정했습니다.`,
          before: null,
          after: {
            changedFields: Object.keys(safe).sort(),
            updatedPatients: Number(latest.updatedPatients || 0),
            updatedReservations: Number(latest.updatedReservations || 0),
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
      { success: false, code: "PATIENT_UPDATE_CONTINUE", message: "환자 수정 작업이 진행 중입니다. 다시 저장하면 마지막 단계부터 이어서 처리됩니다." },
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
            depositCount: 0,
            surgeryCostCount: 0,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: ctx.name,
            updatedByUid: ctx.uid,
          });
        }
        const nextCursor = snap.docs.at(-1)?.id || cursor;
        const nextStep: JobStep = snap.size < CHUNK ? "amountRows" : "patients";
        batch.update(jobRef, {
          step: nextStep,
          patientCursor: nextCursor,
          deletedPatients: Number(job.deletedPatients || 0) + activeDocs.length,
          ...leaseFields(workerId),
        });
        await batch.commit();
        continue;
      }

      if (step === "amountRows") {
        // 예약금·수술비 묶음 materialized 문서(patientAmountRows) 정리 — 환자당 그룹 수가
        // 적어(수십 건 이내) 커서 재개 없이 1회 호출로 처리한다.
        await deleteAllAmountRowsForPatient(adminDb, patientId);
        await jobRef.update({
          step: "done",
          ...leaseFields(workerId),
        });
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
