import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";

type RequestBody = {
  email: string;
  password: string;
  displayName: string;
  role: string;
  staffCode?: string;
  callerUid?: string;
};

export async function POST(req: NextRequest) {
  // 호출자 인가: 다른 API와 동일하게 requireActiveStaff로 통일.
  // active===true + 토큰 폐기(checkRevoked) 검사까지 수행 → 비활성/퇴사 admin 토큰 차단.
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

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
  }

  const { email, password, displayName, role, staffCode } = body;

  if (!email || !password || !displayName || !role) {
    return NextResponse.json({ success: false, message: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  // 로그인 사용자 역할만 허용. "doctor"는 로그인 계정으로 쓰지 않으므로 제외
  // (StaffRole 타입/권한레벨과 일치). 의사명은 예약의 doctors 배열에서 관리.
  const validRoles = ["admin", "coordinator", "staff", "interpreter"];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ success: false, message: "올바르지 않은 역할입니다." }, { status: 400 });
  }

  try {
    const userRecord = await adminAuth.createUser({ email, password, displayName });

    await adminDb.collection("staff").doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      displayName,
      role,
      active: true,
      staffCode: staffCode || "",
      orderNo: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: ctx.name,
      updatedByUid: ctx.uid,
    });

    // audit log — 신원은 검증된 토큰(ctx)만 사용
    await adminDb.collection("logs").add({
      action: "settings_update",
      targetType: "settings",
      targetId: userRecord.uid,
      staffUid: ctx.uid,
      staffName: ctx.name,
      staffEmail: ctx.email,
      staffRole: ctx.role,
      staffCode: ctx.staffCode,
      patientId: "",
      reservationId: "",
      invoiceId: "",
      message: `신규 직원 계정을 생성했습니다. (${displayName} / ${email})`,
      before: null,
      after: { email, displayName, role, staffCode: staffCode || "", active: true },
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, uid: userRecord.uid });
  } catch (err) {
    const error = err as { code?: string; message?: string };
    if (error.code === "auth/email-already-exists") {
      return NextResponse.json({ success: false, message: "이미 사용 중인 이메일입니다." }, { status: 409 });
    }
    if (error.code === "auth/invalid-email") {
      return NextResponse.json({ success: false, message: "올바르지 않은 이메일 형식입니다." }, { status: 400 });
    }
    if (error.code === "auth/weak-password") {
      return NextResponse.json({ success: false, message: "비밀번호는 6자 이상이어야 합니다." }, { status: 400 });
    }
    console.error("직원 생성 오류:", error);
    return NextResponse.json({ success: false, message: "직원 생성에 실패했습니다." }, { status: 500 });
  }
}
