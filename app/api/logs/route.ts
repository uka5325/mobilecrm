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

    // ── CREATE ──────────────────────────────────────────────────────────────
    if (action === "create") {
      const {
        action: logAction, targetType, targetId = "", staffUid, staffName, staffEmail, staffRole, staffCode = "",
        patientId = "", reservationId = "", invoiceId = "", message, before = null, after = null,
      } = payload as Record<string, unknown>;

      await adminDb.collection("logs").add({
        action: logAction,
        targetType,
        targetId,
        staffUid,
        staffName,
        staffEmail,
        staffRole,
        staffCode,
        patientId,
        reservationId,
        invoiceId,
        message,
        before,
        after,
        createdAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({ success: true });
    }

    // ── READ ─────────────────────────────────────────────────────────────────
    if (action === "read") {
      const { reservationId, targetId, patientId } = payload as { reservationId?: string; targetId?: string; patientId?: string };
      const LOG_LIMIT = 50;

      // 우선순위 단일 쿼리: reservationId > targetId > patientId
      // 3중 쿼리를 피해 과금을 최대 66% 절감
      const primaryField = reservationId ? "reservationId"
        : targetId ? "targetId"
        : patientId ? "patientId"
        : null;
      const primaryValue = reservationId || targetId || patientId || "";

      if (!primaryField || !primaryValue) {
        return NextResponse.json({ success: true, logs: [] });
      }

      const snap = await adminDb.collection("logs")
        .where(primaryField, "==", primaryValue)
        .orderBy("createdAt", "desc")
        .limit(LOG_LIMIT)
        .get();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = snap.docs.map((d: any) => toSer({ id: d.id, ...d.data() }));

      return NextResponse.json({ success: true, logs: list });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[/api/logs]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
