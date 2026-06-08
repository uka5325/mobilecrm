import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebaseAdmin";

type RequestBody = {
  email: string;
  password: string;
  displayName: string;
  role: string;
  staffCode?: string;
  callerUid: string;
};

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
  }

  const { email, password, displayName, role, staffCode, callerUid } = body;

  if (!email || !password || !displayName || !role || !callerUid) {
    return NextResponse.json({ success: false, message: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  // 호출자가 admin인지 서버에서 재확인
  const callerDoc = await adminDb.collection("staff").doc(callerUid).get();
  if (!callerDoc.exists || callerDoc.data()?.role !== "admin") {
    return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
  }

  const validRoles = ["admin", "doctor", "coordinator", "staff", "interpreter"];
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
      updatedBy: callerDoc.data()?.displayName || "",
      updatedByUid: callerUid,
    });

    // audit log
    const callerData = callerDoc.data();
    await adminDb.collection("logs").add({
      action: "settings_update",
      targetType: "settings",
      targetId: userRecord.uid,
      staffUid: callerUid,
      staffName: callerData?.displayName || "",
      staffEmail: callerData?.email || "",
      staffRole: callerData?.role || "",
      staffCode: callerData?.staffCode || "",
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
