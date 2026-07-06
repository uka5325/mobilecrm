import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";

// 직원 활성화 전용 서버 API. active는 firestore.rules에서 클라이언트 직접 변경을 차단하므로,
// 활성화도 비활성화(app/api/staff/deactivate)와 마찬가지로 이 서버 API로만 가능하다.
// 활성화는 세션을 무력화할 필요가 없으므로 refresh token revoke는 하지 않는다.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  let ctx;
  try {
    ctx = await requireActiveStaff(token, { checkRevoked: true });
  } catch (authErr) {
    const res = toAuthErrorResponse(authErr);
    if (res) return res;
    throw authErr;
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
  }

  let body: { uid?: string };
  try {
    body = (await req.json()) as { uid?: string };
  } catch {
    return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
  }
  const uid = String(body.uid || "");
  if (!uid) {
    return NextResponse.json({ success: false, message: "직원 uid가 없습니다." }, { status: 400 });
  }

  const staffRef = adminDb.collection("staff").doc(uid);
  const snap = await staffRef.get();
  if (!snap.exists) {
    return NextResponse.json({ success: false, message: "직원을 찾을 수 없습니다." }, { status: 404 });
  }

  await staffRef.update({
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: ctx.name,
    updatedByUid: ctx.uid,
  });

  await adminDb.collection("logs").add({
    action: "settings_update",
    targetType: "settings",
    targetId: uid,
    staffUid: ctx.uid, staffName: ctx.name, staffEmail: ctx.email,
    staffRole: ctx.role, staffCode: ctx.staffCode,
    patientId: "", reservationId: "", invoiceId: "",
    message: "직원을 활성화했습니다.",
    before: null,
    after: { active: true },
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ success: true });
}
