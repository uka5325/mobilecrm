import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import { toSerializable as toSer } from "@/lib/adminUtils";

// 감사로그 무결성: 임의 action/targetType 주입과 거대 payload로 인한 오염 방지.
const ALLOWED_LOG_ACTIONS = new Set([
  "reservation_create", "reservation_update", "reservation_delete",
  "patient_update", "patient_delete",
  "invoice_create", "invoice_update", "invoice_delete",
  "memo_create", "memo_update", "memo_delete",
  "file_upload", "file_delete", "STORAGE_DELETE_FAILED",
  "settings_update",
]);
const ALLOWED_LOG_TARGET_TYPES = new Set([
  "reservation", "patient", "invoice", "memo", "file", "settings",
]);
const LOG_PAYLOAD_MAX_BYTES = 10_000;
function withinSize(v: unknown): boolean {
  if (v == null) return true;
  try { return JSON.stringify(v).length <= LOG_PAYLOAD_MAX_BYTES; } catch { return false; }
}

export async function POST(req: NextRequest) {
  try {
    const { idToken, action, payload } = await req.json();

    // 활성 직원 인가 (공통 가드가 5분 캐시 포함)
    let ctx;
    try {
      ctx = await requireActiveStaff(idToken);
    } catch (authErr) {
      const res = toAuthErrorResponse(authErr);
      if (res) return res;
      throw authErr;
    }

    // ── CREATE ──────────────────────────────────────────────────────────────
    if (action === "create") {
      const {
        action: logAction, targetType, targetId = "",
        patientId = "", reservationId = "", invoiceId = "", message, before = null, after = null,
      } = payload as Record<string, unknown>;

      // action/targetType 화이트리스트 + payload 크기 제한 → 로그 오염 방지
      if (!ALLOWED_LOG_ACTIONS.has(String(logAction))) {
        return NextResponse.json({ success: false, message: "허용되지 않은 로그 action입니다." }, { status: 400 });
      }
      if (!ALLOWED_LOG_TARGET_TYPES.has(String(targetType))) {
        return NextResponse.json({ success: false, message: "허용되지 않은 targetType입니다." }, { status: 400 });
      }
      if (!withinSize(before) || !withinSize(after)) {
        return NextResponse.json({ success: false, message: "로그 payload가 너무 큽니다." }, { status: 413 });
      }

      // 감사로그 신원은 클라이언트 payload가 아닌 검증된 토큰(ctx) 값만 사용 → 위조 차단
      await adminDb.collection("logs").add({
        action: logAction,
        targetType,
        targetId,
        staffUid: ctx.uid,
        staffName: ctx.name,
        staffEmail: ctx.email,
        staffRole: ctx.role,
        staffCode: ctx.staffCode,
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
      const { reservationId, targetId, patientId, sinceDays } = payload as { reservationId?: string; targetId?: string; patientId?: string; sinceDays?: number };
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

      // sinceDays>0이면 최근 N일만 (상세 오픈 시 기본 3일). 0/미지정이면 전체(최대 50, "이전 로그 보기").
      // 색인: logs(primaryField, createdAt) 기존재.
      let q = adminDb.collection("logs")
        .where(primaryField, "==", primaryValue)
        .orderBy("createdAt", "desc") as FirebaseFirestore.Query;
      if (typeof sinceDays === "number" && sinceDays > 0) {
        const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
        q = q.where("createdAt", ">=", cutoff);
      }

      const snap = await q.limit(LOG_LIMIT).get();

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
      // 예약별 "최신 1건"만 필요하므로 예약별 limit(1) 병렬 쿼리.
      // 기존 `in`+전역 limit 방식은 활동 많은 예약이 한도를 모두 차지해
      // 다른 예약 로그가 누락되는 문제가 있었고, 읽기 비용도 더 컸음.
      const snaps = await Promise.all(
        ids.map((rid) =>
          adminDb.collection("logs")
            .where("reservationId", "==", rid)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get()
        )
      );

      const list = snaps.flatMap((snap) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        snap.docs.map((d: any) => toSer({ id: d.id, ...d.data() }))
      );
      return NextResponse.json({ success: true, logs: list });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e) {
    console.error("[/api/logs]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
