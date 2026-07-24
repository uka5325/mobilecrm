import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { docToObj, toSerializable } from "@/lib/adminUtils";

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
