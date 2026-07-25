import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { docToObj } from "@/lib/adminUtils";

export type ReservationReadAction =
  | "read_all"
  | "read_range_all"
  | "patient_history"
  | "patient_full_history_batch"
  | "read_doctors";

const READ_ACTIONS = new Set<ReservationReadAction>([
  "read_all",
  "read_range_all",
  "patient_history",
  "patient_full_history_batch",
  "read_doctors",
]);

const READ_ALL_CAP = 500;
const KPI_PAGE_SIZE = 500;
const MAX_KPI_ROWS = 20_000;
const PATIENT_HISTORY_PAGE_SIZE = 10;
const PATIENT_HISTORY_BATCH_CAP = 1_000;
const DOCTORS_CACHE_TTL = 10 * 60 * 1000;

let doctorsCache: Record<string, unknown>[] | null = null;
let doctorsCacheAt = 0;

export function isReservationReadAction(action: unknown): action is ReservationReadAction {
  return typeof action === "string" && READ_ACTIONS.has(action as ReservationReadAction);
}

async function getCachedDoctors(): Promise<Record<string, unknown>[]> {
  if (doctorsCache && Date.now() - doctorsCacheAt < DOCTORS_CACHE_TTL) {
    return doctorsCache;
  }

  const snapshot = await adminDb
    .collection("staff")
    .where("role", "==", "doctor")
    .where("active", "==", true)
    .get();

  doctorsCache = snapshot.docs.map(docToObj);
  doctorsCacheAt = Date.now();
  return doctorsCache;
}

export async function handleReservationReadAction(
  action: ReservationReadAction,
  payload: Record<string, unknown>
) {
  if (action === "read_all") {
    const from = typeof payload.from === "string" ? payload.from : "";
    const to = typeof payload.to === "string" ? payload.to : "";
    const fromDate = from || (() => {
      const date = new Date();
      date.setDate(date.getDate() - 45);
      return date.toISOString().slice(0, 10);
    })();

    let query = adminDb
      .collection("reservations")
      .where("isDeleted", "==", false)
      .where("reservationDate", ">=", fromDate)
      .orderBy("reservationDate", "desc")
      .limit(READ_ALL_CAP);

    if (to) query = query.where("reservationDate", "<=", to) as typeof query;

    const [reservationSnapshot, doctors] = await Promise.all([
      query.get(),
      getCachedDoctors(),
    ]);

    return NextResponse.json({
      success: true,
      reservations: reservationSnapshot.docs.map(docToObj),
      doctors,
      capped: reservationSnapshot.docs.length === READ_ALL_CAP,
    });
  }

  if (action === "read_range_all") {
    const from = typeof payload.from === "string" ? payload.from : "";
    const to = typeof payload.to === "string" ? payload.to : "";
    if (!from || !to) {
      return NextResponse.json(
        { success: false, code: "INVALID_PAYLOAD", message: "조회 기간(from/to)이 필요합니다." },
        { status: 400 }
      );
    }

    const reservations: Record<string, unknown>[] = [];
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let capped = false;

    for (;;) {
      let query = adminDb
        .collection("reservations")
        .where("isDeleted", "==", false)
        .where("reservationDate", ">=", from)
        .where("reservationDate", "<=", to)
        .orderBy("reservationDate", "desc")
        .limit(KPI_PAGE_SIZE);

      if (cursor) query = query.startAfter(cursor) as typeof query;
      const snapshot = await query.get();
      if (snapshot.empty) break;

      for (const document of snapshot.docs) reservations.push(docToObj(document));
      if (reservations.length >= MAX_KPI_ROWS) {
        capped = true;
        break;
      }
      if (snapshot.docs.length < KPI_PAGE_SIZE) break;
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }

    if (capped) {
      return NextResponse.json(
        {
          success: false,
          code: "KPI_QUERY_LIMIT_EXCEEDED",
          message: `조회 기간의 예약이 ${MAX_KPI_ROWS}건을 초과합니다. 기간을 좁혀 다시 조회해 주세요.`,
          limit: MAX_KPI_ROWS,
        },
        { status: 413 }
      );
    }

    return NextResponse.json({ success: true, reservations, capped: false });
  }

  if (action === "patient_history") {
    const patientId = typeof payload.patientId === "string" ? payload.patientId : "";
    const cursorId = typeof payload.cursor === "string" ? payload.cursor : "";
    if (!patientId) {
      return NextResponse.json(
        { success: false, code: "INVALID_PAYLOAD", message: "patientId가 없습니다." },
        { status: 400 }
      );
    }

    let query = adminDb
      .collection("reservations")
      .where("patientId", "==", patientId)
      .where("isDeleted", "==", false)
      .orderBy("reservationDate", "desc")
      .limit(PATIENT_HISTORY_PAGE_SIZE);

    if (cursorId) {
      const cursorDocument = await adminDb.collection("reservations").doc(cursorId).get();
      if (cursorDocument.exists) query = query.startAfter(cursorDocument) as typeof query;
    }

    const snapshot = await query.get();
    const hasMore = snapshot.docs.length === PATIENT_HISTORY_PAGE_SIZE;
    return NextResponse.json({
      success: true,
      reservations: snapshot.docs.map(docToObj),
      nextCursor: hasMore ? snapshot.docs[snapshot.docs.length - 1].id : null,
      hasMore,
    });
  }

  if (action === "patient_full_history_batch") {
    const patientIds = Array.isArray(payload.patientIds)
      ? payload.patientIds.filter((value): value is string => typeof value === "string" && value.length > 0).slice(0, 30)
      : [];
    const before = typeof payload.before === "string" ? payload.before : "";
    if (!patientIds.length || !before) {
      return NextResponse.json(
        { success: false, code: "INVALID_PAYLOAD", message: "patientIds/before가 없습니다." },
        { status: 400 }
      );
    }

    const snapshot = await adminDb
      .collection("reservations")
      .where("patientId", "in", patientIds)
      .where("isDeleted", "==", false)
      .where("reservationDate", "<", before)
      .orderBy("reservationDate", "desc")
      .limit(PATIENT_HISTORY_BATCH_CAP)
      .get();

    const byPatient: Record<string, Record<string, unknown>[]> = {};
    for (const patientId of patientIds) byPatient[patientId] = [];
    for (const document of snapshot.docs) {
      const reservation = docToObj(document);
      const patientId = String(reservation.patientId || "");
      if (byPatient[patientId]) byPatient[patientId].push(reservation);
    }

    return NextResponse.json({ success: true, byPatient });
  }

  const doctors = await getCachedDoctors();
  return NextResponse.json({ success: true, doctors });
}
