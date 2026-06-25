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

// uid별 active 여부 서버 메모리 캐시 (5분 TTL)
const _staffActiveCache = new Map<string, { active: boolean; at: number }>();
const STAFF_ACTIVE_TTL = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const { idToken, action, payload } = await req.json();
    if (!idToken) return NextResponse.json({ success: false, message: "인증 토큰 없음" }, { status: 401 });
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;

    // ── CREATE ──────────────────────────────────────────────────────────────
    if (action === "create") {
      // 활성 직원만 로그 생성 허용 (5분 캐시로 반복 조회 최소화)
      const activeCache = _staffActiveCache.get(uid);
      let isActiveStaff = activeCache && Date.now() - activeCache.at < STAFF_ACTIVE_TTL
        ? activeCache.active
        : null;
      if (isActiveStaff === null) {
        const sSnap = await adminDb.collection("staff").where("uid", "==", uid).limit(1).get();
        if (!sSnap.empty) {
          isActiveStaff = sSnap.docs[0].data().active === true;
        } else {
          const sDoc = await adminDb.collection("staff").doc(uid).get();
          isActiveStaff = sDoc.exists ? sDoc.data()?.active === true : false;
        }
        _staffActiveCache.set(uid, { active: isActiveStaff, at: Date.now() });
      }
      if (!isActiveStaff) {
        return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
      }

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

    // ── READ_BATCH ────────────────────────────────────────────────────────────
    if (action === "read_batch") {
      const { reservationIds } = payload as { reservationIds: string[] };
      if (!Array.isArray(reservationIds) || !reservationIds.length)
        return NextResponse.json({ success: true, logs: [] });

      const ids = reservationIds.slice(0, 30);
      const snap = await adminDb.collection("logs")
        .where("reservationId", "in", ids)
        .orderBy("createdAt", "desc")
        .limit(ids.length * 5)
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
