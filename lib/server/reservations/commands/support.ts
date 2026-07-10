import { adminDb } from "@/lib/firebaseAdmin";
import type { requireActiveStaff } from "@/lib/apiAuth";
import { hasAmountValue } from "@/lib/reservationAmountRows";

export type ReservationCommandContext = Awaited<ReturnType<typeof requireActiveStaff>>;

export const ALLOWED_RESERVATION_UPDATE_FIELDS = new Set([
  "name", "patientName", "birth", "birthInput", "gender", "phone", "nationality",
  "reservationDate", "reservationTime", "hospital", "appointmentType",
  "completed", "cancelled", "consultArea", "depositAmount", "surgeryCost",
  "coordinators", "doctors",
]);

export const ALLOWED_PATIENT_CREATE_FIELDS = new Set([
  "patientId", "name", "birth", "birthInput", "gender", "phone", "nationality",
]);

export const ALLOWED_RESERVATION_CREATE_FIELDS = new Set([
  "reservationId", "patientId",
  "name", "patientName", "birth", "birthInput", "gender", "phone", "nationality",
  "reservationDate", "reservationTime", "hospital", "appointmentType",
  "depositAmount", "surgeryCost", "consultArea",
  "doctors", "coordinators",
]);

const SERVER_MANAGED_IGNORE = new Set(["updatedBy", "updatedByUid", "updatedAt"]);

export const CREATE_SERVER_MANAGED_IGNORE = new Set([
  "createdBy", "createdByUid", "updatedBy", "updatedByUid",
  "createdAt", "updatedAt", "isDeleted", "searchTokens",
]);

export function splitPatch(
  patch: Record<string, unknown> | undefined | null,
  allowed: Set<string>,
  ignore: Set<string> = SERVER_MANAGED_IGNORE
): { safe: Record<string, unknown>; disallowed: string[] } {
  const safe: Record<string, unknown> = {};
  const disallowed: string[] = [];
  if (!patch || typeof patch !== "object") return { safe, disallowed };
  for (const [key, value] of Object.entries(patch)) {
    if (allowed.has(key)) safe[key] = value;
    else if (!ignore.has(key)) disallowed.push(key);
  }
  return { safe, disallowed };
}

export function withAmountFlags<T extends Record<string, unknown>>(
  data: T
): T & { hasDepositAmount: boolean; hasSurgeryCost: boolean } {
  return {
    ...data,
    hasDepositAmount: hasAmountValue(data.depositAmount),
    hasSurgeryCost: hasAmountValue(data.surgeryCost),
  };
}

export function deriveAmountFlagPatch(patch: Record<string, unknown>): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  if (Object.prototype.hasOwnProperty.call(patch, "depositAmount")) {
    flags.hasDepositAmount = hasAmountValue(patch.depositAmount);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "surgeryCost")) {
    flags.hasSurgeryCost = hasAmountValue(patch.surgeryCost);
  }
  return flags;
}

type ReservationLogParams = {
  action: string;
  targetId: string;
  patientId?: string;
  reservationId?: string;
  message: string;
  before?: unknown;
  after?: unknown;
  now: FirebaseFirestore.FieldValue;
};

function buildReservationLogData(
  ctx: ReservationCommandContext,
  params: ReservationLogParams
) {
  return {
    action: params.action,
    targetType: "reservation",
    targetId: params.targetId,
    staffUid: ctx.uid,
    staffName: ctx.name,
    staffEmail: ctx.email,
    staffRole: ctx.role,
    staffCode: ctx.staffCode,
    patientId: params.patientId || "",
    reservationId: params.reservationId || "",
    invoiceId: "",
    message: params.message,
    before: params.before ?? null,
    after: params.after ?? null,
    createdAt: params.now,
  };
}

export function writeReservationLogInTx(
  tx: FirebaseFirestore.Transaction,
  ctx: ReservationCommandContext,
  params: ReservationLogParams
) {
  tx.set(adminDb.collection("logs").doc(), buildReservationLogData(ctx, params));
}

export function writeReservationLogInBatch(
  batch: FirebaseFirestore.WriteBatch,
  ctx: ReservationCommandContext,
  params: ReservationLogParams
) {
  batch.set(adminDb.collection("logs").doc(), buildReservationLogData(ctx, params));
}

export async function writeReservationLog(
  ctx: ReservationCommandContext,
  params: ReservationLogParams
) {
  await adminDb.collection("logs").add(buildReservationLogData(ctx, params));
}
