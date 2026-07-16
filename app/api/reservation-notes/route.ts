import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import { toSerializable as toSer } from "@/lib/adminUtils";
import { recomputeMemoSummary, safeRecompute } from "@/lib/patientSummary";

export async function POST(req: NextRequest) {
  try {
    const { idToken, action, payload } = await req.json();

    // 활성 직원 인가 — 메모 생성/수정/삭제는 토큰 폐기 검사
    let ctx;
    try {
      ctx = await requireActiveStaff(idToken, { checkRevoked: action !== "read" });
    } catch (authErr) {
      const res = toAuthErrorResponse(authErr);
      if (res) return res;
      throw authErr;
    }

    // ── READ ──────────────────────────────────────────────────────────────
    if (action === "read") {
      const { reservationId, reservationDocId, patientId } = payload as Record<string, string>;
      const requestedLimit = Math.max(1, Math.min(100, Number(payload?.limit) || 100));
      // patientId 우선: 동일 환자의 모든 예약 메모를 한번에 조회.
      // 삭제 필터·정렬·limit을 Firestore에 적용해 삭제 문서가 limit을 소비하지 않게 한다.
      const primaryField = patientId ? "patientId"
        : reservationDocId ? "reservationDocId"
        : "reservationId";
      const primaryValue = patientId || reservationDocId || reservationId || "";
      if (!primaryValue) return NextResponse.json({ success: true, notes: [] });

      const snap = await adminDb.collection("reservationNotes")
        .where(primaryField, "==", primaryValue)
        .where("isDeleted", "==", false)
        .orderBy("createdAt", "desc")
        .limit(requestedLimit)
        .get();

      const notes = snap.docs.flatMap((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const memoText = String(data.memoText || data.memo || data.note || data.content || data.text || "").trim();
        return memoText ? [toSer({ id: doc.id, ...data, memoText })] : [];
      });

      return NextResponse.json({ success: true, notes });
    }

    // ── CREATE ─────────────────────────────────────────────────────────────
    if (action === "create") {
      const { reservationId, reservationDocId, patientId, memoText } = payload as Record<string, string>;
      if (!memoText?.trim()) return NextResponse.json({ success: false, message: "메모 내용을 입력하세요." });

      const staffName = ctx.name;
      const staffUid = ctx.uid;
      const noteRef = adminDb.collection("reservationNotes").doc();
      const logRef = adminDb.collection("logs").doc();
      const now = FieldValue.serverTimestamp();

      await adminDb.runTransaction(async (tx) => {
        tx.set(noteRef, {
          reservationId,
          reservationDocId,
          patientId,
          memoText: memoText.trim(),
          createdAt: now,
          createdBy: staffName,
          createdByUid: staffUid,
          updatedAt: now,
          updatedBy: staffName,
          updatedByUid: staffUid,
          isDeleted: false,
        });
        tx.set(logRef, {
          action: "memo_create",
          targetType: "memo",
          targetId: noteRef.id,
          staffUid,
          staffName,
          staffEmail: ctx.email,
          staffRole: ctx.role,
          staffCode: ctx.staffCode,
          patientId,
          reservationId,
          invoiceId: "",
          message: `${staffName}님이 메모를 추가했습니다.`,
          before: null,
          after: { noteId: noteRef.id },
          createdAt: now,
        });
      });

      // 고객관리 요약(메모 개수) 재계산 — best-effort
      await safeRecompute(() => recomputeMemoSummary(String(patientId || "")), "create/memo", String(patientId || ""));

      return NextResponse.json({ success: true, id: noteRef.id });
    }

    // ── UPDATE ─────────────────────────────────────────────────────────────
    if (action === "update") {
      const { noteId, memoText, reservationId = "", patientId = "" } = payload as Record<string, string>;
      if (!memoText?.trim()) return NextResponse.json({ success: false, message: "메모 내용을 입력하세요." });

      const staffName = ctx.name;
      const staffUid = ctx.uid;
      const noteRef = adminDb.collection("reservationNotes").doc(noteId);
      const logRef = adminDb.collection("logs").doc();
      const now = FieldValue.serverTimestamp();

      await adminDb.runTransaction(async (tx) => {
        const noteSnap = await tx.get(noteRef);
        if (!noteSnap.exists) throw new Error("메모를 찾을 수 없습니다.");
        const note = noteSnap.data() as Record<string, unknown>;
        if (ctx.role !== "admin" && String(note.createdByUid || "") !== ctx.uid) {
          throw new Error("작성자만 수정할 수 있습니다.");
        }
        tx.update(noteRef, {
          memoText: memoText.trim(),
          updatedAt: now,
          updatedBy: staffName,
          updatedByUid: staffUid,
        });
        tx.set(logRef, {
          action: "memo_update",
          targetType: "memo",
          targetId: noteId,
          staffUid,
          staffName,
          staffEmail: ctx.email,
          staffRole: ctx.role,
          staffCode: ctx.staffCode,
          patientId: String(note.patientId || patientId || ""),
          reservationId: String(note.reservationId || reservationId || ""),
          invoiceId: "",
          message: `${staffName}님이 메모를 수정했습니다.`,
          before: { noteId },
          after: { noteId },
          createdAt: now,
        });
      });

      return NextResponse.json({ success: true });
    }

    // ── DELETE (soft) ──────────────────────────────────────────────────────
    if (action === "delete") {
      const { noteId, reservationId = "", patientId = "" } = payload as Record<string, string>;

      const staffName = ctx.name;
      const staffUid = ctx.uid;
      const noteRef = adminDb.collection("reservationNotes").doc(noteId);
      const logRef = adminDb.collection("logs").doc();
      const now = FieldValue.serverTimestamp();
      let summaryPatientId = patientId;

      await adminDb.runTransaction(async (tx) => {
        const noteSnap = await tx.get(noteRef);
        if (!noteSnap.exists) throw new Error("메모를 찾을 수 없습니다.");
        const note = noteSnap.data() as Record<string, unknown>;
        if (ctx.role !== "admin" && String(note.createdByUid || "") !== ctx.uid) {
          throw new Error("작성자만 삭제할 수 있습니다.");
        }
        summaryPatientId = String(note.patientId || patientId || "");
        tx.update(noteRef, {
          isDeleted: true,
          updatedAt: now,
          updatedBy: staffName,
          updatedByUid: staffUid,
        });
        tx.set(logRef, {
          action: "memo_delete",
          targetType: "memo",
          targetId: noteId,
          staffUid,
          staffName,
          staffEmail: ctx.email,
          staffRole: ctx.role,
          staffCode: ctx.staffCode,
          patientId: summaryPatientId,
          reservationId: String(note.reservationId || reservationId || ""),
          invoiceId: "",
          message: `${staffName}님이 메모를 삭제했습니다.`,
          before: { noteId },
          after: null,
          createdAt: now,
        });
      });

      // 고객관리 요약(메모 개수) 재계산 — note 문서의 patientId 우선(payload 폴백)
      await safeRecompute(
        () => recomputeMemoSummary(String(summaryPatientId || "")),
        "delete/memo",
        String(summaryPatientId || "")
      );

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[/api/reservation-notes]", e);
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : "서버 오류" }, { status: 500 });
  }
}
