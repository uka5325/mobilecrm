import { NextRequest, NextResponse } from "next/server";
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
import { createReservationCommand } from "./commands/createReservation";
import { updateReservationCommand } from "./commands/updateReservation";
import { deleteReservationCommand } from "./commands/deleteReservation";
import { toggleSurgeryCommand } from "./commands/toggleSurgery";
import {
  handleReservationReadAction,
  isReservationReadAction,
} from "./queries/readReservations";

type Body = {
  idToken?: string;
  action?: string;
  payload?: Record<string, unknown>;
};

const WRITE_ACTIONS = new Set([
  "create",
  "create_patient",
  "update",
  "toggleSurgery",
  "delete",
  "update_patient_profile",
  "delete_patient",
]);

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

  try {
    const action = body.action;
    const staff = await requireActiveStaff(
      String(body.idToken || ""),
      { checkRevoked: typeof action === "string" && WRITE_ACTIONS.has(action) }
    );
    const payload = body.payload || {};

    if (isReservationReadAction(action)) {
      return handleReservationReadAction(action, payload);
    }

    if (action === "list_patients") return listPatientsRaw();
    if (action === "search_patients") return searchPatientsRaw(payload);
    if (action === "list_patients_summary") return listPatientsSummaryRaw(payload);
    if (action === "patient_amount_rows") return patientAmountRows(payload);
    if (action === "patient_full_history_page") return patientFullHistoryPage(payload);
    if (action === "patient_full_history") return patientFullHistoryExact(payload);
    if (action === "create") return createReservationCommand(payload, staff);
    if (action === "update") return updateReservationCommand(payload, staff);
    if (action === "toggleSurgery") return toggleSurgeryCommand(payload, staff);
    if (action === "delete") return deleteReservationCommand(payload, staff);
    if (action === "update_patient_profile") return runPatientUpdateJob(payload, staff);
    if (action === "delete_patient") return runPatientDeleteJob(payload, staff);
    if (action === "create_patient") return createPatientWithDecision(payload, staff);

    return NextResponse.json(
      { success: false, message: "알 수 없는 action" },
      { status: 400 }
    );
  } catch (error) {
    const response = toAuthErrorResponse(error);
    if (response) return response;
    console.error("[/api/reservations]", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "서버 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}

export { handleReservationRequest as POST };
