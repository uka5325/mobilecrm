import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { docToObj } from "@/lib/adminUtils";

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

    if (!idToken) {
      return NextResponse.json({ success: false, message: "인증 토큰이 없습니다." }, { status: 401 });
    }

    await adminAuth.verifyIdToken(idToken);

    // ── READ: all reservations (last N months) + doctors ──────────────────
    if (action === "read_all") {
      const { from } = (payload || {}) as { from?: string };
      // 기본 조회 범위: 45일 전 (약 1.5개월) — 6개월 전체 스캔 방지
      const fromDate = from || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 45);
        return d.toISOString().slice(0, 10);
      })();

      const [rSnap, doctors] = await Promise.all([
        adminDb
          .collection("reservations")
          .where("reservationDate", ">=", fromDate)
          .orderBy("reservationDate", "desc")
          .limit(500)
          .get(),
        getCachedDoctors(),
      ]);

      return NextResponse.json({
        success: true,
        reservations: rSnap.docs.map(docToObj),
        doctors,
      });
    }

    // ── READ: reservations for a specific date + doctors ──────────────────
    if (action === "read_by_date") {
      const { date } = (payload || {}) as { date: string };

      const [rSnap, doctors] = await Promise.all([
        adminDb
          .collection("reservations")
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
      await patientRef.set({ ...patient, createdAt: now, updatedAt: now });

      const reservationRef = adminDb.collection("reservations").doc();
      await reservationRef.set({ ...reservation, createdAt: now, updatedAt: now });

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
        clientUpdatedAt,
      } = payload as {
        reservationDocId: string;
        patientDocId?: string;
        patientId?: string;
        reservationPatch: Record<string, unknown>;
        patientPatch?: Record<string, unknown>;
        clientUpdatedAt?: number;
      };

      const now = FieldValue.serverTimestamp();

      if (clientUpdatedAt !== undefined) {
        const currentSnap = await adminDb.collection("reservations").doc(reservationDocId).get();
        if (currentSnap.exists) {
          const serverUpdatedAt = currentSnap.data()?.updatedAt;
          const serverMs = serverUpdatedAt?.toMillis?.() ?? 0;
          if (serverMs > 0 && Math.abs(serverMs - clientUpdatedAt) > 1000) {
            return NextResponse.json({
              success: false,
              conflict: true,
              message: "다른 사용자가 이미 수정했습니다. 새로고침 후 다시 시도해주세요.",
            });
          }
        }
      }

      await adminDb.collection("reservations").doc(reservationDocId).update({
        ...reservationPatch,
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
          updatedAt: now,
        });
      }

      return NextResponse.json({ success: true });
    }

    // ── TOGGLE SURGERY ────────────────────────────────────────────────────
    if (action === "toggleSurgery") {
      const { reservationDocId, surgeryReserved, staffDisplay, staffUid } = payload as {
        reservationDocId: string;
        surgeryReserved: boolean;
        staffDisplay: string;
        staffUid: string;
      };

      await adminDb.collection("reservations").doc(reservationDocId).update({
        surgeryReserved,
        surgeryReservedAt: surgeryReserved ? new Date().toISOString() : "",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffDisplay,
        updatedByUid: staffUid,
      });

      return NextResponse.json({ success: true });
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (action === "delete") {
      const { reservationDocId, staffDisplay, staffUid } = payload as {
        reservationDocId: string;
        staffDisplay: string;
        staffUid: string;
      };

      const deletedAt = FieldValue.serverTimestamp();
      const batch = adminDb.batch();

      batch.update(adminDb.collection("reservations").doc(reservationDocId), {
        isDeleted: true,
        updatedAt: deletedAt,
        updatedBy: staffDisplay,
        updatedByUid: staffUid,
      });

      const [invoicesSnap, photosSnap, chartsSnap, notesSnap] = await Promise.all([
        adminDb.collection("invoices").where("reservationDocId", "==", reservationDocId).where("isDeleted", "==", false).get(),
        adminDb.collection("reservationPhotos").where("reservationDocId", "==", reservationDocId).where("isDeleted", "==", false).get(),
        adminDb.collection("reservationCharts").where("reservationDocId", "==", reservationDocId).where("isDeleted", "==", false).get(),
        adminDb.collection("reservationNotes").where("reservationDocId", "==", reservationDocId).where("isDeleted", "==", false).get(),
      ]);

      for (const d of [...invoicesSnap.docs, ...photosSnap.docs, ...chartsSnap.docs, ...notesSnap.docs]) {
        batch.update(d.ref, { isDeleted: true, updatedAt: deletedAt });
      }

      await batch.commit();

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[api/reservations]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
