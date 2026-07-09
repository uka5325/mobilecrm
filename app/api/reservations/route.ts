import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import { toSerializable, docToObj } from "@/lib/adminUtils";
import { makePatientSearchTokens } from "@/lib/searchTokens";
import { recomputeReservationSummary, safeRecompute, createEmptyPatientSummary, reconcileDirtyPatients } from "@/lib/patientSummary";
import { identityKeyForPatient } from "@/lib/patientIdentity";
import {
  RESERVATION_LOCKS,
  buildLockDoc,
  isLockStale,
  isReservationActive,
  lockIdForReservation,
} from "@/lib/reservationLocks";
import { amountTypeFromUnknown, hasAmountValue } from "@/lib/reservationAmountRows";
import {
  deleteAllAmountRowsForPatient,
  deriveGroupKeysPatch,
  queryPatientAmountRows,
  syncReservationAmountRowsInTx,
} from "@/lib/patientAmountRows";

// 데이터 변경 action — 토큰 폐기 검사 적용
const WRITE_ACTIONS = new Set([
  "create",
  "create_patient",
  "update",
  "update_patient_profile",
  "toggleSurgery",
  "delete",
  "delete_patient",
]);

// generic update로 바꿀 수 있는 예약 필드 화이트리스트.
// firebase-admin은 규칙을 우회하므로, 서버에서 반드시 필드를 제한한다.
// isDeleted/createdBy*/invoice*/신원/식별자 필드는 의도적으로 제외 →
// - 삭제는 delete 액션(admin 전용)으로만
// - 인보이스 연동 필드는 /api/invoices 경유로만
// - 작성자/수정자 신원은 서버 ctx로만 강제
// 일반 예약 update 화이트리스트 — 수술 예약 상태(surgeryReserved/surgeryReservedAt)는
// 전용 toggleSurgery 액션에서만 변경하므로 여기서 제외한다.
const ALLOWED_RESERVATION_UPDATE_FIELDS = new Set([
  "name", "patientName", "birth", "birthInput", "gender", "phone", "nationality",
  "reservationDate", "reservationTime", "hospital", "appointmentType",
  "completed", "cancelled", "consultArea", "depositAmount", "surgeryCost",
  "coordinators", "doctors",
]);

const ALLOWED_PATIENT_UPDATE_FIELDS = new Set([
  "name", "birth", "birthInput", "gender", "phone", "nationality",
]);

// create 액션 화이트리스트 — isDeleted/invoice*/operationStatus 등 서버 전용·삭제 필드는
// 의도적으로 제외한다(직접 API 호출로 임의 필드 주입 차단).
const ALLOWED_PATIENT_CREATE_FIELDS = new Set([
  "patientId", "name", "birth", "birthInput", "gender", "phone", "nationality",
]);

// 일반 예약 create 화이트리스트 — 상태(completed/cancelled/surgeryReserved/surgeryReservedAt)와
// invoice 필드(invoiceUrl/invoiceId/invoiceSheetName/invoiceDocId/invoiceStatus)는 서버가
// 기본값을 기록하거나 전용 액션에서만 설정한다. 클라가 주입하면 400(DISALLOWED_FIELD)으로 거부.
const ALLOWED_RESERVATION_CREATE_FIELDS = new Set([
  "reservationId", "patientId",
  "name", "patientName", "birth", "birthInput", "gender", "phone", "nationality",
  "reservationDate", "reservationTime", "hospital", "appointmentType",
  "depositAmount", "surgeryCost", "consultArea",
  "doctors", "coordinators",
]);

// 서버가 신원을 강제하는 필드 — 합법 클라이언트가 보낼 수 있어 조용히 무시한다(거부하지 않음).
const SERVER_MANAGED_IGNORE = new Set(["updatedBy", "updatedByUid", "updatedAt"]);

const CREATE_SERVER_MANAGED_IGNORE = new Set([
  "createdBy", "createdByUid", "updatedBy", "updatedByUid", "createdAt", "updatedAt", "isDeleted", "searchTokens",
]);

// patch를 검증해 {safe, disallowed}로 분리한다.
// - 허용 필드 → safe에 통과
// - 서버관리 필드(ignore) → 조용히 무시
// - 그 외(isDeleted/createdBy*/invoice*/식별자 등) → disallowed에 수집(호출부에서 거부)
function splitPatch(
  patch: Record<string, unknown> | undefined | null,
  allowed: Set<string>,
  ignore: Set<string> = SERVER_MANAGED_IGNORE
): { safe: Record<string, unknown>; disallowed: string[] } {
  const safe: Record<string, unknown> = {};
  const disallowed: string[] = [];
  if (!patch || typeof patch !== "object") return { safe, disallowed };
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.has(k)) safe[k] = v;
    else if (ignore.has(k)) continue;
    else disallowed.push(k);
  }
  return { safe, disallowed };
}

function withAmountFlags<T extends Record<string, unknown>>(data: T): T & { hasDepositAmount: boolean; hasSurgeryCost: boolean } {
  return {
    ...data,
    hasDepositAmount: hasAmountValue(data.depositAmount),
    hasSurgeryCost: hasAmountValue(data.surgeryCost),
  };
}

function deriveAmountFlagPatch(patch: Record<string, unknown>): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  if (Object.prototype.hasOwnProperty.call(patch, "depositAmount")) {
    flags.hasDepositAmount = hasAmountValue(patch.depositAmount);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "surgeryCost")) {
    flags.hasSurgeryCost = hasAmountValue(patch.surgeryCost);
  }
  return flags;
}

// create 액션의 중복예약 트랜잭션에서 "중복이라 저장하지 않음"을 알리기 위한 마커 에러.
class DuplicateReservationError extends Error {}
class PatientDeletedError extends Error {}
class PatientCandidatesError extends Error {
  candidates: Array<{ patientDocId: string; patientId: string; name: string; birth: string; phone: string; nationality: string }>;
  constructor(candidates: PatientCandidatesError["candidates"]) {
    super("PATIENT_CANDIDATES");
    this.candidates = candidates;
  }
}

// 의사 목록은 거의 변경되지 않으므로 서버 메모리에 10분 캐싱
let _doctorsCache: Record<string, unknown>[] | null = null;
let _doctorsCacheAt = 0;
const DOCTORS_CACHE_TTL = 10 * 60 * 1000;

async function getCachedDoctors(): Promise<Record<string, unknown>[]> {
  if (_doctorsCache && Date.now() - _doctorsCacheAt < DOCTORS_CACHE_TTL) return _doctorsCache;
  const snap = await adminDb.collection("staff").where("role", "==", "doctor").where("active", "==", true).get();
  const result = snap.docs.map(docToObj);
  _doctorsCache = result;
  _doctorsCacheAt = Date.now();
  return result;
}

// read_all 안전 상한 — 응답에 capped 플래그로 노출해 UI가 "일부만 표시" 경고 가능
const READ_ALL_CAP = 500;

// 예약 감사로그를 서버에서 권위 있게 기록 → 직접 API 호출/우회도 남고, 신원 위조를 차단.
// (클라이언트 createLog는 중복 방지를 위해 제거됨)
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
  ctx: Awaited<ReturnType<typeof requireActiveStaff>>,
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

function writeReservationLogInTx(
  tx: FirebaseFirestore.Transaction,
  ctx: Awaited<ReturnType<typeof requireActiveStaff>>,
  params: ReservationLogParams
) {
  tx.set(adminDb.collection("logs").doc(), buildReservationLogData(ctx, params));
}

function writeReservationLogInBatch(
  batch: FirebaseFirestore.WriteBatch,
  ctx: Awaited<ReturnType<typeof requireActiveStaff>>,
  params: ReservationLogParams
) {
  batch.set(adminDb.collection("logs").doc(), buildReservationLogData(ctx, params));
}

async function writeReservationLog(
  ctx: Awaited<ReturnType<typeof requireActiveStaff>>,
  params: ReservationLogParams
) {
  await adminDb.collection("logs").add(buildReservationLogData(ctx, params));
}

// 같은 신원(identityKey)의 첫 문서만 남기는 in-memory dedup — 병합 스크립트 실행 전 과도기
// 안전망. identityKey가 없는(미backfill) 문서는 dedup하지 않고 그대로 둔다. 근본 정리(중복 문서
// soft-delete)는 scripts/reconcile-duplicate-patients.ts가 수행한다.
function dedupByIdentity(rows: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const r of rows) {
    const key = String((r as { identityKey?: unknown })?.identityKey || "");
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(r);
  }
  return out;
}


export async function POST(req: NextRequest) {
  try {
    const { idToken, action, payload } = await req.json();

    // 활성 직원 인가 — 쓰기 action은 토큰 폐기 검사까지 수행
    let ctx;
    try {
      ctx = await requireActiveStaff(idToken, { checkRevoked: WRITE_ACTIONS.has(action) });
    } catch (authErr) {
      const res = toAuthErrorResponse(authErr);
      if (res) return res;
      throw authErr;
    }

    // ── READ: all reservations (last N months) + doctors ──────────────────
    if (action === "read_all") {
      const { from, to } = (payload || {}) as { from?: string; to?: string };
      // 기본 조회 범위: 45일 전 (약 1.5개월) — 6개월 전체 스캔 방지
      const fromDate = from || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 45);
        return d.toISOString().slice(0, 10);
      })();

      let resQ = adminDb
        .collection("reservations")
        .where("isDeleted", "==", false)
        .where("reservationDate", ">=", fromDate)
        .orderBy("reservationDate", "desc")
        .limit(READ_ALL_CAP);
      if (to) resQ = resQ.where("reservationDate", "<=", to) as typeof resQ;

      const [rSnap, doctors] = await Promise.all([resQ.get(), getCachedDoctors()]);

      return NextResponse.json({
        success: true,
        reservations: rSnap.docs.map(docToObj),
        doctors,
        // 상한에 닿으면 더 오래된 예약이 잘렸을 수 있음 → UI가 "일부만 표시" 경고에 사용
        capped: rSnap.docs.length === READ_ALL_CAP,
      });
    }

    // ── READ: 기간 전체 예약(KPI용) — 서버 cursor pagination으로 500 상한을 넘겨 전체 집계 ──
    // 대시보드 KPI가 500건 상한에 조용히 잘린 부분집계를 정상 수치처럼 표시하던 문제를 없앤다.
    // 페이지(500)를 반복 조회해 기간 전체를 모으고, 하드 상한(MAX_KPI_ROWS)을 넘으면
    // capped=true(KPI_QUERY_LIMIT_EXCEEDED)로 표시해 UI가 "부분 집계/기간 축소"를 안내한다.
    if (action === "read_range_all") {
      const { from, to } = (payload || {}) as { from?: string; to?: string };
      if (!from || !to) {
        return NextResponse.json({ success: false, message: "조회 기간(from/to)이 필요합니다." }, { status: 400 });
      }
      const PAGE = 500;
      const MAX_KPI_ROWS = 20000; // 하드 상한(약 40페이지) — 초과 시 명시적 제한 오류
      const all: Record<string, unknown>[] = [];
      let cursorSnap: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      let capped = false;

      // orderBy(reservationDate desc) + startAfter(문서 스냅샷)로 안정적 커서 페이지네이션.
      for (;;) {
        let q = adminDb
          .collection("reservations")
          .where("isDeleted", "==", false)
          .where("reservationDate", ">=", from)
          .where("reservationDate", "<=", to)
          .orderBy("reservationDate", "desc")
          .limit(PAGE);
        if (cursorSnap) q = q.startAfter(cursorSnap) as typeof q;
        const snap = await q.get();
        if (snap.empty) break;
        for (const d of snap.docs) all.push(docToObj(d));
        if (all.length >= MAX_KPI_ROWS) { capped = true; break; }
        if (snap.docs.length < PAGE) break;
        cursorSnap = snap.docs[snap.docs.length - 1];
      }

      if (capped) {
        // 부분 집계를 정상 KPI로 표시하지 않도록 명시적 제한 오류로 반환.
        return NextResponse.json({
          success: false,
          code: "KPI_QUERY_LIMIT_EXCEEDED",
          message: `조회 기간의 예약이 ${MAX_KPI_ROWS}건을 초과합니다. 기간을 좁혀 다시 조회해 주세요.`,
          limit: MAX_KPI_ROWS,
        }, { status: 413 });
      }

      return NextResponse.json({ success: true, reservations: all, capped: false });
    }

    // ── READ: patient full reservation history (no date limit, cursor pagination) ──
    if (action === "patient_history") {
      const { patientId, cursor } = (payload || {}) as { patientId?: string; cursor?: string };
      if (!patientId) {
        return NextResponse.json({ success: false, message: "patientId가 없습니다." }, { status: 400 });
      }

      let q = adminDb
        .collection("reservations")
        .where("patientId", "==", patientId)
        .where("isDeleted", "==", false)
        .orderBy("reservationDate", "desc")
        .limit(10);

      if (cursor) {
        const cursorDoc = await adminDb.collection("reservations").doc(cursor).get();
        if (cursorDoc.exists) q = q.startAfter(cursorDoc) as typeof q;
      }

      const snap = await q.get();
      const hasMore = snap.docs.length === 10;
      return NextResponse.json({
        success: true,
        reservations: snap.docs.map(docToObj),
        nextCursor: hasMore ? snap.docs[snap.docs.length - 1].id : null,
        hasMore,
      });
    }


    // ── READ: patient amount rows only (예약금/수술비 팝오버 전용) ──
    // 예약 원본이 아니라 materialized 컬렉션(patientAmountRows) 만 조회한다.
    // 예약 write 액션이 이 컬렉션을 트랜잭션 안에서 동기화하므로 배지 카운트와 항상 일치.
    if (action === "patient_amount_rows") {
      const { patientId } = (payload || {}) as { patientId?: string };
      if (!patientId) {
        return NextResponse.json({ success: false, message: "patientId가 없습니다." }, { status: 400 });
      }
      const type = amountTypeFromUnknown((payload || {}).type);
      const rows = await queryPatientAmountRows(adminDb, patientId, type);

      return NextResponse.json({ success: true, rows });
    }

    // ── READ: patient FULL reservation history (no pagination, safety-capped) ──
    // 고객관리 환자 카드 배지(총 건수/예약금/수술비용/부위)와 "전체 이력" 모달을
    // 라이브 구독 윈도우와 완전히 분리하기 위한 전용 액션. patient_history와 동일
    // 쿼리/인덱스, cursor 없이 1회 반환(최대 300건).
    if (action === "patient_full_history") {
      const { patientId } = (payload || {}) as { patientId?: string };
      if (!patientId) {
        return NextResponse.json({ success: false, message: "patientId가 없습니다." }, { status: 400 });
      }

      const CAP = 300;
      const snap = await adminDb
        .collection("reservations")
        .where("patientId", "==", patientId)
        .where("isDeleted", "==", false)
        .orderBy("reservationDate", "desc")
        .limit(CAP)
        .get();

      return NextResponse.json({
        success: true,
        reservations: snap.docs.map(docToObj),
        capped: snap.docs.length === CAP,
      });
    }

    // ── READ: 여러 환자의 "45일보다 오래된" 예약 이력을 한 번에 조회 ─────────
    // 고객관리 카드 배지가 환자당 patient_full_history를 N번 부르던 걸 1번으로 묶는다.
    // 라이브 구독(45일 윈도우)이 이미 최근 이력을 갖고 있으므로, 여기서는 그보다
    // 오래된 것만 읽어 중복 읽기를 피한다. patientId는 Firestore in 제약(최대 30개)에 맞춰
    // 호출부에서 청크 분할해서 보낸다.
    if (action === "patient_full_history_batch") {
      const { patientIds, before } = (payload || {}) as { patientIds?: string[]; before?: string };
      const ids = Array.isArray(patientIds) ? patientIds.filter(Boolean).slice(0, 30) : [];
      if (!ids.length || !before) {
        return NextResponse.json({ success: false, message: "patientIds/before가 없습니다." }, { status: 400 });
      }

      const SAFETY_CAP = 1000;
      const snap = await adminDb
        .collection("reservations")
        .where("patientId", "in", ids)
        .where("isDeleted", "==", false)
        .where("reservationDate", "<", before)
        .orderBy("reservationDate", "desc")
        .limit(SAFETY_CAP)
        .get();

      const byPatient: Record<string, Record<string, unknown>[]> = {};
      for (const id of ids) byPatient[id] = [];
      for (const doc of snap.docs) {
        const obj = docToObj(doc);
        const pid = String(obj.patientId || "");
        if (byPatient[pid]) byPatient[pid].push(obj);
      }

      return NextResponse.json({ success: true, byPatient });
    }

    // ── READ: reservations for a specific date + doctors ──────────────────
    if (action === "read_by_date") {
      const { date } = (payload || {}) as { date: string };

      const [rSnap, doctors] = await Promise.all([
        adminDb
          .collection("reservations")
          .where("isDeleted", "==", false)
          .where("reservationDate", "==", date)
          .get(),
        getCachedDoctors(),
      ]);

      return NextResponse.json({
        success: true,
        reservations: rSnap.docs.map(docToObj),
        doctors,
      });
    }

    // ── READ: single reservation ──────────────────────────────────────────
    if (action === "read_one") {
      const { reservationDocId } = (payload || {}) as { reservationDocId: string };
      const snap = await adminDb.collection("reservations").doc(reservationDocId).get();
      if (!snap.exists) {
        return NextResponse.json({ success: false, message: "예약을 찾을 수 없습니다." });
      }
      return NextResponse.json({ success: true, reservation: docToObj(snap) });
    }

    // ── READ: doctors only ────────────────────────────────────────────────
    if (action === "read_doctors") {
      const doctors = await getCachedDoctors();
      return NextResponse.json({ success: true, doctors });
    }

    // ── CREATE PATIENT ONLY ───────────────────────────────────────────────
    if (action === "create_patient") {
      const { patient } = payload as { patient: Record<string, unknown> };

      const { safe: safePatient, disallowed } = splitPatch(patient, ALLOWED_PATIENT_CREATE_FIELDS, CREATE_SERVER_MANAGED_IGNORE);
      if (disallowed.length) {
        return NextResponse.json(
          { success: false, message: `허용되지 않은 필드입니다: ${disallowed.join(", ")}` },
          { status: 400 }
        );
      }

      const now = FieldValue.serverTimestamp();

      // 신원(이름+생년월일+국적+성별) 기반 중복 방지: 같은 사람이 서로 다른 랜덤 patientId로
      // 여러 문서로 저장되던 문제를 막는다. 신원 일치 활성 환자가 있으면 그 문서로 연결한다.
      const identityKey = identityKeyForPatient(safePatient);
      if (identityKey) {
        const existingByIdentity = await adminDb
          .collection("patients")
          .where("identityKey", "==", identityKey)
          .where("isDeleted", "==", false)
          .limit(1)
          .get();
        if (!existingByIdentity.empty) {
          const doc = existingByIdentity.docs[0];
          return NextResponse.json({
            success: true,
            patientDocId: doc.id,
            patientId: String(doc.data().patientId || ""),
            linkedExistingPatient: true,
          });
        }
      }

      // 중복 방지(정책: 연결만·없으면 생성): 같은 patientId 문서가 이미 있으면 그걸 반환.
      // 단, 삭제된 고객이면 조용히 재연결(부활)하지 않는다 — 자동 복구 기능은 범위 밖.
      const incomingPatientId = String((safePatient as { patientId?: unknown }).patientId || "");
      if (incomingPatientId) {
        const existing = await adminDb
          .collection("patients")
          .where("patientId", "==", incomingPatientId)
          .limit(1)
          .get();
        if (!existing.empty) {
          if (existing.docs[0].data().isDeleted === true) {
            return NextResponse.json({
              success: false,
              code: "PATIENT_DELETED",
              message: "삭제된 고객입니다. 관리자 복구 후 다시 시도해 주세요.",
            }, { status: 409 });
          }
          return NextResponse.json({ success: true, patientDocId: existing.docs[0].id, linkedExistingPatient: true });
        }
      }

      // 신규는 문서 ID를 patientId로 고정(동시성 중복 차단). 비면 auto-id 폴백.
      const ref = incomingPatientId
        ? adminDb.collection("patients").doc(incomingPatientId)
        : adminDb.collection("patients").doc();
      // 작성자 신원은 검증된 토큰(ctx)으로 강제 → 위조 차단
      // 요약 기본값을 함께 기록 → 예약 없이 생성돼도 고객관리 목록(list_patients_summary)에 노출된다.
      await ref.set({
        ...createEmptyPatientSummary(),
        ...safePatient,
        searchTokens: makePatientSearchTokens(String((safePatient as { name?: unknown }).name || "")),
        identityKey,
        isDeleted: false,
        createdBy: ctx.name, createdByUid: ctx.uid,
        updatedBy: ctx.name, updatedByUid: ctx.uid,
        createdAt: now, updatedAt: now,
      });
      return NextResponse.json({ success: true, patientDocId: ref.id });
    }

    // ── LIST PATIENTS ─────────────────────────────────────────────────────
    if (action === "list_patients") {
      // 무제한 스캔 방지를 위한 안전 상한. 클라이언트가 전체 목록으로 검색하므로
      // 최신 환자 우선으로 상한까지만 반환. (향후 서버사이드 검색으로 대체 권장)
      const LIST_PATIENTS_CAP = 2000;
      // NOTE(P3): 서버측 where("isDeleted","==",false) 필터는 기존/신규 patient 문서에
      // isDeleted 필드가 채워진 뒤에만 안전하다(미존재 문서가 쿼리에서 누락됨).
      // 신규 문서는 아래 create 경로에서 isDeleted=false로 채우며, 전수 backfill 후
      // patients (isDeleted, createdAt desc) 인덱스를 사용해 쿼리 필터로 전환 가능.
      // 그 전까지는 호환을 위해 메모리 필터를 유지한다.
      const snap = await adminDb.collection("patients")
        .orderBy("createdAt", "desc")
        .limit(LIST_PATIENTS_CAP)
        .get();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = snap.docs.flatMap((d: any) => {
        const data = d.data();
        if (data.isDeleted === true) return [];
        return [toSerializable({ id: d.id, ...data })];
      });
      return NextResponse.json({ success: true, patients: dedupByIdentity(rows) });
    }

    // ── SEARCH PATIENTS (검색토큰 array-contains — 매칭만 읽음) ─────────────
    // 전체 스캔(list_patients) 대신, 단어 단위 토큰으로 매칭된 환자만 읽는다.
    // 색인: searchTokens array-contains 단일 필드 → 자동(복합 불필요).
    if (action === "search_patients") {
      const { term } = (payload || {}) as { term?: string };
      const t = String(term || "").trim().toLowerCase();
      if (!t) return NextResponse.json({ success: true, patients: [] });
      const snap = await adminDb.collection("patients")
        .where("searchTokens", "array-contains", t)
        .limit(50)
        .get();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = snap.docs.flatMap((d: any) => {
        const data = d.data();
        if (data.isDeleted === true) return [];
        return [toSerializable({ id: d.id, ...data })];
      });
      return NextResponse.json({ success: true, patients: dedupByIdentity(rows) });
    }

    // ── LIST PATIENTS BY SUMMARY (고객관리 첫 화면 — patients만 읽기) ─────────
    // patients 요약(lastReservationDate)으로 최근순 페이지네이션. 45일 라이브 윈도우와
    // 무관하게 과거 환자도 노출되며, 배지는 저장된 summary 필드로 표시(추가 조회 0).
    // 인덱스: patients (isDeleted ASC, lastReservationDate DESC) — firestore.indexes.json.
    if (action === "list_patients_summary") {
      const { cursor, limit } = (payload || {}) as { cursor?: string; limit?: number };
      const pageSize = Math.min(Math.max(Number(limit) || 10, 1), 50);

      let q = adminDb
        .collection("patients")
        .where("isDeleted", "==", false)
        .orderBy("lastReservationDate", "desc")
        .limit(pageSize);

      if (cursor) {
        const curDoc = await adminDb.collection("patients").doc(cursor).get();
        if (curDoc.exists) q = q.startAfter(curDoc) as typeof q;
      }

      const snap = await q.get();
      const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null;

      // summaryDirty 환자 자동 재계산 (best-effort, 응답 차단하지 않음)
      reconcileDirtyPatients(5).catch(() => {});

      return NextResponse.json({
        success: true,
        patients: dedupByIdentity(snap.docs.map(docToObj)),
        nextCursor,
        hasMore: !!nextCursor,
      });
    }

    // ── CREATE ────────────────────────────────────────────────────────────
    if (action === "create") {
      const { patient, reservation } = payload as {
        patient: Record<string, unknown>;
        reservation: Record<string, unknown>;
      };

      const { safe: safePatient, disallowed: patDisallowed } = splitPatch(patient, ALLOWED_PATIENT_CREATE_FIELDS, CREATE_SERVER_MANAGED_IGNORE);
      const { safe: safeReservation, disallowed: resDisallowed } = splitPatch(reservation, ALLOWED_RESERVATION_CREATE_FIELDS, CREATE_SERVER_MANAGED_IGNORE);
      const createDisallowed = [...patDisallowed, ...resDisallowed];
      if (createDisallowed.length) {
        return NextResponse.json(
          { success: false, code: "DISALLOWED_FIELD", message: `허용되지 않은 필드입니다: ${createDisallowed.join(", ")}` },
          { status: 400 }
        );
      }

      // patientId는 환자 문서를 canonical 소스로 삼는다. reservation.patientId가 다르면 거부하고,
      // 이후 서버가 canonical 값으로 강제한다(예약이 엉뚱한 환자에 붙는 것 차단).
      const canonicalPatientId = String((safePatient as { patientId?: unknown }).patientId || "");
      const reservationPatientId = String((safeReservation as { patientId?: unknown }).patientId || "");
      if (reservationPatientId && canonicalPatientId && reservationPatientId !== canonicalPatientId) {
        return NextResponse.json(
          { success: false, code: "PATIENT_ID_MISMATCH", message: "환자 식별자가 일치하지 않습니다." },
          { status: 400 }
        );
      }
      safeReservation.patientId = canonicalPatientId;

      // 상태·invoice 필드는 서버가 기본값을 기록한다(클라 주입은 위 화이트리스트에서 이미 차단).
      // surgeryReservedAt은 기록하지 않는다(수술 예약 전용 액션에서만 설정).
      const reservationDefaults = {
        completed: false,
        cancelled: false,
        surgeryReserved: false,
        invoiceUrl: "",
        invoiceId: "",
        invoiceSheetName: "",
      };

      const dupResId = String(safeReservation.reservationId || "");
      // 중복 방지 lock — 이름/날짜/시간/전화/병원/유형/원장 조합의 sha256을 문서 ID로 쓴다.
      // (공통 helper lib/reservationLocks.ts — create/update/cancel/delete/스크립트가 동일 규칙 사용)
      const lockId = lockIdForReservation(safeReservation);
      const lockRef = lockId ? adminDb.collection(RESERVATION_LOCKS).doc(lockId) : null;

      const now = FieldValue.serverTimestamp();
      const authorFields = {
        createdBy: ctx.name, createdByUid: ctx.uid,
        updatedBy: ctx.name, updatedByUid: ctx.uid,
      };
      const incomingPatientId = String((safePatient as { patientId?: unknown }).patientId || "");
      // 신원(이름+생년월일+국적+성별) 키 — patientId로 못 찾을 때 기존 환자 연결에 쓴다.
      const identityKey = identityKeyForPatient(safePatient);
      const reservationRef = adminDb.collection("reservations").doc();

      let resultPatientDocId = "";
      let linkedExistingPatient = false;
      let staleLockRepaired = false;

      try {
        await adminDb.runTransaction(async (tx) => {
          // ── 읽기(전부 쓰기보다 먼저) ──────────────────────────────────
          if (dupResId) {
            const idSnap = await tx.get(
              adminDb.collection("reservations").where("reservationId", "==", dupResId).where("isDeleted", "==", false)
            );
            if (!idSnap.empty) throw new DuplicateReservationError();
          }
          if (lockRef) {
            const lockSnap = await tx.get(lockRef);
            if (lockSnap.exists) {
              // 기존 lock이 가리키는 예약이 아직 "이 lockId를 그대로 갖는" 활성 예약이면 진짜 중복.
              // 없음/삭제/취소되었거나, 활성이어도 현재 계산한 lockId가 이 문서 ID와 다르면(stale) 정리 후 재사용.
              const targetDocId = String(lockSnap.data()?.reservationDocId || "");
              let targetData: Record<string, unknown> | null = null;
              if (targetDocId) {
                const targetSnap = await tx.get(adminDb.collection("reservations").doc(targetDocId));
                targetData = targetSnap.exists ? (targetSnap.data() as Record<string, unknown>) : null;
              }
              if (!isLockStale(lockId, targetData)) throw new DuplicateReservationError();
              staleLockRepaired = true; // 아래 tx.set이 stale lock을 덮어써 self-heal
            }
          }
          // 기존 환자에 예약 추가(정책: 연결만·없으면 생성):
          // patientId가 있고 patients 문서가 이미 있으면 마스터를 건드리지 않고 예약만 생성한다.
          // (마스터 정정은 update_patient_profile / savePatientEdit 전용 경로로만)
          let existingPatientDocId = "";
          let canonicalPatientId = "";
          if (incomingPatientId) {
            const pSnap = await tx.get(
              adminDb.collection("patients").where("patientId", "==", incomingPatientId).limit(1)
            );
            if (!pSnap.empty) {
              // 삭제된 고객은 조용히 재연결(부활)하지 않는다 — 관리자 복구 절차 없이 신규 예약만으로
              // 살아나면 안 된다. 자동 복구 기능은 이번 작업 범위 밖.
              if (pSnap.docs[0].data().isDeleted === true) throw new PatientDeletedError();
              existingPatientDocId = pSnap.docs[0].id;
              canonicalPatientId = String(pSnap.docs[0].data().patientId || incomingPatientId);
            }
          }
          // patientId로 못 찾았으면 신원(이름+생년월일+국적+성별)으로 유사 환자를 검색한다.
          // 자동 병합 대신, 후보가 있으면 클라이언트에 반환하여 직원이 선택하도록 한다.
          if (!existingPatientDocId && identityKey) {
            const skipIdentityCheck = (payload as Record<string, unknown>).confirmNewPatient === true;
            if (!skipIdentityCheck) {
              const iSnap = await tx.get(
                adminDb.collection("patients")
                  .where("identityKey", "==", identityKey)
                  .where("isDeleted", "==", false)
                  .limit(5)
              );
              if (!iSnap.empty) {
                const candidates = iSnap.docs.map((d) => {
                  const data = d.data() as Record<string, unknown>;
                  return {
                    patientDocId: d.id,
                    patientId: String(data.patientId || ""),
                    name: String(data.name || ""),
                    birth: String(data.birth || ""),
                    phone: String(data.phone || "").replace(/(.{3}).+(.{4})$/, "$1****$2"),
                    nationality: String(data.nationality || ""),
                  };
                });
                throw new PatientCandidatesError(candidates);
              }
            }
            // confirmNewPatient=true이면 신규 환자로 진행
            // linkToPatientId가 있으면 지정된 기존 환자에 연결
            const linkTo = String((payload as Record<string, unknown>).linkToPatientId || "");
            if (linkTo) {
              const linkSnap = await tx.get(
                adminDb.collection("patients").where("patientId", "==", linkTo).where("isDeleted", "==", false).limit(1)
              );
              if (!linkSnap.empty) {
                existingPatientDocId = linkSnap.docs[0].id;
                canonicalPatientId = linkTo;
              }
            }
          }
          // 기존 환자로 연결되면 예약의 patientId도 대표 값으로 맞춘다(랜덤 값 폐기 → 이력/요약 정합).
          if (canonicalPatientId) safeReservation.patientId = canonicalPatientId;

          // 예약 완성본(after) — 이 시점의 canonical patientId/신원 필드 반영본을 amountRows 동기화에 넘긴다.
          const afterReservation = {
            ...reservationDefaults,
            ...safeReservation,
            ...deriveGroupKeysPatch(safeReservation),
            isDeleted: false,
          };

          // amountRows sync (모든 read 이후, 모든 write 이전)
          await syncReservationAmountRowsInTx(tx, adminDb, ctx, {
            patientId: String(safeReservation.patientId || ""),
            reservationDocId: reservationRef.id,
            before: null,
            after: afterReservation,
            now,
          });

          // ── 쓰기(원자적) ──────────────────────────────────────────────
          if (lockRef) tx.set(lockRef, buildLockDoc({
            reservationDocId: reservationRef.id,
            reservationId: dupResId,
            patientId: incomingPatientId,
            lockId: lockId,
            now,
          }));

          if (existingPatientDocId) {
            tx.set(reservationRef, withAmountFlags({ ...afterReservation, ...authorFields, createdAt: now, updatedAt: now }));
            resultPatientDocId = existingPatientDocId;
            linkedExistingPatient = true;
          } else {
            // 신규 환자는 문서 ID를 patientId로 고정 → 같은 patientId 동시 생성이 같은 문서를 가리켜
            // 중복 doc이 생기지 않는다(auto-id 경합 창 제거). patientId가 비면 auto-id 폴백.
            const patientRef = incomingPatientId
              ? adminDb.collection("patients").doc(incomingPatientId)
              : adminDb.collection("patients").doc();
            // 요약 기본값을 함께 기록 → 예약 없이 생성돼도 고객관리 목록에 노출된다.
            // (직후 recomputeReservationSummary가 실제 값으로 덮어써도 무해)
            tx.set(patientRef, {
              ...createEmptyPatientSummary(),
              ...safePatient,
              searchTokens: makePatientSearchTokens(String((safePatient as { name?: unknown }).name || "")),
              identityKey,
              isDeleted: false,
              ...authorFields,
              createdAt: now, updatedAt: now,
            });
            tx.set(reservationRef, withAmountFlags({ ...afterReservation, ...authorFields, createdAt: now, updatedAt: now }));
            resultPatientDocId = patientRef.id;
          }

          writeReservationLogInTx(tx, ctx, {
            action: "reservation_create",
            targetId: String(safeReservation.reservationId || reservationRef.id),
            patientId: String(safeReservation.patientId || ""),
            reservationId: String(safeReservation.reservationId || ""),
            message: `${ctx.name}님이 신규 예약을 등록했습니다.`,
            before: null,
            after: {
              name: safeReservation.name ?? "",
              reservationDate: safeReservation.reservationDate ?? "",
              reservationTime: safeReservation.reservationTime ?? "",
              hospital: safeReservation.hospital ?? "",
              appointmentType: safeReservation.appointmentType ?? "",
              linkedExistingPatient,
            },
            now,
          });
        });
      } catch (e) {
        if (e instanceof DuplicateReservationError) {
          return NextResponse.json({
            success: false,
            message: "이미 등록된 예약으로 보여 저장하지 않았습니다.",
            duplicate: true,
          });
        }
        if (e instanceof PatientDeletedError) {
          return NextResponse.json({
            success: false,
            code: "PATIENT_DELETED",
            message: "삭제된 고객입니다. 관리자 복구 후 다시 시도해 주세요.",
          }, { status: 409 });
        }
        if (e instanceof PatientCandidatesError) {
          return NextResponse.json({
            success: false,
            code: "PATIENT_CANDIDATES",
            message: "유사한 기존 환자가 발견되었습니다. 기존 환자에 연결하거나 새 환자로 등록해 주세요.",
            candidates: e.candidates,
          }, { status: 409 });
        }
        throw e;
      }

      // stale lock을 정리하고 재사용했으면 관측 가능하게 로그를 남긴다(민감정보 없음).
      if (staleLockRepaired) {
        await writeReservationLog(ctx, {
          action: "STALE_LOCK_REPAIRED",
          targetId: reservationRef.id,
          patientId: String(safeReservation.patientId || ""),
          reservationId: dupResId,
          message: "생성 중 stale reservation lock을 정리하고 재사용했습니다.",
          before: null,
          after: { lockId, reservationDocId: reservationRef.id },
          now,
        });
      }

      // 고객관리 요약(예약 파생) 재계산 — best-effort
      await safeRecompute(
        () => recomputeReservationSummary(String(safeReservation.patientId || "")),
        "create/reservation",
        String(safeReservation.patientId || "")
      );

      return NextResponse.json({
        success: true,
        patientDocId: resultPatientDocId,
        reservationDocId: reservationRef.id,
        ...(linkedExistingPatient ? { linkedExistingPatient: true } : {}),
      });
    }

    // ── UPDATE ────────────────────────────────────────────────────────────
    if (action === "update") {
      // 예약 update는 reservations 문서만 수정한다. 환자 마스터(patients) 정정은
      // update_patient_profile 전용 액션이 전담한다(책임 분리). 따라서 patientPatch/
      // patientDocId는 받지 않으며, 식별자(patientId/reservationId)는 클라 값을 신뢰하지 않고
      // 서버가 reservationDocId로 읽은 기존 문서에서 canonical 값을 파생한다.
      const { reservationDocId, reservationPatch } = payload as {
        reservationDocId: string;
        reservationPatch: Record<string, unknown>;
      };

      // 필드 화이트리스트 — 비허용 필드(isDeleted/createdBy*/invoice*/식별자 등)가 하나라도
      // 있으면 "조용히 무시"가 아니라 요청을 거부한다(숨은 버그·악성 payload 노출).
      // (admin SDK는 규칙을 우회하므로 서버가 유일한 방어선)
      const { safe: safeReservationPatch, disallowed: resDisallowed } = splitPatch(reservationPatch, ALLOWED_RESERVATION_UPDATE_FIELDS);

      if (resDisallowed.length) {
        return NextResponse.json(
          { success: false, code: "DISALLOWED_FIELD", message: `허용되지 않은 필드입니다: ${resDisallowed.join(", ")}` },
          { status: 400 }
        );
      }
      if (!Object.keys(safeReservationPatch).length) {
        return NextResponse.json({ success: false, message: "변경할 필드가 없습니다." }, { status: 400 });
      }

      const now = FieldValue.serverTimestamp();
      const resRef = adminDb.collection("reservations").doc(reservationDocId);

      // dupKey 구성요소(날짜/시간/신원/병원/유형/원장)나 취소 상태가 바뀌면 lock을 재조정해야
      // 하므로, 읽기·검증·lock 재배치·update를 한 트랜잭션으로 원자화한다.
      // 트랜잭션은 내부 충돌 시 콜백을 처음부터 재실행할 수 있으므로, 콜백 밖의 mutable
      // 변수에 상태를 쌓지 않고 "이번 실행에서 실제로 무슨 일이 있었는지"를 타입드 반환값
      // 하나로만 전달한다(재시도 시 이전 시도의 flag가 새어나오는 것을 원천 차단).
      const outcome = await adminDb.runTransaction<
        | { kind: "not_found" }
        | { kind: "duplicate" }
        | { kind: "ownership_mismatch" }
        | {
            kind: "ok";
            canonicalPatientId: string;
            canonicalReservationId: string;
            beforeChanged: Record<string, unknown>;
            staleLockRepaired: boolean;
          }
      >(async (tx) => {
        const beforeSnap = await tx.get(resRef);
        if (!beforeSnap.exists) return { kind: "not_found" };
        const beforeData = beforeSnap.data() as Record<string, unknown>;
        const canonicalPatientId = String(beforeData.patientId || "");
        const canonicalReservationId = String(beforeData.reservationId || "");

        const effectiveNew = { ...beforeData, ...safeReservationPatch };
        const oldLockId = isReservationActive(beforeData) ? lockIdForReservation(beforeData) : "";
        const newLockId = isReservationActive(effectiveNew) ? lockIdForReservation(effectiveNew) : "";

        // ── 읽기(모든 lock 판단을 쓰기 전에) ──────────────────────────
        let createNewLock = false;
        let deleteOldLock = false;
        let staleLockRepaired = false;
        const newLockRef = newLockId ? adminDb.collection(RESERVATION_LOCKS).doc(newLockId) : null;
        const oldLockRef = oldLockId ? adminDb.collection(RESERVATION_LOCKS).doc(oldLockId) : null;

        if (newLockRef && newLockId !== oldLockId) {
          const newLockSnap = await tx.get(newLockRef);
          if (newLockSnap.exists) {
            const owner = String(newLockSnap.data()?.reservationDocId || "");
            if (owner !== reservationDocId) {
              // 다른 예약이 이미 이 조합의 lock을 쥐고 있다 — 그 예약이 지금도 이 lockId를
              // 그대로 갖는 활성 예약이면 진짜 중복, stale이면 정리 후 재사용.
              let ownerData: Record<string, unknown> | null = null;
              if (owner) {
                const ownerSnap = await tx.get(adminDb.collection("reservations").doc(owner));
                ownerData = ownerSnap.exists ? (ownerSnap.data() as Record<string, unknown>) : null;
              }
              if (!isLockStale(newLockId, ownerData)) return { kind: "duplicate" };
              staleLockRepaired = true;
            }
          }
          createNewLock = true;
        }
        if (oldLockRef && oldLockId !== newLockId) {
          const oldLockSnap = await tx.get(oldLockRef);
          if (oldLockSnap.exists) {
            const owner = String(oldLockSnap.data()?.reservationDocId || "");
            // 자기 소유 lock만 해제한다. 다른 예약 소유 lock은 건드리지 않는다.
            if (owner === reservationDocId) deleteOldLock = true;
            else return { kind: "ownership_mismatch" };
          }
        }

        // amountRows sync (모든 read 이후, 모든 write 이전) — before=예약 원본, after=예약+patch
        await syncReservationAmountRowsInTx(tx, adminDb, ctx, {
          patientId: canonicalPatientId,
          reservationDocId,
          before: beforeData,
          after: effectiveNew,
          now,
        });

        // ── 쓰기 ──────────────────────────────────────────────────────
        const beforeChanged: Record<string, unknown> = {};
        for (const k of Object.keys(safeReservationPatch)) beforeChanged[k] = beforeData[k] ?? null;

        tx.update(resRef, {
          ...safeReservationPatch,
          ...deriveAmountFlagPatch(safeReservationPatch),
          ...deriveGroupKeysPatch(safeReservationPatch, beforeData),
          updatedBy: ctx.name,
          updatedByUid: ctx.uid,
          updatedAt: now,
        });
        if (deleteOldLock && oldLockRef) tx.delete(oldLockRef);
        if (createNewLock && newLockRef) tx.set(newLockRef, buildLockDoc({
          reservationDocId,
          reservationId: canonicalReservationId,
          patientId: canonicalPatientId,
          lockId: newLockId,
          now,
        }));

        writeReservationLogInTx(tx, ctx, {
          action: "reservation_update",
          targetId: canonicalReservationId || reservationDocId,
          patientId: canonicalPatientId,
          reservationId: canonicalReservationId,
          message: `${ctx.name}님이 예약 정보를 수정했습니다.`,
          before: beforeChanged,
          after: { ...safeReservationPatch },
          now,
        });

        return { kind: "ok", canonicalPatientId, canonicalReservationId, beforeChanged, staleLockRepaired };
      });

      if (outcome.kind === "not_found") {
        return NextResponse.json({ success: false, message: "예약을 찾을 수 없습니다." }, { status: 400 });
      }
      if (outcome.kind === "duplicate") {
        return NextResponse.json({ success: false, code: "DUPLICATE_RESERVATION", message: "동일 조합의 활성 예약이 이미 있어 저장하지 않았습니다.", duplicate: true }, { status: 409 });
      }
      if (outcome.kind === "ownership_mismatch") {
        return NextResponse.json({ success: false, code: "LOCK_OWNERSHIP_MISMATCH", message: "예약 lock 소유권이 일치하지 않아 저장하지 않았습니다." }, { status: 409 });
      }

      const { canonicalPatientId, canonicalReservationId, beforeChanged: _beforeChanged, staleLockRepaired } = outcome;

      if (staleLockRepaired) {
        await writeReservationLog(ctx, {
          action: "STALE_LOCK_REPAIRED",
          targetId: canonicalReservationId || reservationDocId,
          patientId: canonicalPatientId,
          reservationId: canonicalReservationId,
          message: "수정 중 stale reservation lock을 정리하고 재사용했습니다.",
          before: null, after: { reservationDocId },
          now,
        });
      }

      // 예약금·수술비·날짜 등이 바뀔 수 있으므로 예약 파생 요약 재계산 — best-effort
      await safeRecompute(
        () => recomputeReservationSummary(canonicalPatientId),
        "update/reservation",
        canonicalPatientId
      );

      return NextResponse.json({ success: true });
    }

    // ── UPDATE PATIENT PROFILE (환자 마스터 1회 + 해당 환자 예약 역정규화 배치) ──
    // 기존엔 클라가 예약 N건마다 update를 N번 호출하던 걸 서버 1회 배치로 대체.
    if (action === "update_patient_profile") {
      const { patientId, patientPatch } = payload as {
        patientId?: string;
        patientPatch?: Record<string, unknown>;
      };
      if (!patientId) {
        return NextResponse.json({ success: false, message: "patientId가 없습니다." }, { status: 400 });
      }
      const { safe, disallowed } = splitPatch(patientPatch, ALLOWED_PATIENT_UPDATE_FIELDS);
      if (disallowed.length) {
        return NextResponse.json(
          { success: false, message: `허용되지 않은 필드입니다: ${disallowed.join(", ")}` },
          { status: 400 }
        );
      }
      if (!Object.keys(safe).length) {
        return NextResponse.json({ success: false, message: "변경할 필드가 없습니다." }, { status: 400 });
      }

      const now = FieldValue.serverTimestamp();
      const audit = { updatedAt: now, updatedBy: ctx.name, updatedByUid: ctx.uid };
      const CHUNK = 500;

      const patSnap = await adminDb.collection("patients").where("patientId", "==", patientId).get();
      if (patSnap.empty) {
        return NextResponse.json({ success: false, message: "해당 환자를 찾을 수 없습니다." }, { status: 404 });
      }

      const identityBase = patSnap.docs[0].data() as Record<string, unknown>;
      const nextIdentityKey = identityKeyForPatient({ ...identityBase, ...safe });

      // patients 문서 갱신 (이름 변경 시 검색토큰 재생성, 신원 변경 시 identityKey 갱신)
      const patientUpdate = {
        ...safe,
        ...(safe.name !== undefined ? { searchTokens: makePatientSearchTokens(String(safe.name || "")) } : {}),
        ...(nextIdentityKey ? { identityKey: nextIdentityKey } : {}),
        ...audit,
      };
      for (let i = 0; i < patSnap.docs.length; i += CHUNK) {
        const batch = adminDb.batch();
        for (const d of patSnap.docs.slice(i, i + CHUNK)) batch.update(d.ref, patientUpdate);
        await batch.commit();
      }

      // 예약에 역정규화된 환자 필드 반영 (name → name + patientName)
      const resPatch: Record<string, unknown> = { ...safe, ...audit };
      if (safe.name !== undefined) resPatch.patientName = safe.name;
      const resSnap = await adminDb
        .collection("reservations")
        .where("patientId", "==", patientId)
        .where("isDeleted", "==", false)
        .get();
      for (let i = 0; i < resSnap.docs.length; i += CHUNK) {
        const batch = adminDb.batch();
        for (const d of resSnap.docs.slice(i, i + CHUNK)) batch.update(d.ref, resPatch);
        await batch.commit();
      }

      const logBatch = adminDb.batch();
      writeReservationLogInBatch(logBatch, ctx, {
        action: "patient_update",
        targetId: patientId,
        patientId,
        message: `${ctx.name}님이 환자 정보를 수정했습니다.`,
        before: null,
        after: { ...safe, updatedReservations: resSnap.size },
        now,
      });
      await logBatch.commit();

      return NextResponse.json({ success: true, updatedReservations: resSnap.size, updatedPatients: patSnap.size });
    }

    // ── TOGGLE SURGERY ────────────────────────────────────────────────────
    if (action === "toggleSurgery") {
      const { reservationDocId, surgeryReserved } = payload as {
        reservationDocId: string;
        surgeryReserved: boolean;
      };

      const now = FieldValue.serverTimestamp();
      const toggleRef = adminDb.collection("reservations").doc(reservationDocId);
      // 감사 대상/이전값을 서버에서 확정하기 위해 1회 읽는다(신원·before 위조 차단).
      const toggleBefore = await toggleRef.get();
      const toggleData = toggleBefore.exists ? (toggleBefore.data() as Record<string, unknown>) : {};

      const toggleBatch = adminDb.batch();
      toggleBatch.update(toggleRef, {
        surgeryReserved,
        surgeryReservedAt: surgeryReserved ? new Date().toISOString() : "",
        updatedAt: now,
        updatedBy: ctx.name,
        updatedByUid: ctx.uid,
      });
      writeReservationLogInBatch(toggleBatch, ctx, {
        action: "reservation_update",
        targetId: String(toggleData.reservationId || reservationDocId),
        patientId: String(toggleData.patientId || ""),
        reservationId: String(toggleData.reservationId || ""),
        message: `${ctx.name}님이 수술예약 상태를 ${surgeryReserved ? "예약" : "미예약"}으로 변경했습니다.`,
        before: { surgeryReserved: toggleData.surgeryReserved ?? null },
        after: { surgeryReserved },
        now,
      });
      await toggleBatch.commit();

      return NextResponse.json({ success: true });
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (action === "delete") {
      // 예약 삭제는 admin만 허용 (lib에서도 막지만 서버에서 재확인)
      if (ctx.role !== "admin") {
        return NextResponse.json({ success: false, message: "예약 삭제 권한이 없습니다." }, { status: 403 });
      }
      const { reservationDocId } = payload as {
        reservationDocId: string;
      };

      const now = FieldValue.serverTimestamp();
      const delRef = adminDb.collection("reservations").doc(reservationDocId);
      // soft delete와 lock 정리를 한 트랜잭션으로 원자화한다(부분 실패로 lock만 남는 것 차단).
      let delData: Record<string, unknown> = {};
      await adminDb.runTransaction(async (tx) => {
        const delBefore = await tx.get(delRef);
        delData = delBefore.exists ? (delBefore.data() as Record<string, unknown>) : {};
        // 활성 예약이 쥔 lock만, 자기 소유일 때 해제한다.
        const lockId = isReservationActive(delData) ? lockIdForReservation(delData) : "";
        let lockRef: FirebaseFirestore.DocumentReference | null = null;
        let deleteLock = false;
        if (lockId) {
          lockRef = adminDb.collection(RESERVATION_LOCKS).doc(lockId);
          const lockSnap = await tx.get(lockRef);
          if (lockSnap.exists && String(lockSnap.data()?.reservationDocId || "") === reservationDocId) {
            deleteLock = true;
          }
        }

        // amountRows sync — before=예약 원본, after=null (삭제 등가). 모든 read 이후 · 모든 write 이전.
        if (delBefore.exists) {
          await syncReservationAmountRowsInTx(tx, adminDb, ctx, {
            patientId: String(delData.patientId || ""),
            reservationDocId,
            before: delData,
            after: null,
            now,
          });
        }

        if (deleteLock && lockRef) tx.delete(lockRef);
        tx.update(delRef, {
          isDeleted: true,
          updatedAt: now,
          updatedBy: ctx.name,
          updatedByUid: ctx.uid,
        });
        writeReservationLogInTx(tx, ctx, {
          action: "reservation_delete",
          targetId: String(delData.reservationId || reservationDocId),
          patientId: String(delData.patientId || ""),
          reservationId: String(delData.reservationId || ""),
          message: `${ctx.name}님이 예약을 삭제 처리했습니다.`,
          before: { isDeleted: delData.isDeleted ?? false },
          after: { isDeleted: true },
          now,
        });
      });

      // 예약 파생 요약 재계산 — best-effort
      await safeRecompute(
        () => recomputeReservationSummary(String(delData.patientId || "")),
        "delete/reservation",
        String(delData.patientId || "")
      );

      return NextResponse.json({ success: true });
    }

    // ── DELETE PATIENT (환자의 전체 예약 이력 + 환자 문서 soft-delete) ─────────
    // 클라이언트가 화면(45일 윈도우)에 로드된 예약만 반복 삭제하던 걸 서버로 이관.
    // patientId 기준으로 모든 예약을 soft-delete하고 patients 문서도 isDeleted=true.
    if (action === "delete_patient") {
      if (ctx.role !== "admin") {
        return NextResponse.json({ success: false, message: "환자 삭제 권한이 없습니다." }, { status: 403 });
      }
      const { patientId } = payload as { patientId?: string };
      if (!patientId) {
        return NextResponse.json({ success: false, message: "patientId가 없습니다." }, { status: 400 });
      }

      const CHUNK = 500;
      const jobsCol = adminDb.collection("patientDeletionJobs");

      // 기존 미완료 job이 있으면 이어서 진행 (resumable)
      const existingJob = await jobsCol
        .where("patientId", "==", patientId)
        .where("status", "in", ["pending", "in_progress"])
        .limit(1)
        .get();

      const jobRef = existingJob.empty
        ? jobsCol.doc()
        : existingJob.docs[0].ref;

      if (existingJob.empty) {
        await jobRef.set({
          patientId,
          status: "pending",
          step: "reservations",
          staffUid: ctx.uid,
          staffName: ctx.name,
          staffEmail: ctx.email,
          staffRole: ctx.role,
          staffCode: ctx.staffCode,
          deletedReservations: 0,
          deletedPatients: 0,
          lockCleanupFailures: 0,
          error: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const jobData = existingJob.empty
        ? { step: "reservations", deletedReservations: 0, deletedPatients: 0, lockCleanupFailures: 0 }
        : existingJob.docs[0].data() as Record<string, unknown>;
      let currentStep = String(jobData.step || "reservations");
      let deletedReservations = Number(jobData.deletedReservations || 0);
      let deletedPatients = Number(jobData.deletedPatients || 0);
      let lockCleanupFailures = Number(jobData.lockCleanupFailures || 0);

      const now = FieldValue.serverTimestamp();
      const auditFields = { updatedAt: now, updatedBy: ctx.name, updatedByUid: ctx.uid };

      try {
        await jobRef.update({ status: "in_progress", updatedAt: now });

        // Step 1: 예약 전체 soft-delete
        if (currentStep === "reservations") {
          const resSnap = await adminDb
            .collection("reservations")
            .where("patientId", "==", patientId)
            .where("isDeleted", "==", false)
            .get();
          for (let i = 0; i < resSnap.docs.length; i += CHUNK) {
            const batch = adminDb.batch();
            for (const d of resSnap.docs.slice(i, i + CHUNK)) {
              batch.update(d.ref, { isDeleted: true, ...auditFields });
              deletedReservations += 1;
            }
            await batch.commit();
            await jobRef.update({ deletedReservations, updatedAt: FieldValue.serverTimestamp() });
          }
          currentStep = "locks";
          await jobRef.update({ step: "locks", deletedReservations, updatedAt: FieldValue.serverTimestamp() });
        }

        // Step 2: lock 정리
        if (currentStep === "locks") {
          const resSnap = await adminDb
            .collection("reservations")
            .where("patientId", "==", patientId)
            .get();
          for (const d of resSnap.docs) {
            const rd = d.data() as Record<string, unknown>;
            const lockId = isReservationActive(rd) ? lockIdForReservation(rd) : "";
            if (!lockId) continue;
            try {
              await adminDb.runTransaction(async (tx) => {
                const lockRef = adminDb.collection(RESERVATION_LOCKS).doc(lockId);
                const lockSnap = await tx.get(lockRef);
                if (lockSnap.exists && String(lockSnap.data()?.reservationDocId || "") === d.id) {
                  tx.delete(lockRef);
                }
              });
            } catch {
              lockCleanupFailures += 1;
            }
          }
          currentStep = "patients";
          await jobRef.update({ step: "patients", lockCleanupFailures, updatedAt: FieldValue.serverTimestamp() });
        }

        // Step 3: 환자 문서 soft-delete + patientAmountRows 정리
        if (currentStep === "patients") {
          const patSnap = await adminDb
            .collection("patients")
            .where("patientId", "==", patientId)
            .get();
          for (let i = 0; i < patSnap.docs.length; i += CHUNK) {
            const batch = adminDb.batch();
            for (const d of patSnap.docs.slice(i, i + CHUNK)) {
              batch.update(d.ref, { isDeleted: true, depositCount: 0, surgeryCostCount: 0, ...auditFields });
              deletedPatients += 1;
            }
            await batch.commit();
          }
          // 예약 묶음 materialized 문서 일괄 삭제 (예약과 함께 환자 자체가 사라졌으므로).
          await deleteAllAmountRowsForPatient(adminDb, patientId);
          currentStep = "done";
          await jobRef.update({ step: "done", deletedPatients, updatedAt: FieldValue.serverTimestamp() });
        }

        // Step 4: 감사 로그 + job 완료
        await adminDb.collection("logs").add({
          action: "patient_delete",
          targetType: "patient",
          targetId: patientId,
          staffUid: ctx.uid, staffName: ctx.name, staffEmail: ctx.email,
          staffRole: ctx.role, staffCode: ctx.staffCode,
          patientId, reservationId: "", invoiceId: "",
          message: `${ctx.name}님이 환자와 전체 예약(${deletedReservations}건)을 삭제했습니다.`,
          before: null,
          after: { deletedReservations, deletedPatients, lockCleanupFailures },
          createdAt: now,
        });

        await jobRef.update({
          status: "completed",
          step: "done",
          deletedReservations,
          deletedPatients,
          lockCleanupFailures,
          updatedAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({
          success: lockCleanupFailures === 0,
          deletedReservations,
          deletedPatients,
          lockCleanupFailures,
          ...(lockCleanupFailures > 0 ? { message: `예약 lock ${lockCleanupFailures}건 정리에 실패했습니다. reconcile 스크립트로 정리가 필요합니다.` } : {}),
        });
      } catch (e) {
        await jobRef.update({
          status: "in_progress",
          error: e instanceof Error ? e.message : String(e),
          deletedReservations,
          deletedPatients,
          lockCleanupFailures,
          updatedAt: FieldValue.serverTimestamp(),
        }).catch(() => {});
        throw e;
      }
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[api/reservations]", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, message: `서버 오류: ${msg}` }, { status: 500 });
  }
}
