import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const { idToken, action, payload } = await req.json();

    if (!idToken) {
      return NextResponse.json({ success: false, message: "인증 토큰이 없습니다." }, { status: 401 });
    }

    await adminAuth.verifyIdToken(idToken);

    if (action === "create") {
      const { patient, reservation } = payload as {
        patient: Record<string, unknown>;
        reservation: Record<string, unknown>;
      };

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

    if (action === "update") {
      const { reservationDocId, patientDocId, reservationPatch, patientPatch } = payload as {
        reservationDocId: string;
        patientDocId?: string;
        reservationPatch: Record<string, unknown>;
        patientPatch?: Record<string, unknown>;
      };

      const now = FieldValue.serverTimestamp();

      await adminDb.collection("reservations").doc(reservationDocId).update({
        ...reservationPatch,
        updatedAt: now,
      });

      if (patientDocId && patientPatch) {
        await adminDb.collection("patients").doc(patientDocId).update({
          ...patientPatch,
          updatedAt: now,
        });
      }

      return NextResponse.json({ success: true });
    }

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
