import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import { docToObj, cleanText } from "@/lib/adminUtils";
import { parseBirthInfo } from "@/lib/invoiceUtils";

// 데이터 변경 action — 토큰 폐기 검사 적용
const WRITE_ACTIONS = new Set(["create", "update", "delete"]);

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function makeInvoiceId(reservation: Record<string, unknown>) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const namePart = cleanText(reservation.name || reservation.patientName || "고객")
    .replace(/[\\/#?[\]*.]/g, " ")
    .replace(/\s+/g, "")
    .slice(0, 20);
  const suffix = Date.now().toString(36);
  return `INV-${yy}${mm}${dd}-${namePart}-${suffix}`;
}

async function writeLog(params: {
  action: string; targetType: string; targetId: string;
  staffUid: string; staffName: string; staffEmail: string; staffRole: string; staffCode: string;
  patientId: string; reservationId: string; message: string;
  before?: unknown; after?: unknown;
}) {
  await adminDb.collection("logs").add({
    ...params,
    invoiceId: params.targetId,
    before: params.before ?? null,
    after: params.after ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const { idToken, action, payload } = await req.json();

    // 활성 직원 인가 — 서버 검증값(role/name)만 사용, 클라이언트 전송 값 신뢰 안 함.
    // 쓰기 action은 토큰 폐기 검사까지 수행.
    let ctx;
    try {
      ctx = await requireActiveStaff(idToken, { checkRevoked: WRITE_ACTIONS.has(action) });
    } catch (authErr) {
      const res = toAuthErrorResponse(authErr);
      if (res) return res;
      throw authErr;
    }
    const callerRole = ctx.role;
    const callerName = ctx.name;
    const callerUid = ctx.uid;

    // admin은 모든 접근 허용. coordinator 이하는 본인 담당 인보이스만 접근.
    const isAdmin = callerRole === "admin";

    // 권한 판정: coordinatorUids[](UID) 우선 — 동명이인/개명에 안전.
    // 미배포 데이터를 위해 coordinators[](displayName) 폴백 유지(하위호환).
    // 백필: scripts/backfill-coordinator-uids.ts 참고.
    function isCoordinatorOf(inv: Record<string, unknown>): boolean {
      if (isAdmin) return true;
      const uids = Array.isArray(inv.coordinatorUids) ? inv.coordinatorUids as string[] : [];
      if (uids.length) return uids.includes(callerUid);
      const coords = Array.isArray(inv.coordinators) ? inv.coordinators as string[] : [];
      return callerName ? coords.includes(callerName) : false;
    }

    // ── GET_BY_PATIENT ───────────────────────────────────────────────────────
    if (action === "get_by_patient") {
      const { patientId } = payload as { patientId: string };
      const snap = await adminDb.collection("invoices")
        .where("patientId", "==", patientId)
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();
      const invoices = snap.docs.map(docToObj)
        .filter((r) => !r.isDeleted && isCoordinatorOf(r));
      return NextResponse.json({ success: true, invoices });
    }

    // ── GET_BY_RESERVATION ───────────────────────────────────────────────────
    if (action === "get_by_reservation") {
      const { reservationDocId } = payload as { reservationDocId: string };
      const snap = await adminDb.collection("invoices")
        .where("reservationDocId", "==", reservationDocId)
        .get();
      for (const d of snap.docs) {
        const obj = docToObj(d);
        if (!obj.isDeleted && isCoordinatorOf(obj)) return NextResponse.json({ success: true, invoice: obj });
        if (!obj.isDeleted && !isAdmin) return NextResponse.json({ success: true, invoice: null });
      }
      return NextResponse.json({ success: true, invoice: null });
    }

    // ── CREATE ───────────────────────────────────────────────────────────────
    if (action === "create") {
      const { reservationDocId, staffUid, staffName, staffEmail, staffRole, staffCode } =
        payload as Record<string, string>;

      // 기존 인보이스 확인
      const existing = await adminDb.collection("invoices")
        .where("reservationDocId", "==", reservationDocId)
        .get();
      for (const d of existing.docs) {
        if (!d.data().isDeleted) {
          const existingInv = docToObj(d);
          if (!isCoordinatorOf(existingInv)) {
            return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });
          }
          return NextResponse.json({ success: true, invoice: existingInv, alreadyExists: true });
        }
      }

      // 예약 정보 조회
      const resSnap = await adminDb.collection("reservations").doc(reservationDocId).get();
      if (!resSnap.exists) {
        return NextResponse.json({ success: false, message: "예약 정보를 찾을 수 없습니다." });
      }
      const reservation = resSnap.data() as Record<string, unknown>;

      // coordinator 또는 admin만 인보이스 생성 가능
      if (!isAdmin && callerRole !== "coordinator") {
        return NextResponse.json({ success: false, message: "코디네이터만 인보이스를 생성할 수 있습니다." }, { status: 403 });
      }
      // coordinator: 해당 예약의 담당자인지 확인 (uid 우선, 이름 폴백)
      if (!isAdmin) {
        const resCoordUids = Array.isArray(reservation.coordinatorUids) ? reservation.coordinatorUids as string[] : [];
        const resCoords = Array.isArray(reservation.coordinators) ? reservation.coordinators as string[] : [];
        const allowed = resCoordUids.length
          ? resCoordUids.includes(callerUid)
          : (!!callerName && resCoords.includes(callerName));
        if (!allowed) {
          return NextResponse.json({ success: false, message: "담당 코디네이터만 인보이스를 생성할 수 있습니다." }, { status: 403 });
        }
      }

      const rawBirth = cleanText(reservation.birthInput || reservation.birth);
      const birthInfo = parseBirthInfo(rawBirth, cleanText(reservation.gender));
      const invoiceId = makeInvoiceId(reservation);

      const invoicePayload = {
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
        // UID 기반 권한(있으면 예약에서 승계). 백필 전에는 빈 배열 → 이름 폴백 사용.
        coordinatorUids: Array.isArray(reservation.coordinatorUids) ? reservation.coordinatorUids : [],
        hospitalName: cleanText(reservation.hospital),
        surgeryItems: cleanText(reservation.consultArea) || "",
        surgeryDate: cleanText(reservation.reservationDate) || "",
        totalAmount: (() => {
          const raw = cleanText(reservation.surgeryCost).replace(/[^0-9.]/g, "");
          const n = parseFloat(raw);
          return Number.isFinite(n) ? n : 0;
        })(),
        memo: "",
        status: "draft",
        createdAt: FieldValue.serverTimestamp(),
        createdBy: staffName,
        createdByUid: staffUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffName,
        updatedByUid: staffUid,
        isDeleted: false,
      };

      const invoiceRef = await adminDb.collection("invoices").add(invoicePayload);
      const invoiceDocId = invoiceRef.id;

      await adminDb.collection("reservations").doc(reservationDocId).update({
        invoiceId,
        invoiceDocId,
        invoiceStatus: "draft",
        invoiceUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffName,
        updatedByUid: staffUid,
      });

      await writeLog({
        action: "invoice_create", targetType: "invoice", targetId: invoiceDocId,
        staffUid, staffName, staffEmail, staffRole, staffCode: staffCode || "",
        patientId: cleanText(reservation.patientId),
        reservationId: cleanText(reservation.reservationId),
        message: `${staffName}님이 인보이스를 생성했습니다.`,
        after: { invoiceId, invoiceDocId },
      });

      const newSnap = await invoiceRef.get();
      return NextResponse.json({ success: true, invoice: docToObj(newSnap), alreadyExists: false });
    }

    // ── UPDATE ───────────────────────────────────────────────────────────────
    if (action === "update") {
      const { invoiceDocId, staffUid, staffName, staffEmail, staffRole, staffCode, ...fields } =
        payload as Record<string, unknown>;

      const invoiceRef = adminDb.collection("invoices").doc(cleanText(invoiceDocId));
      const invoiceSnap = await invoiceRef.get();
      if (!invoiceSnap.exists) {
        return NextResponse.json({ success: false, message: "인보이스를 찾을 수 없습니다." });
      }
      const current = invoiceSnap.data() as Record<string, unknown>;

      if (!isCoordinatorOf(current)) {
        return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });
      }

      const patch: Record<string, unknown> = {
        hospitalName: cleanText(fields.hospitalName),
        surgeryItems: cleanText(fields.surgeryItems),
        surgeryDate: cleanText(fields.surgeryDate ?? ""),
        totalAmount: toNumber(fields.totalAmount),
        paymentMethod: fields.paymentMethod ?? null,
        cardAmount: fields.cardAmount !== undefined ? toNumber(fields.cardAmount) : null,
        cashAmount: fields.cashAmount !== undefined ? toNumber(fields.cashAmount) : null,
        commissionRate: fields.commissionRate !== undefined ? toNumber(fields.commissionRate) : null,
        commissionStaffUid: fields.commissionStaffUid ?? null,
        commissionStaffName: fields.commissionStaffName ?? null,
        commissionBase: fields.commissionBase !== undefined ? toNumber(fields.commissionBase) : null,
        commissionAmount: fields.commissionAmount !== undefined ? toNumber(fields.commissionAmount) : null,
        memo: cleanText(fields.memo),
        doctors: Array.isArray(fields.doctors) ? fields.doctors : (Array.isArray(current.doctors) ? current.doctors : []),
        status: fields.status || current.status || "draft",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffName,
        updatedByUid: staffUid,
        isDeleted: false,
      };

      await adminDb.runTransaction(async (tx) => {
        tx.update(invoiceRef, patch);
        tx.update(
          adminDb.collection("reservations").doc(cleanText(current.reservationDocId)),
          {
            invoiceId: current.invoiceId,
            invoiceDocId: cleanText(invoiceDocId),
            invoiceStatus: patch.status,
            invoiceUpdatedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: staffName,
            updatedByUid: staffUid,
          }
        );
      });

      await writeLog({
        action: "invoice_update", targetType: "invoice", targetId: cleanText(current.invoiceId),
        staffUid: cleanText(staffUid), staffName: cleanText(staffName),
        staffEmail: cleanText(staffEmail), staffRole: cleanText(staffRole), staffCode: cleanText(staffCode),
        patientId: cleanText(current.patientId), reservationId: cleanText(current.reservationId),
        message: `${cleanText(staffName)}님이 인보이스를 수정했습니다.`,
        after: { invoiceId: current.invoiceId, totalAmount: patch.totalAmount, status: patch.status },
      });

      const updated = await invoiceRef.get();
      return NextResponse.json({ success: true, invoice: docToObj(updated) });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (action === "delete") {
      const { invoiceDocId, staffUid, staffName, staffEmail, staffRole, staffCode } =
        payload as Record<string, string>;

      const invoiceRef = adminDb.collection("invoices").doc(invoiceDocId);
      const invoiceSnap = await invoiceRef.get();
      if (!invoiceSnap.exists) {
        return NextResponse.json({ success: false, message: "인보이스를 찾을 수 없습니다." });
      }
      const current = invoiceSnap.data() as Record<string, unknown>;

      if (!isCoordinatorOf(current)) {
        return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });
      }

      await invoiceRef.update({
        isDeleted: true,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffName,
        updatedByUid: staffUid,
      });

      await adminDb.collection("reservations").doc(cleanText(current.reservationDocId)).update({
        invoiceId: "",
        invoiceDocId: "",
        invoiceStatus: "",
        invoiceUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffName,
        updatedByUid: staffUid,
      });

      await writeLog({
        action: "invoice_delete", targetType: "invoice", targetId: cleanText(current.invoiceId),
        staffUid, staffName, staffEmail, staffRole, staffCode: staffCode || "",
        patientId: cleanText(current.patientId), reservationId: cleanText(current.reservationId),
        message: `${staffName}님이 인보이스를 삭제했습니다.`,
        before: { invoiceId: current.invoiceId },
      });

      return NextResponse.json({ success: true });
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (action === "list") {
      const { startDate, endDate, status, patientName, commissionStaffUid, cursor } =
        (payload || {}) as Record<string, string>;

      const PAGE_SIZE = 50;
      // isDeleted 서버 필터 복원 — invoices: isDeleted+createdAt 복합 인덱스 사용.
      // (firestore.indexes.json에 정의되어 있어야 하며, 미배포 시 firebase deploy 필요)
      let q = adminDb.collection("invoices")
        .where("isDeleted", "==", false)
        .orderBy("createdAt", "desc")
        .limit(PAGE_SIZE);
      if (cursor) {
        const cursorDoc = await adminDb.collection("invoices").doc(cursor).get();
        if (cursorDoc.exists) q = q.startAfter(cursorDoc) as typeof q;
      }

      const snap = await q.get();
      const hasMore = snap.docs.length === PAGE_SIZE;
      const nextCursor = hasMore ? snap.docs[snap.docs.length - 1].id : null;

      // isDeleted는 서버에서 필터됨. 권한(coordinator)만 메모리 필터.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let records = snap.docs.map(docToObj).filter((r: any) => isCoordinatorOf(r));

      // 날짜 필터: surgeryDate 있으면 surgeryDate 기준, 없으면 createdAt 기준
      if (startDate || endDate) {
        const sd = startDate || "0000-00-00";
        const ed = endDate   || "9999-99-99";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        records = records.filter((r: any) => {
          const ts = r.createdAt;
          const fallback = ts ? new Date(typeof ts === "number" ? ts : Number(ts)).toISOString().slice(0, 10) : "";
          const effectiveDate = r.surgeryDate ? String(r.surgeryDate) : fallback;
          return effectiveDate >= sd && effectiveDate <= ed;
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (status) records = records.filter((r: any) => r.status === status);
      if (patientName) {
        const search = patientName.toLowerCase();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        records = records.filter((r: any) => cleanText(r.patientName).toLowerCase().includes(search));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (commissionStaffUid) records = records.filter((r: any) => r.commissionStaffUid === commissionStaffUid);

      return NextResponse.json({ success: true, invoices: records, nextCursor, hasMore });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[/api/invoices]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
