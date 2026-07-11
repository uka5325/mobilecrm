import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { cleanText, docToObj } from "@/lib/adminUtils";
import type { InvoiceAccess } from "./invoiceAccess";

export async function handleInvoiceReadAction(
  action: string,
  payload: Record<string, unknown>,
  access: InvoiceAccess
): Promise<NextResponse | null> {
  if (action === "get_by_patient") {
    const patientId = String(payload.patientId || "");
    const snap = await adminDb.collection("invoices")
      .where("patientId", "==", patientId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();
    const invoices = snap.docs.map(docToObj)
      .filter((record) => !record.isDeleted && access.canAccess(record));
    return NextResponse.json({ success: true, invoices });
  }

  if (action === "counts_by_patients") {
    const rawIds = Array.isArray(payload.patientIds) ? payload.patientIds : [];
    const ids = [...new Set(rawIds.map(String).filter(Boolean))];
    if (!ids.length) return NextResponse.json({ success: true, counts: {} });

    const counts: Record<string, number> = {};
    if (access.isAdmin) {
      await Promise.all(ids.map(async (patientId) => {
        const aggregate = await adminDb.collection("invoices")
          .where("patientId", "==", patientId)
          .where("isDeleted", "==", false)
          .count()
          .get();
        counts[patientId] = aggregate.data().count;
      }));
    } else {
      for (const id of ids) counts[id] = 0;
      const chunkSize = 30;
      for (let index = 0; index < ids.length; index += chunkSize) {
        const chunk = ids.slice(index, index + chunkSize);
        const snap = await adminDb.collection("invoices")
          .where("patientId", "in", chunk)
          .where("isDeleted", "==", false)
          .get();
        for (const doc of snap.docs) {
          const invoice = docToObj(doc);
          if (!access.canAccess(invoice)) continue;
          const patientId = String(invoice.patientId || "");
          if (patientId in counts) counts[patientId] += 1;
        }
      }
    }
    return NextResponse.json({ success: true, counts });
  }

  if (action === "get_by_reservation") {
    const reservationDocId = String(payload.reservationDocId || "");
    const snap = await adminDb.collection("invoices")
      .where("reservationDocId", "==", reservationDocId)
      .get();
    for (const doc of snap.docs) {
      const invoice = docToObj(doc);
      if (!invoice.isDeleted && access.canAccess(invoice)) {
        return NextResponse.json({ success: true, invoice });
      }
      if (!invoice.isDeleted && !access.isAdmin) {
        return NextResponse.json({ success: true, invoice: null });
      }
    }
    return NextResponse.json({ success: true, invoice: null });
  }

  if (action !== "list") return null;

  const startDate = String(payload.startDate || "");
  const endDate = String(payload.endDate || "");
  const status = String(payload.status || "");
  const patientName = String(payload.patientName || "");
  const commissionStaffUid = String(payload.commissionStaffUid || "");
  const hardCap = 1000;
  const base = adminDb.collection("invoices").where("isDeleted", "==", false);
  const hasRange = !!(startDate || endDate);
  const rangeStart = startDate || "0000-00-00";
  const rangeEnd = endDate || "9999-99-99";
  const applyScope = (query: FirebaseFirestore.Query): FirebaseFirestore.Query =>
    hasRange
      ? query.where("surgeryDate", ">=", rangeStart).where("surgeryDate", "<=", rangeEnd).orderBy("surgeryDate", "desc").limit(hardCap)
      : query.orderBy("createdAt", "desc").limit(hardCap);

  const documents = new Map<string, FirebaseFirestore.DocumentData>();
  let rawCount = 0;
  const collect = (snap: FirebaseFirestore.QuerySnapshot) => {
    rawCount += snap.docs.length;
    for (const doc of snap.docs) {
      if (!documents.has(doc.id)) documents.set(doc.id, docToObj(doc));
    }
  };

  if (access.isAdmin) {
    collect(await applyScope(base).get());
  } else {
    const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [
      applyScope(base.where("coordinatorUids", "array-contains", access.callerUid)).get(),
    ];
    if (access.callerName) {
      queries.push(applyScope(base.where("coordinators", "array-contains", access.callerName)).get());
    }
    (await Promise.all(queries)).forEach(collect);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let records = Array.from(documents.values()).sort((a: any, b: any) =>
    hasRange
      ? String(b.surgeryDate || "").localeCompare(String(a.surgeryDate || ""))
      : Number(b.createdAt || 0) - Number(a.createdAt || 0)
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (status) records = records.filter((record: any) => record.status === status);
  if (patientName) {
    const search = patientName.toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    records = records.filter((record: any) => cleanText(record.patientName).toLowerCase().includes(search));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (commissionStaffUid) records = records.filter((record: any) => record.commissionStaffUid === commissionStaffUid);

  return NextResponse.json({
    success: true,
    invoices: records,
    total: records.length,
    capped: rawCount >= hardCap,
    nextCursor: null,
    hasMore: false,
  });
}
