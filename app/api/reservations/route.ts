import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import { toSerializable, docToObj } from "@/lib/adminUtils";
import { makePatientSearchTokens } from "@/lib/searchTokens";

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
const ALLOWED_RESERVATION_UPDATE_FIELDS = new Set([
  "name", "patientName", "birth", "birthInput", "gender", "phone", "nationality",
  "reservationDate", "reservationTime", "hospital", "appointmentType",
  "completed", "cancelled", "consultArea", "depositAmount", "surgeryCost",
  "coordinators", "doctors", "operationStatus", "preConsStatus",
  "surgeryReserved", "surgeryReservedAt", "doctorStatusMap", "doctorStatusMetaMap",
]);

const ALLOWED_PATIENT_UPDATE_FIELDS = new Set([
  "name", "birth", "birthInput", "gender", "phone", "nationality",
]);

// 서버가 신원을 강제하는 필드 — 합법 클라이언트가 보낼 수 있어 조용히 무시한다(거부하지 않음).
const SERVER_MANAGED_IGNORE = new Set(["updatedBy", "updatedByUid", "updatedAt"]);

// patch를 검증해 {safe, disallowed}로 분리한다.
// - 허용 필드 → safe에 통과
// - 서버관리 필드 → 조용히 무시
// - 그 외(isDeleted/createdBy*/invoice*/식별자 등) → disallowed에 수집(호출부에서 거부)
function splitPatch(
  patch: Record<string, unknown> | undefined | null,
  allowed: Set<string>
): { safe: Record<string, unknown>; disallowed: string[] } {
  const safe: Record<string, unknown> = {};
  const disallowed: string[] = [];
  if (!patch || typeof patch !== "object") return { safe, disallowed };
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.has(k)) safe[k] = v;
    else if (SERVER_MANAGED_IGNORE.has(k)) continue;
    else disallowed.push(k);
  }
  return { safe, disallowed };
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

function normDupKey(r: Record<string, unknown>) {
  const docs = Array.isArray(r.doctors)
    ? [...(r.doctors as string[])].sort().join("|")
    : "";
  return [
    String(r.name || "").toLowerCase(),
    String(r.reservationDate || ""),
    String(r.reservationTime || ""),
    String(r.phone || "").replace(/[^0-9+]/g, ""),
    String(r.hospital || ""),
    String(r.appointmentType || ""),
    docs,
  ].join("__");
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
        .limit(500);
      if (to) resQ = resQ.where("reservationDate", "<=", to) as typeof resQ;

      const [rSnap, doctors] = await Promise.all([resQ.get(), getCachedDoctors()]);

      return NextResponse.json({
        success: true,
        reservations: rSnap.docs.map(docToObj),
        doctors,
      });
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
      const now = FieldValue.serverTimestamp();

      // 중복 방지(정책: 연결만·없으면 생성): 같은 patientId 문서가 이미 있으면 그걸 반환.
      const incomingPatientId = String((patient as { patientId?: unknown }).patientId || "");
      if (incomingPatientId) {
        const existing = await adminDb
          .collection("patients")
          .where("patientId", "==", incomingPatientId)
          .limit(1)
          .get();
        if (!existing.empty) {
          return NextResponse.json({ success: true, patientDocId: existing.docs[0].id, linkedExistingPatient: true });
        }
      }

      // 신규는 문서 ID를 patientId로 고정(동시성 중복 차단). 비면 auto-id 폴백.
      const ref = incomingPatientId
        ? adminDb.collection("patients").doc(incomingPatientId)
        : adminDb.collection("patients").doc();
      // 작성자 신원은 검증된 토큰(ctx)으로 강제 → 위조 차단
      await ref.set({
        ...patient,
        searchTokens: makePatientSearchTokens(String((patient as { name?: unknown }).name || "")),
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
      const patients = snap.docs.flatMap((d: any) => {
        const data = d.data();
        if (data.isDeleted === true) return [];
        return [toSerializable({ id: d.id, ...data })];
      });
      return NextResponse.json({ success: true, patients });
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
      const patients = snap.docs.flatMap((d: any) => {
        const data = d.data();
        if (data.isDeleted === true) return [];
        return [toSerializable({ id: d.id, ...data })];
      });
      return NextResponse.json({ success: true, patients });
    }

    // ── CREATE ────────────────────────────────────────────────────────────
    if (action === "create") {
      const { patient, reservation } = payload as {
        patient: Record<string, unknown>;
        reservation: Record<string, unknown>;
      };

      const dupDate = String(reservation.reservationDate || "");
      const dupResId = String(reservation.reservationId || "");
      const dupName = String(reservation.name || "");

      if (dupResId) {
        const idSnap = await adminDb
          .collection("reservations")
          .where("reservationId", "==", dupResId)
          .where("isDeleted", "==", false)
          .get();
        if (!idSnap.empty) {
          return NextResponse.json({
            success: false,
            message: "이미 등록된 예약으로 보여 저장하지 않았습니다.",
            duplicate: true,
          });
        }
      }

      if (dupDate && dupName) {
        const dateSnap = await adminDb
          .collection("reservations")
          .where("reservationDate", "==", dupDate)
          .where("isDeleted", "==", false)
          .limit(50)
          .get();

        const inKey = normDupKey(reservation);
        const isDuplicate = dateSnap.docs.some((d) => normDupKey(d.data()) === inKey);

        if (isDuplicate) {
          return NextResponse.json({
            success: false,
            message: "이미 등록된 예약으로 보여 저장하지 않았습니다.",
            duplicate: true,
          });
        }
      }

      const now = FieldValue.serverTimestamp();

      // 작성자 신원은 검증된 토큰(ctx)으로 강제 → 위조 차단
      const authorFields = {
        createdBy: ctx.name, createdByUid: ctx.uid,
        updatedBy: ctx.name, updatedByUid: ctx.uid,
      };

      // 기존 환자에 예약 추가(정책: 연결만·없으면 생성):
      // patientId가 있고 patients 문서가 이미 있으면 마스터를 건드리지 않고 예약만 생성한다.
      // (마스터 정정은 update_patient_profile / savePatientEdit 전용 경로로만)
      const incomingPatientId = String((patient as { patientId?: unknown }).patientId || "");
      let existingPatientDocId = "";
      if (incomingPatientId) {
        const pSnap = await adminDb
          .collection("patients")
          .where("patientId", "==", incomingPatientId)
          .limit(1)
          .get();
        if (!pSnap.empty) existingPatientDocId = pSnap.docs[0].id;
      }

      const reservationRef = adminDb.collection("reservations").doc();

      if (existingPatientDocId) {
        await reservationRef.set({ ...reservation, ...authorFields, createdAt: now, updatedAt: now });
        return NextResponse.json({
          success: true,
          patientDocId: existingPatientDocId,
          reservationDocId: reservationRef.id,
          linkedExistingPatient: true,
        });
      }

      // 신규 환자는 문서 ID를 patientId로 고정 → 같은 patientId 동시 생성이 같은 문서를 가리켜
      // 중복 doc이 생기지 않는다(auto-id 경합 창 제거). patientId가 비면 auto-id 폴백.
      const patientRef = incomingPatientId
        ? adminDb.collection("patients").doc(incomingPatientId)
        : adminDb.collection("patients").doc();
      const batch = adminDb.batch();
      batch.set(patientRef, { ...patient, searchTokens: makePatientSearchTokens(String((patient as { name?: unknown }).name || "")), isDeleted: false, ...authorFields, createdAt: now, updatedAt: now });
      batch.set(reservationRef, { ...reservation, ...authorFields, createdAt: now, updatedAt: now });
      await batch.commit();

      return NextResponse.json({
        success: true,
        patientDocId: patientRef.id,
        reservationDocId: reservationRef.id,
      });
    }

    // ── UPDATE ────────────────────────────────────────────────────────────
    if (action === "update") {
      const {
        reservationDocId,
        reservationId,
        patientDocId: explicitPatientDocId,
        patientId,
        reservationPatch,
        patientPatch,
      } = payload as {
        reservationDocId: string;
        reservationId?: string;
        patientDocId?: string;
        patientId?: string;
        reservationPatch: Record<string, unknown>;
        patientPatch?: Record<string, unknown>;
      };

      // 필드 화이트리스트 — 비허용 필드(isDeleted/createdBy*/invoice*/식별자 등)가 하나라도
      // 있으면 "조용히 무시"가 아니라 요청을 거부한다(숨은 버그·악성 payload 노출).
      // (admin SDK는 규칙을 우회하므로 서버가 유일한 방어선)
      const { safe: safeReservationPatch, disallowed: resDisallowed } = splitPatch(reservationPatch, ALLOWED_RESERVATION_UPDATE_FIELDS);
      const { safe: safePatientPatch, disallowed: patDisallowed } = splitPatch(patientPatch, ALLOWED_PATIENT_UPDATE_FIELDS);

      const disallowed = [...resDisallowed, ...patDisallowed];
      if (disallowed.length) {
        return NextResponse.json(
          { success: false, message: `허용되지 않은 필드입니다: ${disallowed.join(", ")}` },
          { status: 400 }
        );
      }
      if (!Object.keys(safeReservationPatch).length && !Object.keys(safePatientPatch).length) {
        return NextResponse.json({ success: false, message: "변경할 필드가 없습니다." }, { status: 400 });
      }

      const now = FieldValue.serverTimestamp();

      // 감사 before/after: update 직전 값을 1회 읽어 변경 필드의 이전 값을 로그에 남긴다
      // (예약금·수술비용 등 민감 필드 추적).
      const resRef = adminDb.collection("reservations").doc(reservationDocId);
      const beforeSnap = await resRef.get();
      const beforeData = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
      const beforeChanged: Record<string, unknown> = {};
      for (const k of Object.keys(safeReservationPatch)) beforeChanged[k] = beforeData[k] ?? null;

      // 수정자 신원은 검증된 토큰(ctx)으로 강제 → 위조 차단
      await resRef.update({
        ...safeReservationPatch,
        updatedBy: ctx.name,
        updatedByUid: ctx.uid,
        updatedAt: now,
      });

      let resolvedPatientDocId = explicitPatientDocId;
      if (!resolvedPatientDocId && patientId && Object.keys(safePatientPatch).length) {
        const pSnap = await adminDb
          .collection("patients")
          .where("patientId", "==", patientId)
          .limit(1)
          .get();
        if (!pSnap.empty) resolvedPatientDocId = pSnap.docs[0].id;
      }

      if (resolvedPatientDocId && Object.keys(safePatientPatch).length) {
        await adminDb.collection("patients").doc(resolvedPatientDocId).update({
          ...safePatientPatch,
          // 이름이 바뀌면 검색 토큰 재생성
          ...(safePatientPatch.name !== undefined
            ? { searchTokens: makePatientSearchTokens(String(safePatientPatch.name || "")) }
            : {}),
          updatedBy: ctx.name,
          updatedByUid: ctx.uid,
          updatedAt: now,
        });
      }

      // 감사로그를 서버에서 권위 있게 기록 → 직접 API 호출/우회도 남는다.
      // (클라이언트 createLog는 중복 방지를 위해 제거됨)
      await adminDb.collection("logs").add({
        action: "reservation_update",
        targetType: "reservation",
        targetId: reservationId || reservationDocId,
        staffUid: ctx.uid,
        staffName: ctx.name,
        staffEmail: ctx.email,
        staffRole: ctx.role,
        staffCode: ctx.staffCode,
        patientId: patientId || "",
        reservationId: reservationId || "",
        invoiceId: "",
        message: `${ctx.name}님이 예약 정보를 수정했습니다.`,
        before: beforeChanged,
        after: { ...safeReservationPatch, ...(Object.keys(safePatientPatch).length ? { patient: safePatientPatch } : {}) },
        createdAt: now,
      });

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

      // patients 문서 갱신 (이름 변경 시 검색토큰 재생성)
      const patientUpdate = {
        ...safe,
        ...(safe.name !== undefined ? { searchTokens: makePatientSearchTokens(String(safe.name || "")) } : {}),
        ...audit,
      };
      const patSnap = await adminDb.collection("patients").where("patientId", "==", patientId).get();
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

      await adminDb.collection("logs").add({
        action: "patient_update",
        targetType: "patient",
        targetId: patientId,
        staffUid: ctx.uid, staffName: ctx.name, staffEmail: ctx.email,
        staffRole: ctx.role, staffCode: ctx.staffCode,
        patientId, reservationId: "", invoiceId: "",
        message: `${ctx.name}님이 환자 정보를 수정했습니다.`,
        before: null,
        after: { ...safe, updatedReservations: resSnap.size },
        createdAt: now,
      });

      return NextResponse.json({ success: true, updatedReservations: resSnap.size, updatedPatients: patSnap.size });
    }

    // ── TOGGLE SURGERY ────────────────────────────────────────────────────
    if (action === "toggleSurgery") {
      const { reservationDocId, surgeryReserved } = payload as {
        reservationDocId: string;
        surgeryReserved: boolean;
      };

      await adminDb.collection("reservations").doc(reservationDocId).update({
        surgeryReserved,
        surgeryReservedAt: surgeryReserved ? new Date().toISOString() : "",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: ctx.name,
        updatedByUid: ctx.uid,
      });

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

      await adminDb.collection("reservations").doc(reservationDocId).update({
        isDeleted: true,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: ctx.name,
        updatedByUid: ctx.uid,
      });

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

      const now = FieldValue.serverTimestamp();
      const auditFields = { updatedAt: now, updatedBy: ctx.name, updatedByUid: ctx.uid };

      // 예약 전체 soft-delete (batch 최대 500건 단위)
      const resSnap = await adminDb
        .collection("reservations")
        .where("patientId", "==", patientId)
        .where("isDeleted", "==", false)
        .get();
      let deletedReservations = 0;
      const CHUNK = 500;
      for (let i = 0; i < resSnap.docs.length; i += CHUNK) {
        const batch = adminDb.batch();
        for (const d of resSnap.docs.slice(i, i + CHUNK)) {
          batch.update(d.ref, { isDeleted: true, ...auditFields });
          deletedReservations += 1;
        }
        await batch.commit();
      }

      // 환자 문서 soft-delete (동일 patientId 문서가 여러 개일 수 있어 전부 처리)
      const patSnap = await adminDb
        .collection("patients")
        .where("patientId", "==", patientId)
        .get();
      for (let i = 0; i < patSnap.docs.length; i += CHUNK) {
        const batch = adminDb.batch();
        for (const d of patSnap.docs.slice(i, i + CHUNK)) {
          batch.update(d.ref, { isDeleted: true, ...auditFields });
        }
        await batch.commit();
      }

      await adminDb.collection("logs").add({
        action: "patient_delete",
        targetType: "patient",
        targetId: patientId,
        staffUid: ctx.uid, staffName: ctx.name, staffEmail: ctx.email,
        staffRole: ctx.role, staffCode: ctx.staffCode,
        patientId, reservationId: "", invoiceId: "",
        message: `${ctx.name}님이 환자와 전체 예약(${deletedReservations}건)을 삭제했습니다.`,
        before: null,
        after: { deletedReservations, deletedPatients: patSnap.size },
        createdAt: now,
      });

      return NextResponse.json({ success: true, deletedReservations, deletedPatients: patSnap.size });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[api/reservations]", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, message: `서버 오류: ${msg}` }, { status: 500 });
  }
}
