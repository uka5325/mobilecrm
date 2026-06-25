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

export async function POST(req: NextRequest) {
  try {
    const { idToken, action, payload } = await req.json();
    if (!idToken) return NextResponse.json({ success: false, message: "인증 토큰 없음" }, { status: 401 });
    await adminAuth.verifyIdToken(idToken);

    // ── READ ──────────────────────────────────────────────────────────────
    if (action === "read") {
      const { reservationId, reservationDocId, patientId } = payload as Record<string, string>;
      const noteMap: Record<string, unknown> = {};

      const run = async (field: string, value: string) => {
        if (!value) return;
        const snap = await adminDb.collection("reservationNotes")
          .where(field, "==", value)
          .limit(100)
          .get();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        snap.docs.forEach((d: any) => {
          const data = d.data();
          if (data.isDeleted === true || data.deleted === true) return;
          const memoText = String(data.memoText || data.memo || data.note || data.content || data.text || "").trim();
          if (!memoText) return;
          noteMap[d.id] = toSer({ id: d.id, ...data, memoText });
        });
      };

      // patientId 우선: 동일 환자의 모든 예약 메모를 한번에 조회
      const primaryField = patientId ? "patientId"
        : reservationDocId ? "reservationDocId"
        : "reservationId";
      const primaryValue = patientId || reservationDocId || reservationId || "";
      await run(primaryField, primaryValue);

      const notes = Object.values(noteMap).sort((a, b) => {
        const at = Number((a as Record<string, unknown>).createdAt || 0);
        const bt = Number((b as Record<string, unknown>).createdAt || 0);
        return bt - at;
      });

      return NextResponse.json({ success: true, notes });
    }

    // ── CREATE ─────────────────────────────────────────────────────────────
    if (action === "create") {
      const { reservationId, reservationDocId, patientId, memoText, staffName, staffUid } = payload as Record<string, string>;
      if (!memoText?.trim()) return NextResponse.json({ success: false, message: "메모 내용을 입력하세요." });

      const ref = await adminDb.collection("reservationNotes").add({
        reservationId,
        reservationDocId,
        patientId,
        memoText: memoText.trim(),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: staffName,
        createdByUid: staffUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffName,
        updatedByUid: staffUid,
        isDeleted: false,
      });

      // Also write a log entry
      await adminDb.collection("logs").add({
        action: "memo_create",
        targetType: "memo",
        targetId: reservationId,
        staffUid,
        staffName,
        staffEmail: "",
        staffRole: "",
        staffCode: "",
        patientId,
        reservationId,
        invoiceId: "",
        message: `${staffName}님이 메모를 추가했습니다.`,
        before: null,
        after: { noteId: ref.id },
        createdAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({ success: true, id: ref.id });
    }

    // ── UPDATE ─────────────────────────────────────────────────────────────
    if (action === "update") {
      const { noteId, memoText, staffName, staffUid, reservationId = "", patientId = "" } = payload as Record<string, string>;
      if (!memoText?.trim()) return NextResponse.json({ success: false, message: "메모 내용을 입력하세요." });

      await adminDb.collection("reservationNotes").doc(noteId).update({
        memoText: memoText.trim(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffName,
        updatedByUid: staffUid,
      });

      await adminDb.collection("logs").add({
        action: "memo_update",
        targetType: "memo",
        targetId: noteId,
        staffUid,
        staffName,
        staffEmail: "",
        staffRole: "",
        staffCode: "",
        patientId,
        reservationId,
        invoiceId: "",
        message: `${staffName}님이 메모를 수정했습니다.`,
        before: null,
        after: { noteId },
        createdAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({ success: true });
    }

    // ── DELETE (soft) ──────────────────────────────────────────────────────
    if (action === "delete") {
      const { noteId, staffName, staffUid, reservationId = "", patientId = "" } = payload as Record<string, string>;

      await adminDb.collection("reservationNotes").doc(noteId).update({
        isDeleted: true,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: staffName,
        updatedByUid: staffUid,
      });

      await adminDb.collection("logs").add({
        action: "memo_delete",
        targetType: "memo",
        targetId: noteId,
        staffUid,
        staffName,
        staffEmail: "",
        staffRole: "",
        staffCode: "",
        patientId,
        reservationId,
        invoiceId: "",
        message: `${staffName}님이 메모를 삭제했습니다.`,
        before: { noteId },
        after: null,
        createdAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[/api/reservation-notes]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
