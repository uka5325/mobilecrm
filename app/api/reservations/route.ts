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
  "toggleSurgery",
  "delete",
]);

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
      const ref = adminDb.collection("patients").doc();
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
      const patientRef = adminDb.collection("patients").doc();
      const reservationRef = adminDb.collection("reservations").doc();

      // 작성자 신원은 검증된 토큰(ctx)으로 강제 → 위조 차단
      const authorFields = {
        createdBy: ctx.name, createdByUid: ctx.uid,
        updatedBy: ctx.name, updatedByUid: ctx.uid,
      };

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
        patientDocId: explicitPatientDocId,
        patientId,
        reservationPatch,
        patientPatch,
      } = payload as {
        reservationDocId: string;
        patientDocId?: string;
        patientId?: string;
        reservationPatch: Record<string, unknown>;
        patientPatch?: Record<string, unknown>;
      };

      const now = FieldValue.serverTimestamp();

      // 수정자 신원은 검증된 토큰(ctx)으로 강제 → 위조 차단
      await adminDb.collection("reservations").doc(reservationDocId).update({
        ...reservationPatch,
        updatedBy: ctx.name,
        updatedByUid: ctx.uid,
        updatedAt: now,
      });

      let resolvedPatientDocId = explicitPatientDocId;
      if (!resolvedPatientDocId && patientId && patientPatch) {
        const pSnap = await adminDb
          .collection("patients")
          .where("patientId", "==", patientId)
          .limit(1)
          .get();
        if (!pSnap.empty) resolvedPatientDocId = pSnap.docs[0].id;
      }

      if (resolvedPatientDocId && patientPatch) {
        await adminDb.collection("patients").doc(resolvedPatientDocId).update({
          ...patientPatch,
          // 이름이 바뀌면 검색 토큰 재생성
          ...(patientPatch.name !== undefined
            ? { searchTokens: makePatientSearchTokens(String(patientPatch.name || "")) }
            : {}),
          updatedBy: ctx.name,
          updatedByUid: ctx.uid,
          updatedAt: now,
        });
      }

      return NextResponse.json({ success: true });
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

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[api/reservations]", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, message: `서버 오류: ${msg}` }, { status: 500 });
  }
}
