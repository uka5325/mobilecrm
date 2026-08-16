import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { makePatientSearchTokens } from "@/lib/searchTokens";
import { createEmptyPatientSummary } from "@/features/patients/jobs/summary/patientSummaryCore";
import { updateReservationSummaryIncrementally } from "@/features/patients/jobs/summary/patientSummaryReservations";
import { safeRecompute } from "@/features/patients/jobs/summary/patientSummaryDirty";
import type { ReservationApiPayload } from "@/features/reservations/domain/reservationApiContracts";
import { identityKeyForPatient } from "@/lib/patientIdentity";
import {
  emptySettlementAggregate,
  surgeryCaseAggregatePatch,
} from "@/lib/surgeryCaseAggregates";
import {
  RESERVATION_LOCKS,
  buildLockDoc,
  isLockStale,
  lockIdForReservation,
} from "@/lib/reservationLocks";
import {
  ALLOWED_PATIENT_CREATE_FIELDS,
  ALLOWED_RESERVATION_CREATE_FIELDS,
  CREATE_SERVER_MANAGED_IGNORE,
  splitPatch,
  writeReservationLog,
  writeReservationLogInTx,
  type ReservationCommandContext,
} from "./support";

class DuplicateReservationError extends Error {}
class PatientDeletedError extends Error {}
class SourceReservationError extends Error {}

function makeGeneratedPatientId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `P-${date}-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}
class PatientCandidatesError extends Error {
  candidates: Array<{
    patientDocId: string;
    patientId: string;
    name: string;
    birth: string;
    phone: string;
    nationality: string;
  }>;

  constructor(candidates: PatientCandidatesError["candidates"]) {
    super("PATIENT_CANDIDATES");
    this.candidates = candidates;
  }
}

export async function createReservationCommand(
  payload: ReservationApiPayload<"create">,
  ctx: ReservationCommandContext
) {
  const patient = payload.patient;
  const reservation = payload.reservation;
  if (!patient || typeof patient !== "object" || !reservation || typeof reservation !== "object") {
    return NextResponse.json(
      { success: false, code: "INVALID_PAYLOAD", message: "patient/reservation 객체가 필요합니다." },
      { status: 400 }
    );
  }

  const { safe: safePatient, disallowed: patientDisallowed } = splitPatch(
    patient,
    ALLOWED_PATIENT_CREATE_FIELDS,
    CREATE_SERVER_MANAGED_IGNORE
  );
  const { safe: safeReservation, disallowed: reservationDisallowed } = splitPatch(
    reservation,
    ALLOWED_RESERVATION_CREATE_FIELDS,
    CREATE_SERVER_MANAGED_IGNORE
  );
  const disallowed = [...patientDisallowed, ...reservationDisallowed];

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

  const patientPatientId = String(safePatient.patientId || "").trim();
  const reservationPatientId = String(safeReservation.patientId || "").trim();
  if (reservationPatientId && patientPatientId && reservationPatientId !== patientPatientId) {
    return NextResponse.json(
      {
        success: false,
        code: "PATIENT_ID_MISMATCH",
        message: "환자 식별자가 일치하지 않습니다.",
      },
      { status: 400 }
    );
  }
  const patientIdGenerated = !patientPatientId && !reservationPatientId;
  const canonicalPatientId = patientPatientId || reservationPatientId || makeGeneratedPatientId();
  safePatient.patientId = canonicalPatientId;
  safePatient.patientIdGenerated = patientIdGenerated;
  safeReservation.patientId = canonicalPatientId;
  safeReservation.patientIdGenerated = patientIdGenerated;

  const reservationDefaults = {
    completed: false,
    cancelled: false,
    surgeryReserved: false,
    invoiceUrl: "",
    invoiceId: "",
    invoiceSheetName: "",
  };

  const reservationId = String(safeReservation.reservationId || "");
  const sourceReservationDocId = String(payload.sourceReservationDocId || "").trim();
  const now = FieldValue.serverTimestamp();
  const authorFields = {
    createdBy: ctx.name,
    createdByUid: ctx.uid,
    updatedBy: ctx.name,
    updatedByUid: ctx.uid,
  };
  const incomingPatientId = String(safePatient.patientId || "");
  const identityKey = identityKeyForPatient(safePatient);
  const reservationRef = adminDb.collection("reservations").doc();
  const generatedCaseRef = adminDb.collection("surgeryCases").doc();

  let resultPatientDocId = "";
  let resultPatientId = canonicalPatientId;
  let createdReservationData: Record<string, unknown> | null = null;
  let linkedExistingPatient = false;
  let staleLockRepaired = false;
  let resultLockId = "";
  let resultSurgeryCaseId = "";

  try {
    await adminDb.runTransaction(async (tx) => {
      if (reservationId) {
        const existingReservation = await tx.get(
          adminDb
            .collection("reservations")
            .where("reservationId", "==", reservationId)
            .where("isDeleted", "==", false)
        );
        if (!existingReservation.empty) throw new DuplicateReservationError();
      }

      let existingPatientDocId = "";
      let linkedPatientId = "";
      if (incomingPatientId) {
        const patientSnap = await tx.get(
          adminDb
            .collection("patients")
            .where("patientId", "==", incomingPatientId)
            .limit(1)
        );
        if (!patientSnap.empty) {
          const existingPatientData = patientSnap.docs[0].data() as Record<string, unknown>;
          if (existingPatientData.isDeleted === true) {
            throw new PatientDeletedError();
          }
          existingPatientDocId = patientSnap.docs[0].id;
          linkedPatientId = String(existingPatientData.patientId || incomingPatientId);
          if (existingPatientData.patientIdGenerated === true) {
            safePatient.patientIdGenerated = true;
            safeReservation.patientIdGenerated = true;
          }
        }
      }

      if (!existingPatientDocId && identityKey) {
        const skipIdentityCheck = payload.confirmNewPatient === true;
        if (!skipIdentityCheck) {
          const identitySnap = await tx.get(
            adminDb
              .collection("patients")
              .where("identityKey", "==", identityKey)
              .where("isDeleted", "==", false)
              .limit(5)
          );
          if (!identitySnap.empty) {
            const candidates = identitySnap.docs.map((doc) => {
              const data = doc.data() as Record<string, unknown>;
              return {
                patientDocId: doc.id,
                patientId: String(data.patientId || ""),
                name: String(data.name || ""),
                birth: String(data.birth || ""),
                phone: String(data.phone || "").replace(
                  /(.{3}).+(.{4})$/,
                  "$1****$2"
                ),
                nationality: String(data.nationality || ""),
              };
            });
            throw new PatientCandidatesError(candidates);
          }
        }

        const linkToPatientId = String(payload.linkToPatientId || "");
        if (linkToPatientId) {
          const linkedPatient = await tx.get(
            adminDb
              .collection("patients")
              .where("patientId", "==", linkToPatientId)
              .where("isDeleted", "==", false)
              .limit(1)
          );
          if (!linkedPatient.empty) {
            const linkedPatientData = linkedPatient.docs[0].data() as Record<string, unknown>;
            existingPatientDocId = linkedPatient.docs[0].id;
            linkedPatientId = linkToPatientId;
            if (linkedPatientData.patientIdGenerated === true) {
              safePatient.patientIdGenerated = true;
              safeReservation.patientIdGenerated = true;
            }
          }
        }
      }

      if (linkedPatientId) {
        safePatient.patientId = linkedPatientId;
        safeReservation.patientId = linkedPatientId;
        resultPatientId = linkedPatientId;
      }

      const sourceReservationRef = sourceReservationDocId
        ? adminDb.collection("reservations").doc(sourceReservationDocId)
        : null;
      const sourceReservationSnap = sourceReservationRef
        ? await tx.get(sourceReservationRef)
        : null;
      const sourceReservation = sourceReservationSnap?.exists
        ? sourceReservationSnap.data() as Record<string, unknown>
        : null;
      if (sourceReservationRef && (
        !sourceReservation
        || sourceReservation.isDeleted === true
        || String(sourceReservation.patientId || "") !== resultPatientId
      )) {
        throw new SourceReservationError();
      }

      const sourceCaseId = String(sourceReservation?.surgeryCaseId || "").trim();
      const surgeryCaseRef = sourceCaseId
        ? adminDb.collection("surgeryCases").doc(sourceCaseId)
        : generatedCaseRef;
      const surgeryCaseSnap = sourceCaseId ? await tx.get(surgeryCaseRef) : null;
      const surgeryCase = surgeryCaseSnap?.exists
        ? surgeryCaseSnap.data() as Record<string, unknown>
        : null;
      if (surgeryCase && String(surgeryCase.patientId || "") !== resultPatientId) {
        throw new SourceReservationError();
      }
      resultSurgeryCaseId = surgeryCaseRef.id;

      // canonical 환자 연결과 generated-ID 정책이 결정된 뒤 중복 lock을 계산한다.
      const lockId = lockIdForReservation(safeReservation);
      resultLockId = lockId;
      const lockRef = lockId
        ? adminDb.collection(RESERVATION_LOCKS).doc(lockId)
        : null;
      if (lockRef) {
        const lockSnap = await tx.get(lockRef);
        if (lockSnap.exists) {
          const targetDocId = String(lockSnap.data()?.reservationDocId || "");
          let targetData: Record<string, unknown> | null = null;
          if (targetDocId) {
            const targetSnap = await tx.get(
              adminDb.collection("reservations").doc(targetDocId)
            );
            targetData = targetSnap.exists
              ? (targetSnap.data() as Record<string, unknown>)
              : null;
          }
          if (!isLockStale(lockId, targetData)) {
            throw new DuplicateReservationError();
          }
          staleLockRepaired = true;
        }
      }

      const afterReservation = {
        ...reservationDefaults,
        ...safeReservation,
        surgeryCaseId: resultSurgeryCaseId,
        isDeleted: false,
      };
      createdReservationData = afterReservation;

      if (lockRef) {
        tx.set(
          lockRef,
          buildLockDoc({
            reservationDocId: reservationRef.id,
            reservationId,
            patientId: resultPatientId,
            lockId,
            now,
          })
        );
      }

      const caseReservationDocIds = Array.from(new Set([
        ...(Array.isArray(surgeryCase?.reservationDocIds)
          ? surgeryCase.reservationDocIds.map(String).filter(Boolean)
          : []),
        sourceReservationDocId,
        reservationRef.id,
      ].filter(Boolean)));
      if (surgeryCase) {
        tx.update(surgeryCaseRef, {
          reservationDocIds: FieldValue.arrayUnion(reservationRef.id),
          updatedAt: now,
          updatedBy: ctx.name,
          updatedByUid: ctx.uid,
        });
      } else {
        tx.set(surgeryCaseRef, {
          patientId: resultPatientId,
          reservationDocIds: caseReservationDocIds,
          primaryReservationDocId: sourceReservationDocId || reservationRef.id,
          invoiceDocId: "",
          invoiceId: "",
          isDeleted: false,
          ...surgeryCaseAggregatePatch(emptySettlementAggregate()),
          createdAt: now,
          createdBy: ctx.name,
          createdByUid: ctx.uid,
          updatedAt: now,
          updatedBy: ctx.name,
          updatedByUid: ctx.uid,
        });
      }
      if (sourceReservationRef && !sourceCaseId) {
        tx.update(sourceReservationRef, {
          surgeryCaseId: resultSurgeryCaseId,
          updatedAt: now,
          updatedBy: ctx.name,
          updatedByUid: ctx.uid,
        });
      }

      if (existingPatientDocId) {
        tx.set(
          reservationRef,
          {
            ...afterReservation,
            ...authorFields,
            createdAt: now,
            updatedAt: now,
          }
        );
        resultPatientDocId = existingPatientDocId;
        linkedExistingPatient = true;
      } else {
        const patientRef = incomingPatientId
          ? adminDb.collection("patients").doc(incomingPatientId)
          : adminDb.collection("patients").doc();
        tx.set(patientRef, {
          ...createEmptyPatientSummary(),
          ...safePatient,
          searchTokens: makePatientSearchTokens(String(safePatient.name || "")),
          identityKey,
          isDeleted: false,
          ...authorFields,
          createdAt: now,
          updatedAt: now,
        });
        tx.set(
          reservationRef,
          {
            ...afterReservation,
            ...authorFields,
            createdAt: now,
            updatedAt: now,
          }
        );
        resultPatientDocId = patientRef.id;
      }

      writeReservationLogInTx(tx, ctx, {
        action: "reservation_create",
        targetId: String(safeReservation.reservationId || reservationRef.id),
        patientId: String(safeReservation.patientId || ""),
        reservationId: String(safeReservation.reservationId || ""),
        message: `${ctx.name}님이 신규 예약을 등록했습니다.`,
        before: null,
        after: {
          name: safeReservation.name ?? "",
          reservationDate: safeReservation.reservationDate ?? "",
          reservationTime: safeReservation.reservationTime ?? "",
          hospital: safeReservation.hospital ?? "",
          appointmentType: safeReservation.appointmentType ?? "",
          linkedExistingPatient,
        },
        now,
      });
    });
  } catch (error) {
    if (error instanceof DuplicateReservationError) {
      return NextResponse.json({
        success: false,
        message: "이미 등록된 예약으로 보여 저장하지 않았습니다.",
        duplicate: true,
      });
    }
    if (error instanceof PatientDeletedError) {
      return NextResponse.json(
        {
          success: false,
          code: "PATIENT_DELETED",
          message: "삭제된 고객입니다. 관리자 복구 후 다시 시도해 주세요.",
        },
        { status: 409 }
      );
    }
    if (error instanceof PatientCandidatesError) {
      return NextResponse.json(
        {
          success: false,
          code: "PATIENT_CANDIDATES",
          message: "유사한 기존 환자가 발견되었습니다. 기존 환자에 연결하거나 새 환자로 등록해 주세요.",
          candidates: error.candidates,
        },
        { status: 409 }
      );
    }
    if (error instanceof SourceReservationError) {
      return NextResponse.json(
        {
          success: false,
          code: "SURGERY_CASE_SOURCE_MISMATCH",
          message: "같은 환자의 유효한 원본 예약만 수술 케이스로 연결할 수 있습니다.",
        },
        { status: 409 }
      );
    }
    throw error;
  }

  if (staleLockRepaired) {
    await writeReservationLog(ctx, {
      action: "STALE_LOCK_REPAIRED",
      targetId: reservationRef.id,
      patientId: String(safeReservation.patientId || ""),
      reservationId,
      message: "생성 중 stale reservation lock을 정리하고 재사용했습니다.",
      before: null,
      after: { lockId: resultLockId, reservationDocId: reservationRef.id },
      now,
    });
  }

  await safeRecompute(
    () => updateReservationSummaryIncrementally({
      patientId: resultPatientId,
      reservationDocId: reservationRef.id,
      before: null,
      after: createdReservationData,
    }),
    "create/reservation",
    resultPatientId
  );

  return NextResponse.json({
    success: true,
    patientDocId: resultPatientDocId,
    reservationDocId: reservationRef.id,
    patientId: resultPatientId,
    surgeryCaseId: resultSurgeryCaseId,
    ...(linkedExistingPatient ? { linkedExistingPatient: true } : {}),
  });
}
