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
      const { reservationId, targetId } = payload as { reservationId?: string; targetId?: string };
      const result: Record<string, unknown> = {};

      const run = async (field: string, value: string) => {
        if (!value) return;
        const snap = await adminDb.collection("logs").where(field, "==", value).orderBy("createdAt", "desc").get();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        snap.docs.forEach((d: any) => {
          result[d.id] = toSer({ id: d.id, ...d.data() });
        });
      };

      await Promise.all([
        run("reservationId", reservationId || ""),
        run("targetId", targetId || ""),
      ]);

      const list = Object.values(result).sort((a, b) => {
        const at = Number((a as Record<string, unknown>).createdAt || 0);
        const bt = Number((b as Record<string, unknown>).createdAt || 0);
        return bt - at;
      });

      return NextResponse.json({ success: true, logs: list });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[/api/logs]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
