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
    // 살아있는 인보이스만 대상. isDeleted를 쿼리에 넣어 limit이 삭제 문서에 소진되지 않게 한다.
    const base = adminDb.collection("invoices")
      .where("patientId", "==", patientId)
      .where("isDeleted", "==", false);

    // 권한을 post-filter가 아니라 쿼리로 밀어 넣는다(list 액션과 동일 패턴). limit을 권한 필터
    // "전에" 걸어도 각 후보가 이미 접근 가능 문서뿐이라, 접근 불가한 최신 문서가 슬롯을 차지해
    // 접근 가능한 과거 문서가 누락되던 문제가 사라진다.
    let docs: FirebaseFirestore.QueryDocumentSnapshot[];
    if (access.isAdmin) {
      docs = (await base.orderBy("createdAt", "desc").limit(50).get()).docs;
    } else {
      const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [
        base.where("coordinatorUids", "array-contains", access.callerUid)
          .orderBy("createdAt", "desc").limit(50).get(),
      ];
      if (access.callerName) {
        // 레거시 문서(coordinatorUids 없이 coordinators 이름만) 대응.
        queries.push(
          base.where("coordinators", "array-contains", access.callerName)
            .orderBy("createdAt", "desc").limit(50).get()
        );
      }
      const byId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
      (await Promise.all(queries)).forEach((snap) => {
        for (const doc of snap.docs) if (!byId.has(doc.id)) byId.set(doc.id, doc);
      });
      docs = Array.from(byId.values());
    }

    const records = docs.map(docToObj).filter((record) => access.canAccess(record));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    records.sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return NextResponse.json({ success: true, invoices: records.slice(0, 50) });
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
