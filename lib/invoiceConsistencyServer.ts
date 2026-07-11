import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { cleanText, docToObj } from "@/lib/adminUtils";
import { parseBirthInfo } from "@/lib/invoiceUtils";
import { recomputeInvoiceSummary, safeRecompute } from "@/lib/patientSummary";
import type { requireActiveStaff } from "@/lib/apiAuth";
import { aggregateSettlementRows } from "@/lib/settlementMath";
import { calcCommission } from "@/lib/commissionUtils";

type StaffContext = Awaited<ReturnType<typeof requireActiveStaff>>;

const ALLOWED_INVOICE_STATUS = new Set(["draft", "confirmed", "void"]);

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  const numberValue = Number(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function makeInvoiceId(reservation: Record<string, unknown>) {
  const now = new Date();
  const date = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const name = cleanText(reservation.name || reservation.patientName || "고객")
    .replace(/[\/#?[\]*.]/g, " ")
    .replace(/\s+/g, "")
    .slice(0, 20);
  return `INV-${date}-${name}-${Date.now().toString(36)}`;
}

function isCoordinatorOf(
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

function invoiceLog(
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

function invoiceReservationLinkError(kind: "missing" | "mismatch") {
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

function invoiceReservationMatches(
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

export async function createInvoiceAtomic(
  payload: Record<string, unknown>,
  ctx: StaffContext
) {
  const reservationDocId = cleanText(payload.reservationDocId);
  if (!reservationDocId) {
    return NextResponse.json({ success: false, message: "예약 정보가 없습니다." }, { status: 400 });
  }

  const invoices = adminDb.collection("invoices");
  const reservationRef = adminDb.collection("reservations").doc(reservationDocId);

  const result = await adminDb.runTransaction(async (tx) => {
    const reservationSnap = await tx.get(reservationRef);
    if (!reservationSnap.exists) return { kind: "missing" as const };
    const reservation = reservationSnap.data() as Record<string, unknown>;

    const existingSnap = await tx.get(
      invoices.where("reservationDocId", "==", reservationDocId)
    );
    const existing = existingSnap.docs.find((doc) => doc.data().isDeleted !== true);
    const settlementSnap = await tx.get(
      adminDb.collection("settlements").where("reservationDocId", "==", reservationDocId).limit(501)
    );
    const settlementAggregate = aggregateSettlementRows(
      settlementSnap.docs.map((doc) => doc.data() as Record<string, unknown>)
    );
    if (existing) {
      return {
        kind: "existing" as const,
        invoice: docToObj(existing),
      };
    }

    if (ctx.role !== "admin" && ctx.role !== "coordinator") {
      return { kind: "forbidden" as const, message: "코디네이터만 인보이스를 생성할 수 있습니다." };
    }
    if (ctx.role !== "admin" && !isCoordinatorOf(reservation, ctx)) {
      return { kind: "forbidden" as const, message: "담당 코디네이터만 인보이스를 생성할 수 있습니다." };
    }

    const rawBirth = cleanText(reservation.birthInput || reservation.birth);
    const birthInfo = parseBirthInfo(rawBirth, cleanText(reservation.gender));
    const invoiceId = makeInvoiceId(reservation);
    const invoiceRef = invoices.doc();
    const now = FieldValue.serverTimestamp();
    const invoiceData = {
      invoiceId,
      reservationDocId,
      reservationId: cleanText(reservation.reservationId),
      patientId: cleanText(reservation.patientId),
      patientName: cleanText(reservation.name || reservation.patientName),
      birth: birthInfo.birth,
      birthDisplay: birthInfo.birthDisplay,
      gender: birthInfo.gender,
      nationality: cleanText(reservation.nationality),
      phone: cleanText(reservation.phone),
      doctors: Array.isArray(reservation.doctors) ? reservation.doctors : [],
      coordinators: Array.isArray(reservation.coordinators) ? reservation.coordinators : [],
      coordinatorUids: Array.isArray(reservation.coordinatorUids) ? reservation.coordinatorUids : [],
      hospitalName: cleanText(reservation.hospital),
      surgeryItems: cleanText(reservation.consultArea),
      surgeryDate: cleanText(reservation.reservationDate),
      totalAmount: settlementAggregate.netAmount,
      paymentMethod: settlementAggregate.paymentMethod ?? null,
      cardAmount: settlementAggregate.cardAmount,
      cashAmount: settlementAggregate.cashAmount,
      bankTransferAmount: settlementAggregate.methodTotals.bank_transfer,
      foreignCardAmount: settlementAggregate.methodTotals.foreign_card,
      otherAmount: settlementAggregate.methodTotals.other,
      settlementPaidAmount: settlementAggregate.totalPaid,
      settlementRefundAmount: settlementAggregate.totalRefunded,
      settlementCount: settlementAggregate.count,
      commissionBase: settlementAggregate.commissionBase,
      commissionAmount: null,
      invoiceRevision: 0,
      updatedAfterConfirmation: false,
      memo: "",
      status: "draft",
      createdAt: now,
      createdBy: ctx.name,
      createdByUid: ctx.uid,
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
      isDeleted: false,
    };

    tx.set(invoiceRef, invoiceData);
    tx.update(reservationRef, {
      invoiceId,
      invoiceDocId: invoiceRef.id,
      invoiceStatus: "draft",
      invoiceUpdatedAt: now,
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    });
    tx.set(adminDb.collection("logs").doc(), invoiceLog(ctx, {
      action: "invoice_create",
      targetId: invoiceRef.id,
      patientId: cleanText(reservation.patientId),
      reservationId: cleanText(reservation.reservationId),
      message: `${ctx.name}님이 인보이스를 생성했습니다.`,
      after: { invoiceId, invoiceDocId: invoiceRef.id },
    }, now));

    return {
      kind: "created" as const,
      invoiceDocId: invoiceRef.id,
      patientId: cleanText(reservation.patientId),
    };
  });

  if (result.kind === "missing") {
    return NextResponse.json({ success: false, message: "예약 정보를 찾을 수 없습니다." }, { status: 404 });
  }
  if (result.kind === "forbidden") {
    return NextResponse.json({ success: false, message: result.message }, { status: 403 });
  }
  if (result.kind === "existing") {
    const invoice = result.invoice as Record<string, unknown>;
    if (!isCoordinatorOf(invoice, ctx)) {
      return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });
    }
    return NextResponse.json({ success: true, invoice, alreadyExists: true });
  }

  await safeRecompute(
    () => recomputeInvoiceSummary(result.patientId),
    "create/invoice",
    result.patientId
  );
  const invoiceSnap = await invoices.doc(result.invoiceDocId).get();
  return NextResponse.json({ success: true, invoice: docToObj(invoiceSnap), alreadyExists: false });
}

export async function updateInvoiceAtomic(
  payload: Record<string, unknown>,
  ctx: StaffContext
) {
  const invoiceDocId = cleanText(payload.invoiceDocId);
  if (!invoiceDocId) {
    return NextResponse.json({ success: false, message: "인보이스 식별자가 없습니다." }, { status: 400 });
  }
  if (payload.isDeleted !== undefined) {
    return NextResponse.json(
      { success: false, code: "DISALLOWED_FIELD", message: "허용되지 않은 필드입니다: isDeleted" },
      { status: 400 }
    );
  }
  if (payload.status !== undefined && !ALLOWED_INVOICE_STATUS.has(String(payload.status))) {
    return NextResponse.json({ success: false, message: "유효하지 않은 인보이스 상태입니다." }, { status: 400 });
  }

  const invoiceRef = adminDb.collection("invoices").doc(invoiceDocId);
  const result = await adminDb.runTransaction(async (tx) => {
    const invoiceSnap = await tx.get(invoiceRef);
    if (!invoiceSnap.exists) return { kind: "missing" as const };
    const current = invoiceSnap.data() as Record<string, unknown>;
    if (!isCoordinatorOf(current, ctx)) return { kind: "forbidden" as const };
    if (current.isDeleted === true) return { kind: "deleted" as const };

    const reservationDocId = cleanText(current.reservationDocId);
    if (!reservationDocId) return { kind: "linkMissing" as const };
    const reservationRef = adminDb.collection("reservations").doc(reservationDocId);
    const reservationSnap = await tx.get(reservationRef);
    if (!reservationSnap.exists) return { kind: "linkMissing" as const };
    const reservation = reservationSnap.data() as Record<string, unknown>;
    if (!invoiceReservationMatches(current, reservation)) return { kind: "linkMismatch" as const };
    const settlementSnap = await tx.get(
      adminDb.collection("settlements").where("reservationDocId", "==", reservationDocId).limit(501)
    );
    const settlementAggregate = aggregateSettlementRows(
      settlementSnap.docs.map((doc) => doc.data() as Record<string, unknown>)
    );
    const hasSettlements = settlementAggregate.count > 0;
    const commissionRate = payload.commissionRate !== undefined
      ? toNumber(payload.commissionRate)
      : current.commissionRate !== undefined && current.commissionRate !== null
        ? toNumber(current.commissionRate)
        : null;

    const now = FieldValue.serverTimestamp();
    const patch: Record<string, unknown> = {
      hospitalName: cleanText(payload.hospitalName),
      surgeryItems: cleanText(payload.surgeryItems),
      surgeryDate: cleanText(payload.surgeryDate ?? ""),
      totalAmount: hasSettlements ? settlementAggregate.netAmount : toNumber(payload.totalAmount),
      paymentMethod: hasSettlements ? (settlementAggregate.paymentMethod ?? null) : (payload.paymentMethod ?? null),
      cardAmount: hasSettlements ? settlementAggregate.cardAmount : (payload.cardAmount !== undefined ? toNumber(payload.cardAmount) : null),
      cashAmount: hasSettlements ? settlementAggregate.cashAmount : (payload.cashAmount !== undefined ? toNumber(payload.cashAmount) : null),
      bankTransferAmount: hasSettlements ? settlementAggregate.methodTotals.bank_transfer : (current.bankTransferAmount ?? null),
      foreignCardAmount: hasSettlements ? settlementAggregate.methodTotals.foreign_card : (current.foreignCardAmount ?? null),
      otherAmount: hasSettlements ? settlementAggregate.methodTotals.other : (current.otherAmount ?? null),
      settlementPaidAmount: hasSettlements ? settlementAggregate.totalPaid : (current.settlementPaidAmount ?? null),
      settlementRefundAmount: hasSettlements ? settlementAggregate.totalRefunded : (current.settlementRefundAmount ?? null),
      settlementCount: hasSettlements ? settlementAggregate.count : (current.settlementCount ?? 0),
      commissionRate,
      commissionStaffUid: payload.commissionStaffUid ?? null,
      commissionStaffName: payload.commissionStaffName ?? null,
      commissionBase: hasSettlements ? settlementAggregate.commissionBase : (payload.commissionBase !== undefined ? toNumber(payload.commissionBase) : null),
      commissionAmount: hasSettlements
        ? (commissionRate === null ? null : calcCommission(settlementAggregate.commissionBase, commissionRate))
        : (payload.commissionAmount !== undefined ? toNumber(payload.commissionAmount) : null),
      memo: cleanText(payload.memo),
      doctors: Array.isArray(payload.doctors)
        ? payload.doctors
        : (Array.isArray(current.doctors) ? current.doctors : []),
      status: payload.status || current.status || "draft",
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    };

    tx.update(invoiceRef, patch);
    tx.update(reservationRef, {
      invoiceId: current.invoiceId,
      invoiceDocId,
      invoiceStatus: patch.status,
      invoiceUpdatedAt: now,
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    });
    tx.set(adminDb.collection("logs").doc(), invoiceLog(ctx, {
      action: "invoice_update",
      targetId: cleanText(current.invoiceId),
      patientId: cleanText(current.patientId),
      reservationId: cleanText(current.reservationId),
      message: `${ctx.name}님이 인보이스를 수정했습니다.`,
      after: {
        invoiceId: current.invoiceId,
        totalAmount: patch.totalAmount,
        status: patch.status,
      },
    }, now));
    return { kind: "updated" as const };
  });

  if (result.kind === "missing") {
    return NextResponse.json({ success: false, message: "인보이스를 찾을 수 없습니다." }, { status: 404 });
  }
  if (result.kind === "forbidden") {
    return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });
  }
  if (result.kind === "deleted") {
    return NextResponse.json(
      { success: false, code: "INVOICE_DELETED", message: "삭제된 인보이스는 수정할 수 없습니다." },
      { status: 400 }
    );
  }
  if (result.kind === "linkMissing") return invoiceReservationLinkError("missing");
  if (result.kind === "linkMismatch") return invoiceReservationLinkError("mismatch");

  const updated = await invoiceRef.get();
  return NextResponse.json({ success: true, invoice: docToObj(updated) });
}

export async function deleteInvoiceAtomic(
  payload: Record<string, unknown>,
  ctx: StaffContext
) {
  const invoiceDocId = cleanText(payload.invoiceDocId);
  if (!invoiceDocId) {
    return NextResponse.json({ success: false, message: "인보이스 식별자가 없습니다." }, { status: 400 });
  }

  const invoiceRef = adminDb.collection("invoices").doc(invoiceDocId);
  const result = await adminDb.runTransaction(async (tx) => {
    const invoiceSnap = await tx.get(invoiceRef);
    if (!invoiceSnap.exists) return { kind: "missing" as const };
    const current = invoiceSnap.data() as Record<string, unknown>;
    if (!isCoordinatorOf(current, ctx)) return { kind: "forbidden" as const };
    if (current.isDeleted === true) {
      return { kind: "alreadyDeleted" as const, patientId: cleanText(current.patientId) };
    }

    const reservationDocId = cleanText(current.reservationDocId);
    if (!reservationDocId) return { kind: "linkMissing" as const };
    const reservationRef = adminDb.collection("reservations").doc(reservationDocId);
    const reservationSnap = await tx.get(reservationRef);
    if (!reservationSnap.exists) return { kind: "linkMissing" as const };
    const reservation = reservationSnap.data() as Record<string, unknown>;
    if (!invoiceReservationMatches(current, reservation)) return { kind: "linkMismatch" as const };

    const now = FieldValue.serverTimestamp();
    tx.update(invoiceRef, {
      isDeleted: true,
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    });
    tx.update(reservationRef, {
      invoiceId: "",
      invoiceDocId: "",
      invoiceStatus: "",
      invoiceUpdatedAt: now,
      updatedAt: now,
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    });
    tx.set(adminDb.collection("logs").doc(), invoiceLog(ctx, {
      action: "invoice_delete",
      targetId: cleanText(current.invoiceId),
      patientId: cleanText(current.patientId),
      reservationId: cleanText(current.reservationId),
      message: `${ctx.name}님이 인보이스를 삭제했습니다.`,
      before: { invoiceId: current.invoiceId },
    }, now));
    return { kind: "deleted" as const, patientId: cleanText(current.patientId) };
  });

  if (result.kind === "missing") {
    return NextResponse.json({ success: false, message: "인보이스를 찾을 수 없습니다." }, { status: 404 });
  }
  if (result.kind === "forbidden") {
    return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });
  }
  if (result.kind === "alreadyDeleted") {
    return NextResponse.json({ success: true, alreadyDeleted: true });
  }
  if (result.kind === "linkMissing") return invoiceReservationLinkError("missing");
  if (result.kind === "linkMismatch") return invoiceReservationLinkError("mismatch");

  await safeRecompute(
    () => recomputeInvoiceSummary(result.patientId),
    "delete/invoice",
    result.patientId
  );
  return NextResponse.json({ success: true });
}
