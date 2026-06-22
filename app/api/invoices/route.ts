import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebaseAdmin";

function toSer(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "object" && typeof (val as Record<string, unknown>).toMillis === "function") {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (Array.isArray(val)) return val.map(toSer);
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) out[k] = toSer(v);
    return out;
  }
  return val;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function docToObj(d: any): Record<string, unknown> {
  return toSer({ id: d.id, ...d.data() }) as Record<string, unknown>;
}

function cleanText(v: unknown): string {
  return String(v ?? "").trim();
}

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
  return `INV-${yy}${mm}${dd}-${namePart}`;
}

function parseBirthInfo(rawValue: string, rawGender?: string) {
  const raw = String(rawValue || "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  let year = "", mm2 = "", dd2 = "", gender = "";

  if (/^\d{6}-[1-4]$/.test(raw)) {
    year = (raw[7] === "1" || raw[7] === "2") ? "19" + raw.slice(0, 2) : "20" + raw.slice(0, 2);
    mm2 = raw.slice(2, 4);
    dd2 = raw.slice(4, 6);
    gender = (raw[7] === "1" || raw[7] === "3") ? "남" : "여";
  } else if (/^\d{7}$/.test(digits)) {
    year = (digits[6] === "1" || digits[6] === "2") ? "19" + digits.slice(0, 2) : "20" + digits.slice(0, 2);
    mm2 = digits.slice(2, 4);
    dd2 = digits.slice(4, 6);
    gender = (digits[6] === "1" || digits[6] === "3") ? "남" : "여";
  } else if (digits.length >= 8) {
    year = digits.slice(0, 4);
    mm2 = digits.slice(4, 6);
    dd2 = digits.slice(6, 8);
    const code = digits.length >= 9 ? digits[8] : "";
    if (code === "1" || code === "3") gender = "남";
    if (code === "2" || code === "4") gender = "여";
  }

  if (!gender && rawGender) gender = rawGender;
  const birth = year && mm2 && dd2 ? `${year}-${mm2}-${dd2}` : "";
  const birthDisplay = year && mm2 && dd2 ? `${year.slice(2)}${mm2}${dd2}` : "";
  return { birth, birthDisplay, gender };
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
    const { idToken, action, payload, callerRole: clientRole, callerName: clientName } = await req.json();
    if (!idToken) return NextResponse.json({ success: false, message: "인증 토큰 없음" }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;

    // ── Caller identity & role ────────────────────────────────────────────────
    // 클라이언트가 캐싱한 role/name을 우선 사용. 없으면 DB 조회 fallback.
    let callerRole = String(clientRole || "");
    let callerName = String(clientName || "");
    if (!callerRole) {
      const snap = await adminDb.collection("staff").where("uid", "==", uid).limit(1).get();
      if (!snap.empty) {
        callerRole = String(snap.docs[0].data().role || "");
        callerName = String(snap.docs[0].data().displayName || "");
      } else {
        const doc = await adminDb.collection("staff").doc(uid).get();
        if (doc.exists) {
          callerRole = String(doc.data()?.role || "");
          callerName = String(doc.data()?.displayName || "");
        }
      }
    }

    // admin은 모든 접근 허용. coordinator 이하는 본인 담당 인보이스만 접근.
    const isAdmin = callerRole === "admin";

    function isCoordinatorOf(inv: Record<string, unknown>): boolean {
      if (isAdmin) return true;
      const coords = Array.isArray(inv.coordinators) ? inv.coordinators as string[] : [];
      return callerName ? coords.includes(callerName) : false;
    }

    // ── GET_BY_PATIENT ───────────────────────────────────────────────────────
    if (action === "get_by_patient") {
      const { patientId } = payload as { patientId: string };
      const snap = await adminDb.collection("invoices")
        .where("patientId", "==", patientId)
        .orderBy("createdAt", "desc")
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

      // coordinator 이하: 해당 예약의 담당자인지 확인
      if (!isAdmin) {
        const resCoords = Array.isArray(reservation.coordinators) ? reservation.coordinators as string[] : [];
        if (!callerName || !resCoords.includes(callerName)) {
          return NextResponse.json({ success: false, message: "담당자만 인보이스를 생성할 수 있습니다." }, { status: 403 });
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

      await invoiceRef.update(patch);

      await adminDb.collection("reservations").doc(cleanText(current.reservationDocId)).update({
        invoiceId: current.invoiceId,
        invoiceDocId: cleanText(invoiceDocId),
        invoiceStatus: patch.status,
        invoiceUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffName,
        updatedByUid: staffUid,
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
      const { startDate, endDate, status, patientName, commissionStaffUid } =
        (payload || {}) as Record<string, string>;

      const snap = await adminDb.collection("invoices").orderBy("createdAt", "desc").get();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let records = snap.docs.map(docToObj).filter((r: any) => !r.isDeleted && isCoordinatorOf(r));

      // 수술날짜 기준 필터 (surgeryDate 없는 기존 인보이스는 createdAt 날짜로 대체)
      if (startDate || endDate) {
        const sd = startDate || "0000-00-00";
        const ed = endDate || "9999-99-99";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        records = records.filter((r: any) => {
          const effectiveDate: string = r.surgeryDate
            ? String(r.surgeryDate)
            : (() => {
                const ts = r.createdAt;
                if (!ts) return "";
                const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
                return d.toISOString().slice(0, 10);
              })();
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

      return NextResponse.json({ success: true, invoices: records });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[/api/invoices]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
