import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { makePatientSearchTokens } from "@/lib/searchTokens";
import { identityKeyForPatient } from "@/lib/patientIdentity";
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
