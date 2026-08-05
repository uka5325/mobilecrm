import { NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { cleanText, toSerializable } from "@/lib/adminUtils";
import { calcCommission } from "@/lib/commissionUtils";
import {
  aggregateSettlementRows,
  isSettlementPaymentMethod,
  settlementAmount,
  type SettlementCategory,
  type SettlementDirection,
  type SettlementMathRow,
} from "@/lib/settlementMath";
import type { requireActiveStaff } from "@/lib/apiAuth";
import {
  aggregateFromSurgeryCase,
  applySettlementDelta,
  emptySettlementAggregate,
  surgeryCaseAggregatePatch,
} from "@/lib/surgeryCaseAggregates";

const MAX_SETTLEMENTS_PER_PATIENT = 500;
const MAX_SETTLEMENTS_PER_CASE = 500;
const MAX_SALES_ROWS = 5000;
const CATEGORIES = new Set<SettlementCategory>(["deposit", "surgery_fee", "procedure_fee", "other"]);
const DIRECTIONS = new Set<SettlementDirection>(["payment", "refund"]);

type StaffContext = Awaited<ReturnType<typeof requireActiveStaff>>;
type SettlementDoc = Record<string, unknown> & SettlementMathRow & { id?: string };

type NormalizedInput = {
  patientId: string;
  reservationDocId: string;
  direction: SettlementDirection;
  category: SettlementCategory;
  amount: number;
  paymentMethod: "card" | "cash" | "bank_transfer" | "foreign_card" | "other";
  paidAt: string;
  memo: string;
};

function error(message: string, status = 400, code = "INVALID_SETTLEMENT") {
  return NextResponse.json({ success: false, code, message }, { status });
}

function normalizeInput(payload: Record<string, unknown>): NormalizedInput | null {
  const patientId = cleanText(payload.patientId);
  const reservationDocId = cleanText(payload.reservationDocId);
  const direction = String(payload.direction) as SettlementDirection;
  const category = String(payload.category) as SettlementCategory;
  const paymentMethod = String(payload.paymentMethod);
  const amount = settlementAmount(payload.amount);
  const paidAt = cleanText(payload.paidAt);
  if (
    !patientId ||
    !reservationDocId ||
    !DIRECTIONS.has(direction) ||
    !CATEGORIES.has(category) ||
    !isSettlementPaymentMethod(paymentMethod) ||
    amount <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(paidAt)
  ) return null;
  return {
    patientId,
    reservationDocId,
    direction,
    category,
    amount,
    paymentMethod,
    paidAt,
    memo: cleanText(payload.memo),
  };
}

function buildAuditLog(
  ctx: StaffContext,
  params: {
    action: string;
    targetType: "settlement" | "invoice";
    targetId: string;
    patientId: string;
    reservationId: string;
    invoiceId?: string;
    message: string;
    before?: unknown;
    after?: unknown;
  },
  now: FirebaseFirestore.FieldValue
) {
  return {
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    staffUid: ctx.uid,
    staffName: ctx.name,
    staffEmail: ctx.email,
    staffRole: ctx.role,
    staffCode: ctx.staffCode || "",
    patientId: params.patientId,
    reservationId: params.reservationId,
    invoiceId: params.invoiceId || "",
    message: params.message,
    before: params.before ?? null,
    after: params.after ?? null,
    createdAt: now,
  };
}

function asMathRows(docs: SettlementDoc[]): SettlementMathRow[] {
  return docs.map((doc) => doc as SettlementMathRow);
}

function splitStaffNames(value: unknown) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return cleanText(value)
    .split(/[,/|·、，\n]/)
    .map(cleanText)
    .filter(Boolean);
}

function uniqueStaffNames(...values: unknown[]) {
  return Array.from(new Set(values.flatMap(splitStaffNames)));
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? Array.from(new Set(value.map(cleanText).filter(Boolean))) : [];
}

function isValidDateRange(startDate: string, endDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return false;
  return end - start <= 366 * 24 * 60 * 60 * 1000;
}

export async function listSalesSummaryRows(payload: Record<string, unknown>, ctx: StaffContext) {
  if (ctx.role !== "admin") return error("매출 조회 권한이 없습니다.", 403, "FORBIDDEN");

  const startDate = cleanText(payload.startDate);
  const endDate = cleanText(payload.endDate);
  if (!isValidDateRange(startDate, endDate)) {
    return error("매출 조회 기간을 확인해주세요. 최대 1년까지 조회할 수 있습니다.");
  }

  const snap = await adminDb.collection("settlements")
    .where("paidAt", ">=", startDate)
    .where("paidAt", "<=", endDate)
    .limit(MAX_SALES_ROWS + 1)
    .get();

  if (snap.docs.length > MAX_SALES_ROWS) {
    return error("매출 내역이 너무 많습니다. 기간을 좁혀 다시 조회해주세요.", 409, "SALES_LIMIT_EXCEEDED");
  }

  const settlements = snap.docs
    .map((doc) => doc.data() as Record<string, unknown>)
    .filter((row) => row.isDeleted !== true && row.status !== "void");
  const reservationIds = Array.from(new Set(
    settlements.map((row) => cleanText(row.reservationDocId)).filter(Boolean)
  ));
  const reservations = new Map<string, Record<string, unknown>>();

  for (let offset = 0; offset < reservationIds.length; offset += 200) {
    const refs = reservationIds.slice(offset, offset + 200)
      .map((id) => adminDb.collection("reservations").doc(id));
    const docs = refs.length ? await adminDb.getAll(...refs) : [];
    docs.forEach((doc) => {
      if (doc.exists) reservations.set(doc.id, doc.data() as Record<string, unknown>);
    });
  }

  const rows = settlements.map((row) => {
    const reservation = reservations.get(cleanText(row.reservationDocId)) || {};
    const doctors = Object.prototype.hasOwnProperty.call(row, "doctors")
      ? uniqueStaffNames(row.doctors)
      : uniqueStaffNames(reservation.doctors, reservation.doctor || reservation.doctorName);
    const coordinators = Object.prototype.hasOwnProperty.call(row, "coordinators")
      ? uniqueStaffNames(row.coordinators)
      : uniqueStaffNames(reservation.coordinators, reservation.coordinator || reservation.manager || reservation.managerName);
    return {
      paidAt: cleanText(row.paidAt),
      direction: row.direction === "refund" ? "refund" : "payment",
      amount: settlementAmount(row.amount),
      paymentMethod: isSettlementPaymentMethod(row.paymentMethod) ? row.paymentMethod : "other",
      hospital: cleanText(row.hospital || reservation.hospital),
      appointmentType: cleanText(row.appointmentType || reservation.appointmentType) || "상담",
      consultArea: cleanText(row.consultArea || reservation.consultArea),
      doctors,
      coordinators,
    };
  });

  return NextResponse.json({ success: true, rows: toSerializable(rows) });
}

function invoicePatch(
  current: Record<string, unknown>,
  aggregate: ReturnType<typeof aggregateSettlementRows>,
  ctx: StaffContext,
  now: FirebaseFirestore.FieldValue
): Record<string, unknown> {
  const hasRate = current.commissionRate !== undefined && current.commissionRate !== null && current.commissionRate !== "";
  const rate = hasRate ? Number(current.commissionRate) : 0;
  const commissionAmount = hasRate && Number.isFinite(rate)
    ? calcCommission(aggregate.commissionBase, rate)
    : null;
  return {
    totalAmount: aggregate.netAmount,
    paymentMethod: aggregate.paymentMethod ?? null,
    cardAmount: aggregate.cardAmount,
    cashAmount: aggregate.cashAmount,
    bankTransferAmount: aggregate.methodTotals.bank_transfer,
    foreignCardAmount: aggregate.methodTotals.foreign_card,
    otherAmount: aggregate.methodTotals.other,
    settlementPaidAmount: aggregate.totalPaid,
    settlementRefundAmount: aggregate.totalRefunded,
    settlementCount: aggregate.count,
    commissionBase: aggregate.commissionBase,
    commissionAmount,
    invoiceRevision: FieldValue.increment(1),
    updatedAfterConfirmation: current.status === "confirmed" ? true : current.updatedAfterConfirmation === true,
    lastSettlementSyncedAt: now,
    updatedAt: now,
    updatedBy: ctx.name,
    updatedByUid: ctx.uid,
  };
}

export async function listSettlements(payload: Record<string, unknown>) {
  const patientId = cleanText(payload.patientId);
  const includeAppointments = payload.includeAppointments !== false;
  if (!patientId) return error("patientId가 없습니다.");

  const settlementSnap = await adminDb.collection("settlements")
    .where("patientId", "==", patientId)
    .limit(MAX_SETTLEMENTS_PER_PATIENT + 1)
    .get();

  const reservationSnap = includeAppointments
    ? await adminDb.collection("reservations")
      .where("patientId", "==", patientId)
      .limit(501)
      .get()
    : null;

  if (settlementSnap.docs.length > MAX_SETTLEMENTS_PER_PATIENT) {
    return error("정산 내역이 너무 많아 한 번에 처리할 수 없습니다.", 409, "SETTLEMENT_LIMIT_EXCEEDED");
  }

  const settlements: SettlementDoc[] = settlementSnap.docs
    .map((doc): SettlementDoc => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
    .sort((a, b) => `${String(b.paidAt || "")}\u0000${String(b.id || "")}`.localeCompare(`${String(a.paidAt || "")}\u0000${String(a.id || "")}`));
  const appointments = (reservationSnap?.docs ?? [])
    .flatMap((doc) => {
      const data = doc.data() as Record<string, unknown>;
      if (data.isDeleted === true) return [];
      return [{
        id: doc.id,
        reservationId: cleanText(data.reservationId),
        patientId: cleanText(data.patientId),
        surgeryCaseId: cleanText(data.surgeryCaseId),
        reservationDate: cleanText(data.reservationDate),
        reservationTime: cleanText(data.reservationTime),
        appointmentType: cleanText(data.appointmentType) || "상담",
        hospital: cleanText(data.hospital),
        consultArea: cleanText(data.consultArea),
      }];
    })
    .sort((a, b) => `${b.reservationDate} ${b.reservationTime}\u0000${b.id}`.localeCompare(`${a.reservationDate} ${a.reservationTime}\u0000${a.id}`));

  return NextResponse.json({
    success: true,
    settlements: toSerializable(settlements),
    appointments,
    appointmentsLoaded: includeAppointments,
    aggregate: aggregateSettlementRows(asMathRows(settlements)),
  });
}

type MutationMode = "create" | "update" | "void";

async function mutateSettlement(mode: MutationMode, payload: Record<string, unknown>, ctx: StaffContext) {
  const settlements = adminDb.collection("settlements");
  const settlementId = mode === "create" ? settlements.doc().id : cleanText(payload.settlementId);
  if (!settlementId) return error("정산 식별자가 없습니다.");
  const settlementRef = settlements.doc(settlementId);

  const generatedTargetCaseRef = adminDb.collection("surgeryCases").doc();
  const generatedOldCaseRef = adminDb.collection("surgeryCases").doc();
  const outcome = await adminDb.runTransaction(async (tx) => {
    const existingSnap = mode === "create" ? null : await tx.get(settlementRef);
    if (existingSnap && !existingSnap.exists) return { kind: "missing" as const };
    const existing = existingSnap?.data() as SettlementDoc | undefined;
    if (mode === "void" && existing?.status === "void") return { kind: "alreadyVoid" as const };

    if (mode === "update" && payload.patientId && cleanText(payload.patientId) !== cleanText(existing?.patientId)) {
      return { kind: "reservationMismatch" as const };
    }
    const patientId = mode === "create" ? cleanText(payload.patientId) : cleanText(existing?.patientId);
    const reservationDocId = mode === "void"
      ? cleanText(existing?.reservationDocId)
      : cleanText(payload.reservationDocId || existing?.reservationDocId);
    if (!patientId || !reservationDocId) return { kind: "invalid" as const };

    const oldReservationDocId = cleanText(existing?.reservationDocId);
    const affectedReservationIds = [...new Set([oldReservationDocId, reservationDocId].filter(Boolean))];
    const reservationRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    const reservationData = new Map<string, Record<string, unknown>>();
    for (const id of affectedReservationIds) {
      const ref = adminDb.collection("reservations").doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return { kind: "reservationMissing" as const };
      const data = snap.data() as Record<string, unknown>;
      if (data.isDeleted === true || cleanText(data.patientId) !== patientId) {
        return { kind: "reservationMismatch" as const };
      }
      reservationRefs.set(id, ref);
      reservationData.set(id, data);
    }
    const reservation = reservationData.get(reservationDocId)!;

    const targetCaseId = cleanText(reservation.surgeryCaseId)
      || (mode === "void" ? cleanText(existing?.surgeryCaseId) : "")
      || generatedTargetCaseRef.id;
    const oldReservation = oldReservationDocId ? reservationData.get(oldReservationDocId) : undefined;
    const oldCaseId = existing
      ? cleanText(existing.surgeryCaseId)
        || cleanText(oldReservation?.surgeryCaseId)
        || (oldReservationDocId && oldReservationDocId !== reservationDocId
          ? generatedOldCaseRef.id
          : targetCaseId)
      : "";
    const affectedCaseIds = [...new Set([oldCaseId, targetCaseId].filter(Boolean))];
    const caseRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    const caseData = new Map<string, Record<string, unknown> | undefined>();
    for (const caseId of affectedCaseIds) {
      const ref = caseId === generatedTargetCaseRef.id
        ? generatedTargetCaseRef
        : caseId === generatedOldCaseRef.id
          ? generatedOldCaseRef
          : adminDb.collection("surgeryCases").doc(caseId);
      caseRefs.set(caseId, ref);
      if (caseId === generatedTargetCaseRef.id || caseId === generatedOldCaseRef.id) {
        caseData.set(caseId, undefined);
      } else {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() as Record<string, unknown> : undefined;
        if (data && cleanText(data.patientId) !== patientId) return { kind: "caseMismatch" as const };
        caseData.set(caseId, data);
      }
    }

    const caseReservationIds = new Map<string, Set<string>>();
    for (const caseId of affectedCaseIds) {
      const ids = new Set<string>(
        Array.isArray(caseData.get(caseId)?.reservationDocIds)
          ? (caseData.get(caseId)!.reservationDocIds as unknown[]).map(cleanText).filter(Boolean)
          : []
      );
      if (caseId === targetCaseId) ids.add(reservationDocId);
      if (caseId === oldCaseId && oldReservationDocId) ids.add(oldReservationDocId);
      caseReservationIds.set(caseId, ids);
    }

    const caseRowsByCase = new Map<string, SettlementDoc[]>();
    const aggregatesByCase = new Map<string, ReturnType<typeof aggregateSettlementRows>>();
    for (const caseId of affectedCaseIds) {
      // 신규 결제는 케이스 캐시에 증분 반영해 settlement 재조회를 없앤다.
      // 수정/무효는 latest 날짜까지 정확히 되돌리기 위해 해당 케이스만 제한적으로 재검산한다.
      const cached = mode === "create" ? aggregateFromSurgeryCase(caseData.get(caseId)) : null;
      if (cached) {
        aggregatesByCase.set(caseId, cached);
        continue;
      }
      const docs = new Map<string, SettlementDoc>();
      const byCase = await tx.get(
        settlements.where("surgeryCaseId", "==", caseId).limit(MAX_SETTLEMENTS_PER_CASE + 1)
      );
      if (byCase.docs.length > MAX_SETTLEMENTS_PER_CASE) return { kind: "caseLimit" as const };
      byCase.docs.forEach((doc) => docs.set(doc.id, { id: doc.id, ...(doc.data() as Record<string, unknown>) }));
      for (const id of caseReservationIds.get(caseId) || []) {
        const byReservation = await tx.get(
          settlements.where("reservationDocId", "==", id).limit(MAX_SETTLEMENTS_PER_CASE + 1)
        );
        if (byReservation.docs.length > MAX_SETTLEMENTS_PER_CASE) return { kind: "caseLimit" as const };
        byReservation.docs.forEach((doc) => docs.set(doc.id, { id: doc.id, ...(doc.data() as Record<string, unknown>) }));
      }
      const rows = [...docs.values()];
      caseRowsByCase.set(caseId, rows);
      aggregatesByCase.set(caseId, aggregateSettlementRows(asMathRows(rows)));
    }

    const patientSnap = await tx.get(
      adminDb.collection("patients").where("patientId", "==", patientId).limit(10)
    );
    if (patientSnap.empty) return { kind: "patientMissing" as const };
    const patientSettlementSnap = mode === "create"
      ? null
      : await tx.get(settlements.where("patientId", "==", patientId).limit(MAX_SETTLEMENTS_PER_PATIENT + 1));
    if (patientSettlementSnap && patientSettlementSnap.docs.length > MAX_SETTLEMENTS_PER_PATIENT) {
      return { kind: "limit" as const };
    }

    const invoiceDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const caseId of affectedCaseIds) {
      const snap = await tx.get(adminDb.collection("invoices").where("surgeryCaseId", "==", caseId));
      snap.docs.forEach((doc) => invoiceDocs.set(doc.id, doc));
      if (snap.empty) {
        for (const id of caseReservationIds.get(caseId) || []) {
          const legacy = await tx.get(adminDb.collection("invoices").where("reservationDocId", "==", id));
          legacy.docs.forEach((doc) => invoiceDocs.set(doc.id, doc));
        }
      }
    }

    const normalized = mode === "void" ? null : normalizeInput({ ...payload, patientId, reservationDocId });
    if (mode !== "void" && !normalized) return { kind: "invalid" as const };
    const now = FieldValue.serverTimestamp();
    const next: SettlementDoc = mode === "void"
      ? {
          ...(existing || {}),
          id: settlementId,
          surgeryCaseId: oldCaseId || targetCaseId,
          status: "void",
          voidReason: cleanText(payload.reason),
          voidedAt: now,
          voidedBy: ctx.name,
          voidedByUid: ctx.uid,
          updatedAt: now,
          updatedBy: ctx.name,
          updatedByUid: ctx.uid,
        }
      : {
          ...(existing || {}),
          ...normalized,
          id: settlementId,
          surgeryCaseId: targetCaseId,
          reservationId: cleanText(reservation.reservationId),
          appointmentDate: cleanText(reservation.reservationDate),
          appointmentType: cleanText(reservation.appointmentType) || "상담",
          hospital: cleanText(reservation.hospital),
          consultArea: cleanText(reservation.consultArea),
          status: "active",
          isDeleted: false,
          updatedAt: now,
          updatedBy: ctx.name,
          updatedByUid: ctx.uid,
          ...(mode === "create" ? {
            doctors: uniqueStaffNames(reservation.doctors, reservation.doctor || reservation.doctorName),
            doctorUids: stringArray(reservation.doctorUids),
            coordinators: uniqueStaffNames(
              reservation.coordinators,
              reservation.coordinator || reservation.manager || reservation.managerName
            ),
            coordinatorUids: stringArray(reservation.coordinatorUids),
            createdAt: now,
            createdBy: ctx.name,
            createdByUid: ctx.uid,
          } : {}),
        };

    const applyToCase = (
      caseId: string,
      before: SettlementDoc | null | undefined,
      after: SettlementDoc | null | undefined
    ) => {
      const base = aggregatesByCase.get(caseId) || emptySettlementAggregate();
      const changed = applySettlementDelta(base, before, after);
      aggregatesByCase.set(caseId, changed.aggregate);
    };
    if (mode === "create") {
      applyToCase(targetCaseId, null, next);
    } else {
      // 수정/무효는 해당 케이스에서 현재 문서를 교체해 lastPaidAt까지 정확히 재계산한다.
      for (const caseId of affectedCaseIds) {
        const rows = (caseRowsByCase.get(caseId) || [])
          .filter((row) => cleanText(row.id) !== settlementId);
        if (cleanText(next.surgeryCaseId) === caseId) rows.push(next);
        aggregatesByCase.set(caseId, aggregateSettlementRows(asMathRows(rows)));
      }
    }
    for (const aggregate of aggregatesByCase.values()) {
      if (aggregate.netAmount < 0) return { kind: "negative" as const };
    }

    let patientAggregate: ReturnType<typeof aggregateSettlementRows>;
    if (patientSettlementSnap) {
      const allRows: SettlementDoc[] = patientSettlementSnap.docs
        .filter((doc) => doc.id !== settlementId)
        .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }));
      allRows.push(next);
      patientAggregate = aggregateSettlementRows(asMathRows(allRows));
    } else {
      const patient = patientSnap.docs[0].data() as Record<string, unknown>;
      const base = emptySettlementAggregate();
      base.count = Math.max(0, Number(patient.settlementCount) || 0);
      base.totalPaid = Math.max(0, Number(patient.totalSettlementPaid) || 0);
      base.totalRefunded = Math.max(0, Number(patient.totalSettlementRefunded) || 0);
      base.netAmount = Number(patient.netSettlementAmount) || 0;
      base.lastPaidAt = cleanText(patient.lastSettlementAt);
      patientAggregate = applySettlementDelta(base, null, next).aggregate;
    }

    const storedNext = { ...next };
    delete storedNext.id;
    if (mode === "create") tx.set(settlementRef, storedNext);
    else tx.update(settlementRef, storedNext);

    for (const [id, ref] of reservationRefs) {
      const caseId = id === reservationDocId ? targetCaseId : oldCaseId;
      if (caseId && cleanText(reservationData.get(id)?.surgeryCaseId) !== caseId) {
        tx.update(ref, {
          surgeryCaseId: caseId,
          updatedAt: now,
          updatedBy: ctx.name,
          updatedByUid: ctx.uid,
        });
      }
    }

    const activeInvoicesByCase = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (const invoiceDoc of invoiceDocs.values()) {
      const invoice = invoiceDoc.data() as Record<string, unknown>;
      if (invoice.isDeleted === true) continue;
      const invoiceCaseId = cleanText(invoice.surgeryCaseId)
        || (cleanText(invoice.reservationDocId) === reservationDocId ? targetCaseId : oldCaseId);
      if (!invoiceCaseId) continue;
      const list = activeInvoicesByCase.get(invoiceCaseId) || [];
      list.push(invoiceDoc);
      activeInvoicesByCase.set(invoiceCaseId, list);
    }

    for (const caseId of affectedCaseIds) {
      const ref = caseRefs.get(caseId)!;
      const current = caseData.get(caseId);
      const reservationIds = [...(caseReservationIds.get(caseId) || [])];
      const activeInvoice = activeInvoicesByCase.get(caseId)?.[0];
      const casePatch = {
        patientId,
        reservationDocIds: reservationIds,
        ...surgeryCaseAggregatePatch(aggregatesByCase.get(caseId) || emptySettlementAggregate()),
        ...(activeInvoice ? {
          invoiceDocId: activeInvoice.id,
          invoiceId: cleanText(activeInvoice.data().invoiceId),
        } : {}),
        updatedAt: now,
        updatedBy: ctx.name,
        updatedByUid: ctx.uid,
      };
      if (current) tx.update(ref, casePatch);
      else tx.set(ref, {
        ...casePatch,
        primaryReservationDocId: reservationIds[0] || reservationDocId,
        invoiceDocId: activeInvoice?.id || "",
        invoiceId: activeInvoice ? cleanText(activeInvoice.data().invoiceId) : "",
        isDeleted: false,
        createdAt: now,
        createdBy: ctx.name,
        createdByUid: ctx.uid,
      });
    }

    const patientPatch = {
      settlementCount: patientAggregate.count,
      totalSettlementPaid: patientAggregate.totalPaid,
      totalSettlementRefunded: patientAggregate.totalRefunded,
      netSettlementAmount: patientAggregate.netAmount,
      lastSettlementAt: patientAggregate.lastPaidAt,
      settlementUpdatedAt: now,
      summaryUpdatedAt: now,
    };
    for (const patientDoc of patientSnap.docs) tx.update(patientDoc.ref, patientPatch);

    for (const [caseId, docs] of activeInvoicesByCase) {
      const aggregate = aggregatesByCase.get(caseId) || emptySettlementAggregate();
      const reservationIds = [...(caseReservationIds.get(caseId) || [])];
      for (const invoiceDoc of docs) {
        const invoice = invoiceDoc.data() as Record<string, unknown>;
        const patch = {
          ...invoicePatch(invoice, aggregate, ctx, now),
          surgeryCaseId: caseId,
          reservationDocIds: reservationIds,
        };
        tx.update(invoiceDoc.ref, patch);
        tx.set(adminDb.collection("logs").doc(), buildAuditLog(ctx, {
          action: "invoice_settlement_auto_sync",
          targetType: "invoice",
          targetId: invoiceDoc.id,
          patientId,
          reservationId: cleanText(invoice.reservationId),
          invoiceId: cleanText(invoice.invoiceId),
          message: `${ctx.name}님이 같은 수술 케이스의 정산 변경에 따라 인보이스 실결제액과 커미션을 자동 재계산했습니다.`,
          before: {
            totalAmount: invoice.totalAmount,
            commissionBase: invoice.commissionBase,
            commissionAmount: invoice.commissionAmount,
            status: invoice.status,
          },
          after: {
            totalAmount: aggregate.netAmount,
            commissionBase: aggregate.commissionBase,
            settlementCount: aggregate.count,
            status: invoice.status,
          },
        }, now));
      }
    }

    const action = mode === "create" ? "settlement_create" : mode === "update" ? "settlement_update" : "settlement_void";
    tx.set(adminDb.collection("logs").doc(), buildAuditLog(ctx, {
      action,
      targetType: "settlement",
      targetId: settlementId,
      patientId,
      reservationId: cleanText(reservation.reservationId),
      message: mode === "void"
        ? `${ctx.name}님이 정산 기록을 무효 처리했습니다.`
        : `${ctx.name}님이 실제 결제 정산 기록을 ${mode === "create" ? "등록" : "수정"}했습니다.`,
      before: existing || null,
      after: next,
    }, now));

    return {
      kind: "ok" as const,
      settlementId,
      patientId,
      surgeryCaseId: targetCaseId,
      aggregate: patientAggregate,
    };
  });

  if (outcome.kind === "missing") return error("정산 기록을 찾을 수 없습니다.", 404, "SETTLEMENT_NOT_FOUND");
  if (outcome.kind === "alreadyVoid") return NextResponse.json({ success: true, alreadyVoid: true });
  if (outcome.kind === "invalid") return error("정산 입력값을 확인해주세요.");
  if (outcome.kind === "reservationMissing") return error("연결할 예약을 찾을 수 없습니다.", 404, "RESERVATION_NOT_FOUND");
  if (outcome.kind === "reservationMismatch") return error("예약과 환자 연결 정보가 일치하지 않습니다.", 409, "SETTLEMENT_RESERVATION_MISMATCH");
  if (outcome.kind === "caseMismatch") return error("수술 케이스와 환자 연결 정보가 일치하지 않습니다.", 409, "SURGERY_CASE_PATIENT_MISMATCH");
  if (outcome.kind === "patientMissing") return error("환자 정보를 찾을 수 없습니다.", 404, "PATIENT_NOT_FOUND");
  if (outcome.kind === "limit") return error("정산 내역이 너무 많아 처리할 수 없습니다.", 409, "SETTLEMENT_LIMIT_EXCEEDED");
  if (outcome.kind === "caseLimit") return error("수술 케이스의 정산 내역이 너무 많아 처리할 수 없습니다.", 409, "SURGERY_CASE_SETTLEMENT_LIMIT_EXCEEDED");
  if (outcome.kind === "negative") return error("환불액은 해당 수술 케이스의 누적 실결제액을 초과할 수 없습니다.", 409, "SETTLEMENT_NEGATIVE_BALANCE");
  return NextResponse.json({
    success: true,
    settlementId: outcome.settlementId,
    patientId: outcome.patientId,
    surgeryCaseId: outcome.surgeryCaseId,
    aggregate: outcome.aggregate,
  });
}

export function createSettlementAtomic(payload: Record<string, unknown>, ctx: StaffContext) {
  return mutateSettlement("create", payload, ctx);
}

export function updateSettlementAtomic(payload: Record<string, unknown>, ctx: StaffContext) {
  return mutateSettlement("update", payload, ctx);
}

export function voidSettlementAtomic(payload: Record<string, unknown>, ctx: StaffContext) {
  return mutateSettlement("void", payload, ctx);
}
