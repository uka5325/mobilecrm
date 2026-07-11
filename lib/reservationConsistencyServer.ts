import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { docToObj, toSerializable } from "@/lib/adminUtils";
import { makePatientSearchTokens } from "@/lib/searchTokens";
import { identityKeyForPatient } from "@/lib/patientIdentity";
import { createEmptyPatientSummary } from "@/lib/patientSummary";
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

export async function listPatientsRaw() {
  const snap = await adminDb.collection("patients")
    .orderBy("createdAt", "desc")
    .limit(2000)
    .get();
  const patients = snap.docs.flatMap((doc) => {
    const data = doc.data();
    return data.isDeleted === true ? [] : [toSerializable({ id: doc.id, ...data })];
  });
  return NextResponse.json({ success: true, patients });
}

export async function searchPatientsRaw(payload: Record<string, unknown>) {
  const term = String(payload.term || "").trim().toLowerCase();
  if (!term) return NextResponse.json({ success: true, patients: [] });
  const snap = await adminDb.collection("patients")
    .where("searchTokens", "array-contains", term)
    .limit(50)
    .get();
  const patients = snap.docs.flatMap((doc) => {
    const data = doc.data();
    return data.isDeleted === true ? [] : [toSerializable({ id: doc.id, ...data })];
  });
  return NextResponse.json({ success: true, patients });
}

export async function listPatientsSummaryRaw(payload: Record<string, unknown>) {
  const t0 = performance.now();
  const cursor = String(payload.cursor || "");
  const pageSize = Math.min(Math.max(Number(payload.limit) || 10, 1), 50);
  let q = adminDb.collection("patients")
    .where("isDeleted", "==", false)
    .orderBy("lastReservationDate", "desc")
    .limit(pageSize);

  let cursorMs = 0;
  if (cursor) {
    const ct0 = performance.now();
    const cursorDoc = await adminDb.collection("patients").doc(cursor).get();
    cursorMs = performance.now() - ct0;
    if (cursorDoc.exists) q = q.startAfter(cursorDoc) as typeof q;
  }

  const qt0 = performance.now();
  const snap = await q.get();
  const queryMs = performance.now() - qt0;

  const st0 = performance.now();
  const patients = snap.docs.map(docToObj);
  const serializeMs = performance.now() - st0;

  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;
  const totalMs = performance.now() - t0;

  const timingParts = [
    `query;dur=${queryMs.toFixed(1)}`,
    `serialize;dur=${serializeMs.toFixed(1)}`,
    `total;dur=${totalMs.toFixed(1)}`,
  ];
  if (cursorMs > 0) timingParts.unshift(`cursor;dur=${cursorMs.toFixed(1)}`);

  return NextResponse.json(
    { success: true, patients, nextCursor, hasMore: Boolean(nextCursor) },
    { headers: { "Server-Timing": timingParts.join(", ") } }
  );
}

export async function patientFullHistoryExact(payload: Record<string, unknown>) {
  const patientId = String(payload.patientId || "");
  if (!patientId) {
    return NextResponse.json({ success: false, message: "patientId가 없습니다." }, { status: 400 });
  }
  const cap = 300;
  const snap = await adminDb.collection("reservations")
    .where("patientId", "==", patientId)
    .where("isDeleted", "==", false)
    .orderBy("reservationDate", "desc")
    .limit(cap + 1)
    .get();
  return NextResponse.json({
    success: true,
    reservations: snap.docs.slice(0, cap).map(docToObj),
    capped: snap.docs.length > cap,
  });
}

export async function patientFullHistoryPage(payload: Record<string, unknown>) {
  const patientId = String(payload.patientId || "");
  if (!patientId) {
    return NextResponse.json({ success: false, message: "patientId가 없습니다." }, { status: 400 });
  }

  const pageSize = Math.min(Math.max(Number(payload.limit) || 10, 1), 50);
  const cursor = String(payload.cursor || "");
  let q = adminDb.collection("reservations")
    .where("patientId", "==", patientId)
    .where("isDeleted", "==", false)
    .orderBy("reservationDate", "desc")
    .limit(pageSize + 1);

  if (cursor) {
    const cursorDoc = await adminDb.collection("reservations").doc(cursor).get();
    if (cursorDoc.exists) q = q.startAfter(cursorDoc) as typeof q;
  }

  const snap = await q.get();
  const docs = snap.docs.slice(0, pageSize);
  const last = docs[docs.length - 1];
  return NextResponse.json({
    success: true,
    reservations: docs.map(docToObj),
    nextCursor: snap.docs.length > pageSize && last ? last.id : null,
    hasMore: snap.docs.length > pageSize,
    capped: false,
  });
}
