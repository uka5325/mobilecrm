import { NextRequest, NextResponse } from "next/server";
import { POST as legacyPost } from "./legacyHandler";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import {
  createPatientWithDecision,
  listPatientsRaw,
  listPatientsSummaryRaw,
  patientAmountRows,
  patientFullHistoryPage,
  patientFullHistoryExact,
  searchPatientsRaw,
} from "@/lib/reservationConsistencyServer";
import {
  runPatientDeleteJob,
  runPatientUpdateJob,
} from "@/lib/patientMutationJobs";

type Body = {
  idToken?: string;
  action?: string;
  payload?: Record<string, unknown>;
};

function rebuild(body: Body) {
  return new NextRequest("http://localhost/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createReservationWithCanonicalResponse(body: Body) {
  const response = await legacyPost(rebuild(body));
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || result.success !== true) {
    return NextResponse.json(result, { status: response.status });
  }

  const reservation = (body.payload?.reservation || {}) as Record<string, unknown>;
  return NextResponse.json({
    ...result,
    patientId: String(reservation.patientId || ""),
  }, { status: response.status });
}

export async function handleReservationRequest(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return NextResponse.json(
      { success: false, message: "요청 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  if (body.action === "create") {
    return createReservationWithCanonicalResponse(body);
  }

  const customAction = body.action === "create_patient"
    || body.action === "list_patients"
    || body.action === "search_patients"
    || body.action === "list_patients_summary"
    || body.action === "patient_amount_rows"
    || body.action === "patient_full_history_page"
    || body.action === "patient_full_history"
    || body.action === "update_patient_profile"
    || body.action === "delete_patient";
  if (!customAction) return legacyPost(rebuild(body));

  try {
    const writeAction = body.action === "create_patient"
      || body.action === "update_patient_profile"
      || body.action === "delete_patient";
    const staff = await requireActiveStaff(
      String(body.idToken || ""),
      { checkRevoked: writeAction }
    );
    const payload = body.payload || {};

    if (body.action === "list_patients") return listPatientsRaw();
    if (body.action === "search_patients") return searchPatientsRaw(payload);
    if (body.action === "list_patients_summary") return listPatientsSummaryRaw(payload);
    if (body.action === "patient_amount_rows") return patientAmountRows(payload);
    if (body.action === "patient_full_history_page") return patientFullHistoryPage(payload);
    if (body.action === "patient_full_history") return patientFullHistoryExact(payload);
    if (body.action === "update_patient_profile") return runPatientUpdateJob(payload, staff);
    if (body.action === "delete_patient") return runPatientDeleteJob(payload, staff);
    return createPatientWithDecision(payload, staff);
  } catch (error) {
    const response = toAuthErrorResponse(error);
    if (response) return response;
    console.error("[/api/reservations]", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export { handleReservationRequest as POST };
