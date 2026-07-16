import { createHash } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import type { requireActiveStaff } from "@/lib/apiAuth";

// 재개 가능한 환자 update/delete job이 공유하는 공통 plumbing
// (lease/청크 커서/멱등 job id/완료 응답). 두 job 파일이 import한다.

export type StaffContext = Awaited<ReturnType<typeof requireActiveStaff>>;
export type JobStep = "patients" | "reservations" | "locks" | "done";

export const CHUNK = 400;
export const MAX_BATCHES_PER_REQUEST = 20;
const LEASE_MS = 60_000;

export function patientMutationJobId(kind: "update" | "delete", patientId: string): string {
  const hash = createHash("sha256").update(patientId).digest("hex");
  return `${kind}_${hash}`;
}

export function queryAfter(
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

export function leaseFields(workerId: string) {
  return {
    leaseOwner: workerId,
    leaseUntilMs: Date.now() + LEASE_MS,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function releaseLease(
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

export function completedResponse(data: Record<string, unknown>, resumed = true) {
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
