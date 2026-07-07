import { NextRequest } from "next/server";
import { POST as legacyPost } from "../reservations/route";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import { createPatientWithDecision } from "@/lib/reservationConsistencyServer";

export async function POST(req: NextRequest) {
  const legacyRequest = req.clone();
  const body = await req.json() as {
    idToken?: string;
    action?: string;
    payload?: Record<string, unknown>;
  };

  if (body.action !== "create_patient") {
    return legacyPost(legacyRequest);
  }

  try {
    const staff = await requireActiveStaff(String(body.idToken || ""), { checkRevoked: true });
    return createPatientWithDecision(body.payload || {}, staff);
  } catch (error) {
    const response = toAuthErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
