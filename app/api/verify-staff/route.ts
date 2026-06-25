import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

export async function POST(req: NextRequest) {
  const { idToken } = await req.json();
  if (!idToken) {
    return NextResponse.json({ success: false }, { status: 400 });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const snap = await adminDb.collection("staff").doc(uid).get();
    if (snap.exists && snap.data()?.active === true) {
      const data = snap.data()!;
      return NextResponse.json({
        success: true,
        user: {
          uid,
          email: String(data.email || ""),
          displayName: String(data.displayName || ""),
          role: data.role || "staff",
          active: true,
          staffCode: data.staffCode || undefined,
        },
      });
    }

    // fallback: email lookup
    const email = decoded.email;
    if (email) {
      const emailSnap = await adminDb
        .collection("staff")
        .where("email", "==", email.toLowerCase())
        .limit(1)
        .get();
      if (!emailSnap.empty && emailSnap.docs[0].data()?.active === true && emailSnap.docs[0].id === uid) {
        const d = emailSnap.docs[0];
        const data = d.data();
        return NextResponse.json({
          success: true,
          user: {
            uid: d.id,
            email: String(data.email || ""),
            displayName: String(data.displayName || ""),
            role: data.role || "staff",
            active: true,
            staffCode: data.staffCode || undefined,
          },
        });
      }
    }

    return NextResponse.json({ success: false, message: "등록되지 않은 계정입니다." });
  } catch (e) {
    console.error("[verify-staff]", e);
    return NextResponse.json({ success: false, message: "인증 실패" }, { status: 401 });
  }
}
