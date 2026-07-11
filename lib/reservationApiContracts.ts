export type JsonRecord = Record<string, unknown>;

export type ReservationApiPayloadMap = {
  create: {
    patient: JsonRecord;
    reservation: JsonRecord;
    confirmNewPatient?: boolean;
    linkToPatientId?: string;
  };
  create_patient: {
    patient: JsonRecord;
    confirmNewPatient?: boolean;
    linkToPatientId?: string;
  };
  update: {
    reservationDocId: string;
    reservationId?: string;
    patientId?: string;
    reservationPatch: JsonRecord;
  };
  toggleSurgery: {
    reservationDocId: string;
    surgeryReserved: boolean;
    staffDisplay?: string;
    staffUid?: string;
  };
  delete: {
    reservationDocId: string;
    staffDisplay?: string;
    staffUid?: string;
  };
  update_patient_profile: {
    patientId: string;
    patientPatch: JsonRecord;
  };
  delete_patient: { patientId: string };
  list_patients: JsonRecord;
  search_patients: { term: string };
  list_patients_summary: { limit?: number; cursor?: string };
  patient_full_history_page: {
    patientId: string;
    cursor?: string;
    limit?: number;
  };
  patient_full_history: { patientId: string };
  read_all: { from?: string; to?: string };
  read_range_all: { from: string; to: string };
  patient_history: { patientId: string; cursor?: string };
  patient_full_history_batch: { patientIds: string[]; before: string };
  read_doctors: JsonRecord;
};

export type ReservationApiAction = keyof ReservationApiPayloadMap;
export type ReservationApiPayload<A extends ReservationApiAction> = ReservationApiPayloadMap[A];

export type ReservationApiRequest<A extends ReservationApiAction = ReservationApiAction> = {
  idToken: string;
  action: A;
  payload: ReservationApiPayload<A>;
};

export type ReservationApiErrorCode =
  | "DISALLOWED_FIELD"
  | "DUPLICATE_RESERVATION"
  | "INVALID_PAYLOAD"
  | "KPI_QUERY_LIMIT_EXCEEDED"
  | "LOCK_OWNERSHIP_MISMATCH"
  | "PATIENT_CANDIDATES"
  | "PATIENT_DELETED"
  | "PATIENT_ID_MISMATCH"
  | "RESERVATION_ID_REQUIRED"
  | "RESERVATION_NOT_FOUND"
  | "UNKNOWN_ACTION";

export type ReservationApiFailure = JsonRecord & {
  success: false;
  message?: string;
  code?: ReservationApiErrorCode | string;
};

export type ReservationApiSuccess = JsonRecord & { success: true };
export type ReservationApiResult<A extends ReservationApiAction = ReservationApiAction> =
  | ReservationApiSuccess
  | ReservationApiFailure;

const RESERVATION_API_ACTIONS = new Set<ReservationApiAction>([
  "create",
  "create_patient",
  "update",
  "toggleSurgery",
  "delete",
  "update_patient_profile",
  "delete_patient",
  "list_patients",
  "search_patients",
  "list_patients_summary",
  "patient_full_history_page",
  "patient_full_history",
  "read_all",
  "read_range_all",
  "patient_history",
  "patient_full_history_batch",
  "read_doctors",
]);

export function isReservationApiAction(value: unknown): value is ReservationApiAction {
  return typeof value === "string" && RESERVATION_API_ACTIONS.has(value as ReservationApiAction);
}
