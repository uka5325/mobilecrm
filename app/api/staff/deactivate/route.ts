import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";

// 직원 비활성화 전용 서버 API.
// active:false 변경 "직후" Firebase refresh token을 revoke해, 이미 로그인해 둔
// 비활성 직원의 세션이 즉시 무력화되도록 한다(클라 Firestore 직접 쓰기로는 revoke 불가).
// token revoke가 실패해도 active:false는 유지하고, TOKEN_REVOKE_FAILED를 운영 로그에 남긴다.
// 민감정보(이름/전화/생년 등)는 로그에 남기지 않는다 — 식별자(uid)만.
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
  if (uid === ctx.uid) {
    return NextResponse.json({ success: false, message: "본인 계정은 비활성화할 수 없습니다." }, { status: 400 });
  }

  const staffRef = adminDb.collection("staff").doc(uid);
  const snap = await staffRef.get();
  if (!snap.exists) {
    return NextResponse.json({ success: false, message: "직원을 찾을 수 없습니다." }, { status: 404 });
  }

  // 1) active:false (신원은 검증된 토큰 ctx로 강제)
  await staffRef.update({
    active: false,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: ctx.name,
    updatedByUid: ctx.uid,
  });

  // 2) refresh token revoke — 실패해도 active:false는 유지하고 운영 로그만 남긴다.
  let tokenRevoked = true;
  let revokeErrorCode = "";
  try {
    await adminAuth.revokeRefreshTokens(uid);
  } catch (e) {
    tokenRevoked = false;
    revokeErrorCode = (e as { code?: string })?.code || "unknown";
    console.error("[staff/deactivate] TOKEN_REVOKE_FAILED", { uid, errorCode: revokeErrorCode });
  }

  await adminDb.collection("logs").add({
    action: tokenRevoked ? "settings_update" : "TOKEN_REVOKE_FAILED",
    targetType: "settings",
    targetId: uid,
    staffUid: ctx.uid, staffName: ctx.name, staffEmail: ctx.email,
    staffRole: ctx.role, staffCode: ctx.staffCode,
    patientId: "", reservationId: "", invoiceId: "",
    errorCode: tokenRevoked ? "" : "TOKEN_REVOKE_FAILED",
    message: tokenRevoked
      ? "직원을 비활성화하고 세션 토큰을 무효화했습니다."
      : `직원을 비활성화했으나 토큰 무효화에 실패했습니다. (code=${revokeErrorCode})`,
    before: null,
    after: { active: false, tokenRevoked },
    createdAt: FieldValue.serverTimestamp(),
  });

  // token revoke 실패는 부분 실패로 명확히 표시(성공으로 숨기지 않음).
  return NextResponse.json({
    success: true,
    tokenRevoked,
    ...(tokenRevoked ? {} : { code: "TOKEN_REVOKE_FAILED", message: "토큰 무효화에 실패했습니다. 잠시 후 다시 시도해 주세요." }),
  });
}
