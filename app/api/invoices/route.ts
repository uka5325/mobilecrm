import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import { docToObj, cleanText } from "@/lib/adminUtils";
import { parseBirthInfo } from "@/lib/invoiceUtils";
import { recomputeInvoiceSummary, safeRecompute } from "@/lib/patientSummary";

// 데이터 변경 action — 토큰 폐기 검사 적용
const WRITE_ACTIONS = new Set(["create", "update", "delete"]);

// 인보이스 상태 허용값(enum) — update에서 임의 문자열 저장 차단.
// lib/invoices.ts InvoiceRecord.status 정의와 일치해야 함.
const ALLOWED_INVOICE_STATUS = new Set(["draft", "confirmed", "void"]);

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

    // ── COUNTS_BY_PATIENTS ───────────────────────────────────────────────────
    // 고객관리 카드의 "인보이스 개수" 배지 — 환자마다 전체 문서를 읽어(get_by_patient)
    // 길이만 쓰던 걸, 여러 환자를 한 번에 처리한다.
    // admin: 환자별 count() 집계(문서 내용을 안 읽고 개수만 셈 → 인보이스 개수와 무관하게 항상 1 읽기).
    // 그 외 역할: coordinatorUids/coordinators 필터가 문서 단위라 count()로 못 구하므로,
    //   patientId in [...] 배치 조회 1번 + 메모리 필터로 집계(왕복 횟수만 줄임).
    if (action === "counts_by_patients") {
      const { patientIds } = (payload || {}) as { patientIds?: string[] };
      const ids = Array.isArray(patientIds) ? [...new Set(patientIds.filter(Boolean))] : [];
      if (!ids.length) return NextResponse.json({ success: true, counts: {} });

      const counts: Record<string, number> = {};

      if (isAdmin) {
        await Promise.all(
          ids.map(async (pid) => {
            const agg = await adminDb.collection("invoices")
              .where("patientId", "==", pid)
              .where("isDeleted", "==", false)
              .count()
              .get();
            counts[pid] = agg.data().count;
          })
        );
      } else {
        for (const id of ids) counts[id] = 0;
        const CHUNK = 30; // Firestore in 최대 30개
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          const snap = await adminDb.collection("invoices")
            .where("patientId", "in", chunk)
            .where("isDeleted", "==", false)
            .get();
          for (const d of snap.docs) {
            const obj = docToObj(d);
            if (!isCoordinatorOf(obj)) continue;
            const pid = String(obj.patientId || "");
            if (pid in counts) counts[pid] += 1;
          }
        }
      }

      return NextResponse.json({ success: true, counts });
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
      const { reservationDocId } = payload as Record<string, string>;
      // 작성자/감사로그 신원은 검증된 토큰(ctx)만 사용 → 위조 차단
      const staffUid = ctx.uid, staffName = ctx.name, staffEmail = ctx.email, staffRole = ctx.role, staffCode = ctx.staffCode;

      // 예약 정보 조회 (권한/필드 계산에 필요)
      const invoicesCol = adminDb.collection("invoices");
      const reservationRef = adminDb.collection("reservations").doc(reservationDocId);
      const resSnap = await reservationRef.get();
      if (!resSnap.exists) {
        return NextResponse.json({ success: false, message: "예약 정보를 찾을 수 없습니다." });
      }
      const reservation = resSnap.data() as Record<string, unknown>;

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

      // 트랜잭션: 중복 인보이스 생성 방지(TOCTOU) — 존재확인 + 생성 + 예약갱신을 원자화.
      const txResult = await adminDb.runTransaction(async (tx) => {
        const existingSnap = await tx.get(invoicesCol.where("reservationDocId", "==", reservationDocId));
        const existingDoc = existingSnap.docs.find((d) => d.data().isDeleted !== true);
        if (existingDoc) return { kind: "existing" as const, invoice: docToObj(existingDoc) };

        // coordinator 또는 admin만, coordinator는 해당 예약의 담당자만 생성 가능
        if (!isAdmin && callerRole !== "coordinator") {
          return { kind: "forbidden" as const, message: "코디네이터만 인보이스를 생성할 수 있습니다." };
        }
        if (!isAdmin) {
          const resCoordUids = Array.isArray(reservation.coordinatorUids) ? reservation.coordinatorUids as string[] : [];
          const resCoords = Array.isArray(reservation.coordinators) ? reservation.coordinators as string[] : [];
          const allowed = resCoordUids.length
            ? resCoordUids.includes(callerUid)
            : (!!callerName && resCoords.includes(callerName));
          if (!allowed) return { kind: "forbidden" as const, message: "담당 코디네이터만 인보이스를 생성할 수 있습니다." };
        }

        const invoiceRef = invoicesCol.doc();
        tx.set(invoiceRef, invoicePayload);
        tx.update(reservationRef, {
          invoiceId,
          invoiceDocId: invoiceRef.id,
          invoiceStatus: "draft",
          invoiceUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: staffName,
          updatedByUid: staffUid,
        });
        return { kind: "created" as const, invoiceDocId: invoiceRef.id };
      });

      if (txResult.kind === "existing") {
        if (!isCoordinatorOf(txResult.invoice)) {
          return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });
        }
        return NextResponse.json({ success: true, invoice: txResult.invoice, alreadyExists: true });
      }
      if (txResult.kind === "forbidden") {
        return NextResponse.json({ success: false, message: txResult.message }, { status: 403 });
      }

      await writeLog({
        action: "invoice_create", targetType: "invoice", targetId: txResult.invoiceDocId,
        staffUid, staffName, staffEmail, staffRole, staffCode: staffCode || "",
        patientId: cleanText(reservation.patientId),
        reservationId: cleanText(reservation.reservationId),
        message: `${staffName}님이 인보이스를 생성했습니다.`,
        after: { invoiceId, invoiceDocId: txResult.invoiceDocId },
      });

      // 고객관리 요약(인보이스 개수) 재계산 — best-effort
      await safeRecompute(
        () => recomputeInvoiceSummary(cleanText(reservation.patientId)),
        "create/invoice",
        cleanText(reservation.patientId)
      );

      const newSnap = await invoicesCol.doc(txResult.invoiceDocId).get();
      return NextResponse.json({ success: true, invoice: docToObj(newSnap), alreadyExists: false });
    }

    // ── UPDATE ───────────────────────────────────────────────────────────────
    if (action === "update") {
      const { invoiceDocId, ...fields } = payload as Record<string, unknown>;
      // 수정자/감사로그 신원은 검증된 토큰(ctx)만 사용 → 위조 차단
      const staffUid = ctx.uid, staffName = ctx.name, staffEmail = ctx.email, staffRole = ctx.role, staffCode = ctx.staffCode;

      const invoiceRef = adminDb.collection("invoices").doc(cleanText(invoiceDocId));
      const invoiceSnap = await invoiceRef.get();
      if (!invoiceSnap.exists) {
        return NextResponse.json({ success: false, message: "인보이스를 찾을 수 없습니다." });
      }
      const current = invoiceSnap.data() as Record<string, unknown>;

      if (!isCoordinatorOf(current)) {
        return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });
      }

      // 삭제된(soft delete) 인보이스는 수정 불가 — 부활 차단.
      if (current.isDeleted === true) {
        return NextResponse.json({ success: false, code: "INVOICE_DELETED", message: "삭제된 인보이스는 수정할 수 없습니다." }, { status: 400 });
      }

      // 클라이언트가 isDeleted를 보내 삭제 상태를 조작하는 것을 거부한다(서버 전용 필드).
      if (fields.isDeleted !== undefined) {
        return NextResponse.json({ success: false, code: "DISALLOWED_FIELD", message: "허용되지 않은 필드입니다: isDeleted" }, { status: 400 });
      }

      // status는 허용 enum만 통과(임의 문자열 → 400). 미전달 시 기존값 유지.
      if (fields.status !== undefined && !ALLOWED_INVOICE_STATUS.has(String(fields.status))) {
        return NextResponse.json({ success: false, message: "유효하지 않은 인보이스 상태입니다." }, { status: 400 });
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
        // isDeleted는 건드리지 않는다(삭제된 인보이스는 위에서 이미 거부). 강제 false 주입 금지.
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
      const { invoiceDocId } = payload as Record<string, string>;
      // 삭제자/감사로그 신원은 검증된 토큰(ctx)만 사용 → 위조 차단
      const staffUid = ctx.uid, staffName = ctx.name, staffEmail = ctx.email, staffRole = ctx.role, staffCode = ctx.staffCode;

      const invoiceRef = adminDb.collection("invoices").doc(invoiceDocId);
      const invoiceSnap = await invoiceRef.get();
      if (!invoiceSnap.exists) {
        return NextResponse.json({ success: false, message: "인보이스를 찾을 수 없습니다." });
      }
      const current = invoiceSnap.data() as Record<string, unknown>;

      if (!isCoordinatorOf(current)) {
        return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });
      }

      // 인보이스 soft delete와 연결된 예약의 invoice 필드 해제를 한 트랜잭션으로 원자화한다.
      // (부분 실패 시 인보이스만 삭제되고 예약에 링크가 남는 불일치 차단)
      const linkedReservationRef = adminDb.collection("reservations").doc(cleanText(current.reservationDocId));
      await adminDb.runTransaction(async (tx) => {
        const freshInvoice = await tx.get(invoiceRef);
        if (!freshInvoice.exists) throw new Error("인보이스를 찾을 수 없습니다.");
        const now = FieldValue.serverTimestamp();
        tx.update(invoiceRef, {
          isDeleted: true,
          updatedAt: now,
          updatedBy: staffName,
          updatedByUid: staffUid,
        });
        tx.update(linkedReservationRef, {
          invoiceId: "",
          invoiceDocId: "",
          invoiceStatus: "",
          invoiceUpdatedAt: now,
          updatedAt: now,
          updatedBy: staffName,
          updatedByUid: staffUid,
        });
      });

      await writeLog({
        action: "invoice_delete", targetType: "invoice", targetId: cleanText(current.invoiceId),
        staffUid, staffName, staffEmail, staffRole, staffCode: staffCode || "",
        patientId: cleanText(current.patientId), reservationId: cleanText(current.reservationId),
        message: `${staffName}님이 인보이스를 삭제했습니다.`,
        before: { invoiceId: current.invoiceId },
      });

      // 고객관리 요약(인보이스 개수) 재계산 — best-effort
      await safeRecompute(
        () => recomputeInvoiceSummary(cleanText(current.patientId)),
        "delete/invoice",
        cleanText(current.patientId)
      );

      return NextResponse.json({ success: true });
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (action === "list") {
      const { startDate, endDate, status, patientName, commissionStaffUid } =
        (payload || {}) as Record<string, string>;

      // 권한 스코프를 Firestore 쿼리로 내림 → 빈 페이지/누락/합계 오류 제거.
      //  - admin           : 전체(isDeleted=false) 최신순.
      //  - coordinator 이하 : 본인이 담당인 인보이스만. UID(coordinatorUids) 우선,
      //                       이름(coordinators) 병합으로 백필 전 데이터까지 포함.
      // 합계/필터를 정확히 계산하기 위해 페이지 단위가 아닌 "상한까지 전체"를 반환한다.
      // 인덱스: invoices (isDeleted, createdAt) / (coordinatorUids⊃, isDeleted, createdAt)
      //        / (coordinators⊃, isDeleted, createdAt) — firestore.indexes.json 참고.
      const HARD_CAP = 1000;
      const base = adminDb.collection("invoices").where("isDeleted", "==", false);

      // 날짜(기간)가 오면 surgeryDate 범위를 Firestore 쿼리로 내려 "해당 기간 문서만" 읽는다(읽기 절감).
      // 미전달 시 기존 createdAt 최신순 경로로 폴백. surgeryDate는 "YYYY-MM-DD" 문자열이라 사전식 범위가 날짜순과 일치.
      // 인덱스: (isDeleted, surgeryDate) / (coordinatorUids⊃, isDeleted, surgeryDate) / (coordinators⊃, isDeleted, surgeryDate)
      //         + 폴백용 createdAt 인덱스 — firestore.indexes.json 참고.
      // 주의: surgeryDate가 빈 인보이스는 범위 조회에서 제외됨(생성 시 reservationDate로 채워지므로 정상 케이스엔 영향 없음).
      const hasRange = !!(startDate || endDate);
      const sd = startDate || "0000-00-00";
      const ed = endDate || "9999-99-99";
      const applyScope = (q: FirebaseFirestore.Query): FirebaseFirestore.Query =>
        hasRange
          ? q.where("surgeryDate", ">=", sd).where("surgeryDate", "<=", ed).orderBy("surgeryDate", "desc").limit(HARD_CAP)
          : q.orderBy("createdAt", "desc").limit(HARD_CAP);

      const docsMap = new Map<string, FirebaseFirestore.DocumentData>();
      let rawCount = 0;
      const collect = (snap: FirebaseFirestore.QuerySnapshot) => {
        rawCount += snap.docs.length;
        for (const d of snap.docs) if (!docsMap.has(d.id)) docsMap.set(d.id, docToObj(d));
      };

      if (isAdmin) {
        collect(await applyScope(base).get());
      } else {
        const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [
          applyScope(base.where("coordinatorUids", "array-contains", callerUid)).get(),
        ];
        if (callerName) {
          queries.push(applyScope(base.where("coordinators", "array-contains", callerName)).get());
        }
        (await Promise.all(queries)).forEach(collect);
      }

      // 단일 쿼리가 상한에 닿으면 일부 누락 가능 → UI 경고용 플래그.
      const capped = rawCount >= HARD_CAP;

      // 병합 후 재정렬: 범위 조회면 surgeryDate desc, 폴백이면 createdAt desc.
      // (날짜 필터는 쿼리로 내렸으므로 메모리 후필터 불필요.)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let records = Array.from(docsMap.values()).sort((a: any, b: any) =>
        hasRange
          ? String(b.surgeryDate || "").localeCompare(String(a.surgeryDate || ""))
          : Number(b.createdAt || 0) - Number(a.createdAt || 0)
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (status) records = records.filter((r: any) => r.status === status);
      if (patientName) {
        const search = patientName.toLowerCase();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        records = records.filter((r: any) => cleanText(r.patientName).toLowerCase().includes(search));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (commissionStaffUid) records = records.filter((r: any) => r.commissionStaffUid === commissionStaffUid);

      // nextCursor/hasMore는 하위호환을 위해 유지(항상 전체 반환이므로 null/false).
      return NextResponse.json({
        success: true,
        invoices: records,
        total: records.length,
        capped,
        nextCursor: null,
        hasMore: false,
      });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[/api/invoices]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
