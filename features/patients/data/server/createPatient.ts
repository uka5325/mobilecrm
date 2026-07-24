import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { makePatientSearchTokens } from "@/lib/searchTokens";
import { identityKeyForPatient } from "@/lib/patientIdentity";
import { createEmptyPatientSummary } from "@/features/patients/jobs/summary";
import type { requireActiveStaff } from "@/lib/apiAuth";

type StaffContext = Awaited<ReturnType<typeof requireActiveStaff>>;

const PATIENT_FIELDS = new Set([
  "patientId",
  "name",
  "birth",
  "birthInput",
  "gender",
  "phone",
  "nationality",
]);

const PATIENT_IGNORED_FIELDS = new Set([
  "createdBy",
  "createdByUid",
  "updatedBy",
  "updatedByUid",
  "createdAt",
  "updatedAt",
  "isDeleted",
  "searchTokens",
]);

function sanitizePatient(raw: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  const disallowed: string[] = [];
  for (const [key, value] of Object.entries(raw || {})) {
    if (PATIENT_FIELDS.has(key)) safe[key] = value;
    else if (!PATIENT_IGNORED_FIELDS.has(key)) disallowed.push(key);
  }
  return { safe, disallowed };
}

function candidateFromDoc(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = doc.data() as Record<string, unknown>;
  return {
    patientDocId: doc.id,
    patientId: String(data.patientId || ""),
    name: String(data.name || ""),
    birth: String(data.birth || ""),
    phone: String(data.phone || "").replace(/(.{3}).+(.{4})$/, "$1****$2"),
    nationality: String(data.nationality || ""),
  };
}

export async function createPatientWithDecision(
  payload: Record<string, unknown>,
  ctx: StaffContext
) {
  const rawPatient = (payload.patient || {}) as Record<string, unknown>;
  const { safe, disallowed } = sanitizePatient(rawPatient);
  if (disallowed.length) {
    return NextResponse.json(
      { success: false, code: "DISALLOWED_FIELD", message: `허용되지 않은 필드입니다: ${disallowed.join(", ")}` },
      { status: 400 }
    );
  }

  const linkToPatientId = String(payload.linkToPatientId || "");
  const confirmNewPatient = payload.confirmNewPatient === true;
  const identityKey = identityKeyForPatient(safe);

  if (linkToPatientId) {
    const linked = await adminDb.collection("patients")
      .where("patientId", "==", linkToPatientId)
      .where("isDeleted", "==", false)
      .limit(1)
      .get();
    if (linked.empty) {
      return NextResponse.json(
        { success: false, code: "PATIENT_NOT_FOUND", message: "선택한 기존 환자를 찾을 수 없습니다." },
        { status: 400 }
      );
    }
    const doc = linked.docs[0];
    return NextResponse.json({
      success: true,
      patientDocId: doc.id,
      patientId: String(doc.data().patientId || linkToPatientId),
      linkedExistingPatient: true,
    });
  }

  if (identityKey && !confirmNewPatient) {
    const candidates = await adminDb.collection("patients")
      .where("identityKey", "==", identityKey)
      .where("isDeleted", "==", false)
      .limit(5)
      .get();
    if (!candidates.empty) {
      return NextResponse.json({
        success: false,
        code: "PATIENT_CANDIDATES",
        message: "유사한 기존 환자가 발견되었습니다. 기존 환자에 연결하거나 새 환자로 등록해 주세요.",
        candidates: candidates.docs.map(candidateFromDoc),
      }, { status: 409 });
    }
  }

  const incomingPatientId = String(safe.patientId || "");
  const patientRef = incomingPatientId
    ? adminDb.collection("patients").doc(incomingPatientId)
    : adminDb.collection("patients").doc();
  const now = FieldValue.serverTimestamp();

  const result = await adminDb.runTransaction(async (tx) => {
    const existing = await tx.get(patientRef);
    if (existing.exists) {
      if (existing.data()?.isDeleted === true) {
        return { kind: "deleted" as const };
      }
      return {
        kind: "existing" as const,
        patientDocId: existing.id,
        patientId: String(existing.data()?.patientId || incomingPatientId),
      };
    }

    tx.set(patientRef, {
      ...createEmptyPatientSummary(),
      ...safe,
      searchTokens: makePatientSearchTokens(String(safe.name || "")),
      identityKey,
      isDeleted: false,
      createdBy: ctx.name,
      createdByUid: ctx.uid,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
      createdAt: now,
      updatedAt: now,
    });
    tx.set(adminDb.collection("logs").doc(), {
      action: "patient_create",
      targetType: "patient",
      targetId: incomingPatientId || patientRef.id,
      staffUid: ctx.uid,
      staffName: ctx.name,
      staffEmail: ctx.email,
      staffRole: ctx.role,
      staffCode: ctx.staffCode || "",
      patientId: incomingPatientId || patientRef.id,
      reservationId: "",
      invoiceId: "",
      message: `${ctx.name}님이 신규 환자를 등록했습니다.`,
      before: null,
      after: { patientDocId: patientRef.id },
      createdAt: now,
    });
    return {
      kind: "created" as const,
      patientDocId: patientRef.id,
      patientId: incomingPatientId || patientRef.id,
    };
  });

  if (result.kind === "deleted") {
    return NextResponse.json(
      { success: false, code: "PATIENT_DELETED", message: "삭제된 고객입니다. 관리자 복구 후 다시 시도해 주세요." },
      { status: 409 }
    );
  }
  return NextResponse.json({
    success: true,
    patientDocId: result.patientDocId,
    patientId: result.patientId,
    ...(result.kind === "existing" ? { linkedExistingPatient: true } : {}),
  });
}
