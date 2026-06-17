import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebaseAdmin";

function toSerializable(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (
    typeof val === "object" &&
    typeof (val as Record<string, unknown>).toMillis === "function"
  ) {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (Array.isArray(val)) {
    return val.map(toSerializable);
  }
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = toSerializable(v);
    }
    return out;
  }
  return val;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function docToObj(d: any): Record<string, unknown> {
  return toSerializable({ id: d.id, ...d.data() }) as Record<string, unknown>;
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
      const sixMonthsAgo = from || (() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 6);
        return d.toISOString().slice(0, 10);
      })();

      const [rSnap, dSnap] = await Promise.all([
        adminDb
          .collection("reservations")
          .where("reservationDate", ">=", sixMonthsAgo)
          .orderBy("reservationDate", "desc")
          .get(),
        adminDb
          .collection("staff")
          .where("role", "==", "doctor")
          .where("active", "==", true)
          .get(),
      ]);

      return NextResponse.json({
        success: true,
        reservations: rSnap.docs.map(docToObj),
        doctors: dSnap.docs.map(docToObj),
      });
    }

    // ── READ: reservations for a specific date + doctors ──────────────────
    if (action === "read_by_date") {
      const { date } = (payload || {}) as { date: string };

      const [rSnap, dSnap] = await Promise.all([
        adminDb
          .collection("reservations")
          .where("reservationDate", "==", date)
          .get(),
        adminDb
          .collection("staff")
          .where("role", "==", "doctor")
          .where("active", "==", true)
          .get(),
      ]);

      return NextResponse.json({
        success: true,
        reservations: rSnap.docs.map(docToObj),
        doctors: dSnap.docs.map(docToObj),
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
      const dSnap = await adminDb
        .collection("staff")
        .where("role", "==", "doctor")
        .where("active", "==", true)
        .get();
      return NextResponse.json({ success: true, doctors: dSnap.docs.map(docToObj) });
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
      } = payload as {
        reservationDocId: string;
        patientDocId?: string;
        patientId?: string;
        reservationPatch: Record<string, unknown>;
        patientPatch?: Record<string, unknown>;
      };

      const now = FieldValue.serverTimestamp();

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

      await adminDb.collection("reservations").doc(reservationDocId).update({
        isDeleted: true,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffDisplay,
        updatedByUid: staffUid,
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
