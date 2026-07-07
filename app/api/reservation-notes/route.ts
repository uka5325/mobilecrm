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
      const { reservationId, reservationDocId, patientId, memoText } = payload as Record<string, string>;
      if (!memoText?.trim()) return NextResponse.json({ success: false, message: "메모 내용을 입력하세요." });

      // 작성자/감사로그 신원은 검증된 토큰(ctx)만 사용 → 위조 차단
      const staffName = ctx.name;
      const staffUid = ctx.uid;

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
        staffEmail: ctx.email,
        staffRole: ctx.role,
        staffCode: ctx.staffCode,
        patientId,
        reservationId,
        invoiceId: "",
        message: `${staffName}님이 메모를 추가했습니다.`,
        before: null,
        after: { noteId: ref.id },
        createdAt: FieldValue.serverTimestamp(),
      });

      // 고객관리 요약(메모 개수) 재계산 — best-effort
      await safeRecompute(() => recomputeMemoSummary(String(patientId || "")), "create/memo", String(patientId || ""));

      return NextResponse.json({ success: true, id: ref.id });
    }

    // ── UPDATE ─────────────────────────────────────────────────────────────
    if (action === "update") {
      const { noteId, memoText, reservationId = "", patientId = "" } = payload as Record<string, string>;
      if (!memoText?.trim()) return NextResponse.json({ success: false, message: "메모 내용을 입력하세요." });

      const staffName = ctx.name;
      const staffUid = ctx.uid;

      // 작성자 본인 또는 admin만 수정 가능
      const noteRef = adminDb.collection("reservationNotes").doc(noteId);
      const noteSnap = await noteRef.get();
      if (!noteSnap.exists) {
        return NextResponse.json({ success: false, message: "메모를 찾을 수 없습니다." });
      }
      if (ctx.role !== "admin" && String(noteSnap.data()?.createdByUid || "") !== ctx.uid) {
        return NextResponse.json({ success: false, message: "작성자만 수정할 수 있습니다." }, { status: 403 });
      }

      await noteRef.update({
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
        staffEmail: ctx.email,
        staffRole: ctx.role,
        staffCode: ctx.staffCode,
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
      const { noteId, reservationId = "", patientId = "" } = payload as Record<string, string>;

      const staffName = ctx.name;
      const staffUid = ctx.uid;

      // 작성자 본인 또는 admin만 삭제 가능
      const noteRef = adminDb.collection("reservationNotes").doc(noteId);
      const noteSnap = await noteRef.get();
      if (!noteSnap.exists) {
        return NextResponse.json({ success: false, message: "메모를 찾을 수 없습니다." });
      }
      if (ctx.role !== "admin" && String(noteSnap.data()?.createdByUid || "") !== ctx.uid) {
        return NextResponse.json({ success: false, message: "작성자만 삭제할 수 있습니다." }, { status: 403 });
      }

      await noteRef.update({
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
        staffEmail: ctx.email,
        staffRole: ctx.role,
        staffCode: ctx.staffCode,
        patientId,
        reservationId,
        invoiceId: "",
        message: `${staffName}님이 메모를 삭제했습니다.`,
        before: { noteId },
        after: null,
        createdAt: FieldValue.serverTimestamp(),
      });

      // 고객관리 요약(메모 개수) 재계산 — note 문서의 patientId 우선(payload 폴백)
      await safeRecompute(
        () => recomputeMemoSummary(String(noteSnap.data()?.patientId || patientId || "")),
        "delete/memo",
        String(noteSnap.data()?.patientId || patientId || "")
      );

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[/api/reservation-notes]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
