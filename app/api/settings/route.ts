import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { docToObj, toSerializable } from "@/lib/adminUtils";

async function getStaffRole(uid: string): Promise<string> {
  const snap = await adminDb.collection("staff").where("uid", "==", uid).limit(1).get();
  if (snap.empty) {
    const byId = await adminDb.collection("staff").doc(uid).get();
    if (!byId.exists) return "";
    return String(byId.data()?.role || "");
  }
  return String(snap.docs[0].data().role || "");
}

export async function POST(req: NextRequest) {
  try {
    const { idToken, action, payload = {} } = await req.json();

    if (!idToken) {
      return NextResponse.json({ success: false, message: "인증 토큰이 없습니다." }, { status: 401 });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;

    // ── READ: appointment type colors ─────────────────────────────────────
    if (action === "get_appointment_colors") {
      const snap = await adminDb.doc("appSettings/appointmentTypeColors").get();
      return NextResponse.json({ success: true, data: snap.exists ? toSerializable(snap.data()) : null });
    }

    // ── READ: general settings ────────────────────────────────────────────
    if (action === "get_general_settings") {
      const snap = await adminDb.doc("appSettings/general").get();
      return NextResponse.json({ success: true, data: snap.exists ? toSerializable(snap.data()) : null });
    }

    // ── READ: visit status colors ─────────────────────────────────────────
    if (action === "get_visit_status_colors") {
      const snap = await adminDb.doc("appSettings/visitStatusColors").get();
      return NextResponse.json({ success: true, data: snap.exists ? toSerializable(snap.data()) : null });
    }

    // ── READ: staff list ──────────────────────────────────────────────────
    if (action === "get_staff_list") {
      const snap = await adminDb.collection("staff").orderBy("displayName").limit(200).get();
      return NextResponse.json({ success: true, staff: snap.docs.map(docToObj) });
    }

    // ── WRITE: save appointment type colors ───────────────────────────────
    if (action === "save_appointment_colors") {
      const role = await getStaffRole(uid);
      if (role !== "admin") {
        return NextResponse.json({ success: false, message: "설정 변경 권한이 없습니다." }, { status: 403 });
      }
      const p = payload as { colors: Record<string, string>; updatedBy: string };
      await adminDb.doc("appSettings/appointmentTypeColors").set(
        { id: "appointmentTypeColors", colors: p.colors, updatedAt: FieldValue.serverTimestamp(), updatedBy: p.updatedBy || "", updatedByUid: uid },
        { merge: true }
      );
      return NextResponse.json({ success: true });
    }

    // ── WRITE: save general settings ──────────────────────────────────────
    if (action === "save_general_settings") {
      const role = await getStaffRole(uid);
      if (role !== "admin") {
        return NextResponse.json({ success: false, message: "설정 변경 권한이 없습니다." }, { status: 403 });
      }
      const p = payload as { settings: Record<string, unknown>; updatedBy: string };
      await adminDb.doc("appSettings/general").set(
        { ...p.settings, updatedAt: FieldValue.serverTimestamp(), updatedBy: p.updatedBy || "", updatedByUid: uid },
        { merge: true }
      );
      return NextResponse.json({ success: true });
    }

    // ── WRITE: save visit status colors ───────────────────────────────────
    if (action === "save_visit_status_colors") {
      const role = await getStaffRole(uid);
      if (role !== "admin") {
        return NextResponse.json({ success: false, message: "설정 변경 권한이 없습니다." }, { status: 403 });
      }
      const p = payload as { colors: Record<string, string>; updatedBy: string };
      await adminDb.doc("appSettings/visitStatusColors").set(
        { id: "visitStatusColors", colors: p.colors, updatedAt: FieldValue.serverTimestamp(), updatedBy: p.updatedBy || "", updatedByUid: uid },
        { merge: true }
      );
      return NextResponse.json({ success: true });
    }

    // ── READ: get memos by date ───────────────────────────────────────────
    if (action === "get_memos") {
      const p = payload as { memoDate: string; limit?: number };
      const snap = await adminDb
        .collection("conferenceMemos")
        .where("memoDate", "==", p.memoDate)
        .get();
      const memos = snap.docs
        .map(docToObj)
        .filter((m: Record<string, unknown>) => m.deleted !== true)
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
          const at = typeof a.createdAt === "number" ? a.createdAt : 0;
          const bt = typeof b.createdAt === "number" ? b.createdAt : 0;
          return bt - at;
        })
        .slice(0, p.limit ?? 50);
      return NextResponse.json({ success: true, memos });
    }

    // ── WRITE: add memo ───────────────────────────────────────────────────
    if (action === "add_memo") {
      const p = payload as { memoDate: string; memoText: string; createdByName: string };
      const docRef = await adminDb.collection("conferenceMemos").add({
        memoDate: p.memoDate,
        memoText: p.memoText,
        createdBy: uid,
        createdByName: p.createdByName || "",
        createdAt: FieldValue.serverTimestamp(),
        deleted: false,
        deletedAt: null,
        deletedBy: "",
      });
      return NextResponse.json({ success: true, id: docRef.id });
    }

    // ── WRITE: update memo ───────────────────────────────────────────────
    if (action === "update_memo") {
      const p = payload as { memoId: string; memoText: string };
      await adminDb.doc(`conferenceMemos/${p.memoId}`).update({
        memoText: p.memoText,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      });
      return NextResponse.json({ success: true });
    }

    // ── WRITE: delete memo (soft) ─────────────────────────────────────────
    if (action === "delete_memo") {
      const p = payload as { memoId: string };
      await adminDb.doc(`conferenceMemos/${p.memoId}`).update({
        deleted: true,
        deletedAt: FieldValue.serverTimestamp(),
        deletedBy: uid,
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 요청입니다." }, { status: 400 });
  } catch (err) {
    console.error("[settings API error]", err);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
