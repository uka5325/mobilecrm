import { NextRequest, NextResponse } from "next/server";
import { POST as legacyPost } from "../reservations/route";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import {
  createPatientWithDecision,
  listPatientsRaw,
  listPatientsSummaryRaw,
  patientFullHistoryExact,
  searchPatientsRaw,
} from "@/lib/reservationConsistencyServer";

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

export async function POST(req: NextRequest) {
  const body = await req.json() as Body;
  if (body.action === "create") {
    return createReservationWithCanonicalResponse(body);
  }

  const customAction = body.action === "create_patient"
    || body.action === "list_patients"
    || body.action === "search_patients"
    || body.action === "list_patients_summary"
    || body.action === "patient_full_history";
  if (!customAction) return legacyPost(rebuild(body));

  try {
    const staff = await requireActiveStaff(
      String(body.idToken || ""),
      { checkRevoked: body.action === "create_patient" }
    );
    if (body.action === "list_patients") return listPatientsRaw();
    if (body.action === "search_patients") return searchPatientsRaw(body.payload || {});
    if (body.action === "list_patients_summary") return listPatientsSummaryRaw(body.payload || {});
    if (body.action === "patient_full_history") return patientFullHistoryExact(body.payload || {});
    return createPatientWithDecision(body.payload || {}, staff);
  } catch (error) {
    const response = toAuthErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
