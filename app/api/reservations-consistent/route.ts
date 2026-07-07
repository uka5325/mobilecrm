import { NextRequest } from "next/server";
import { POST as legacyPost } from "../reservations/route";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import {
  createPatientWithDecision,
  listPatientsRaw,
  searchPatientsRaw,
} from "@/lib/reservationConsistencyServer";

export async function POST(req: NextRequest) {
  const legacyRequest = req.clone();
  const body = await req.json() as {
    idToken?: string;
    action?: string;
    payload?: Record<string, unknown>;
  };

  const customAction = body.action === "create_patient"
    || body.action === "list_patients"
    || body.action === "search_patients";
  if (!customAction) return legacyPost(legacyRequest);

  try {
    const staff = await requireActiveStaff(
      String(body.idToken || ""),
      { checkRevoked: body.action === "create_patient" }
    );
    if (body.action === "list_patients") return listPatientsRaw();
    if (body.action === "search_patients") return searchPatientsRaw(body.payload || {});
    return createPatientWithDecision(body.payload || {}, staff);
  } catch (error) {
    const response = toAuthErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
