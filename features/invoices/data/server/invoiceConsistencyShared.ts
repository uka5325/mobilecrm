import { NextResponse } from "next/server";
import { cleanText } from "@/lib/adminUtils";
import type { requireActiveStaff } from "@/lib/apiAuth";

// 인보이스 원자 트랜잭션(create/update/delete)이 공유하는 타입·권한·로그·연결검증 헬퍼.

export type StaffContext = Awaited<ReturnType<typeof requireActiveStaff>>;

export function isCoordinatorOf(
  invoice: Record<string, unknown>,
  ctx: StaffContext
) {
  if (ctx.role === "admin") return true;
  const coordinatorUids = Array.isArray(invoice.coordinatorUids)
    ? invoice.coordinatorUids as string[]
    : [];
  if (coordinatorUids.length) return coordinatorUids.includes(ctx.uid);
  const coordinators = Array.isArray(invoice.coordinators)
    ? invoice.coordinators as string[]
    : [];
  return Boolean(ctx.name) && coordinators.includes(ctx.name);
}

export function invoiceLog(
  ctx: StaffContext,
  params: {
    action: string;
    targetId: string;
    patientId: string;
    reservationId: string;
    message: string;
    before?: unknown;
    after?: unknown;
  },
  now: FirebaseFirestore.FieldValue
) {
  return {
    action: params.action,
    targetType: "invoice",
    targetId: params.targetId,
    staffUid: ctx.uid,
    staffName: ctx.name,
    staffEmail: ctx.email,
    staffRole: ctx.role,
    staffCode: ctx.staffCode || "",
    patientId: params.patientId,
    reservationId: params.reservationId,
    invoiceId: params.targetId,
    message: params.message,
    before: params.before ?? null,
    after: params.after ?? null,
    createdAt: now,
  };
}

export function invoiceReservationLinkError(kind: "missing" | "mismatch") {
  if (kind === "missing") {
    return NextResponse.json(
      {
        success: false,
        code: "INVOICE_RESERVATION_LINK_MISSING",
        message: "예약 연결 정보가 없거나 유효하지 않은 인보이스입니다. 관리자에게 백필 검사를 요청해주세요.",
      },
      { status: 409 }
    );
  }
  return NextResponse.json(
    {
      success: false,
      code: "INVOICE_RESERVATION_LINK_MISMATCH",
      message: "인보이스와 예약의 환자 또는 예약 식별자가 일치하지 않습니다. 관리자 검토가 필요합니다.",
    },
    { status: 409 }
  );
}

export function invoiceReservationMatches(
  invoice: Record<string, unknown>,
  reservation: Record<string, unknown>
): boolean {
  const invoicePatientId = cleanText(invoice.patientId);
  const reservationPatientId = cleanText(reservation.patientId);
  if (invoicePatientId && reservationPatientId && invoicePatientId !== reservationPatientId) return false;

  const invoiceReservationId = cleanText(invoice.reservationId);
  const reservationReservationId = cleanText(reservation.reservationId);
  if (
    invoiceReservationId &&
    reservationReservationId &&
    invoiceReservationId !== reservationReservationId
  ) return false;

  return true;
}
