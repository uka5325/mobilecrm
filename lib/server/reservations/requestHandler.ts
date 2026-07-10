import { NextRequest, NextResponse } from "next/server";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import {
  isReservationApiAction,
  type JsonRecord,
  type ReservationApiAction,
  type ReservationApiPayload,
} from "@/lib/reservationApiContracts";
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

type RawBody = {
  idToken?: unknown;
  action?: unknown;
  payload?: unknown;
};

const WRITE_ACTIONS: ReadonlySet<ReservationApiAction> = new Set([
  "create",
  "create_patient",
  "update",
  "toggleSurgery",
  "delete",
  "update_patient_profile",
  "delete_patient",
]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function handleReservationRequest(req: NextRequest) {
  let body: RawBody;
  try {
    body = await req.json() as RawBody;
  } catch {
    return NextResponse.json(
      { success: false, code: "INVALID_PAYLOAD", message: "요청 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const action = body.action;
  if (!isReservationApiAction(action)) {
    return NextResponse.json(
      { success: false, code: "UNKNOWN_ACTION", message: "알 수 없는 action" },
      { status: 400 }
    );
  }
  const payload = isRecord(body.payload) ? body.payload : {};

  try {
    const staff = await requireActiveStaff(
      String(body.idToken || ""),
      { checkRevoked: WRITE_ACTIONS.has(action) }
    );

    if (isReservationReadAction(action)) {
      return handleReservationReadAction(action, payload);
    }

    if (action === "list_patients") return listPatientsRaw();
    if (action === "search_patients") return searchPatientsRaw(payload);
    if (action === "list_patients_summary") return listPatientsSummaryRaw(payload);
    if (action === "patient_amount_rows") return patientAmountRows(payload);
    if (action === "patient_full_history_page") return patientFullHistoryPage(payload);
    if (action === "patient_full_history") return patientFullHistoryExact(payload);
    if (action === "create") {
      return createReservationCommand(payload as ReservationApiPayload<"create">, staff);
    }
    if (action === "update") {
      return updateReservationCommand(payload as ReservationApiPayload<"update">, staff);
    }
    if (action === "toggleSurgery") {
      return toggleSurgeryCommand(payload as ReservationApiPayload<"toggleSurgery">, staff);
    }
    if (action === "delete") {
      return deleteReservationCommand(payload as ReservationApiPayload<"delete">, staff);
    }
    if (action === "update_patient_profile") return runPatientUpdateJob(payload, staff);
    if (action === "delete_patient") return runPatientDeleteJob(payload, staff);
    return createPatientWithDecision(payload, staff);
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
