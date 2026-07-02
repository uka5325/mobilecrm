import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import { docToObj } from "@/lib/adminUtils";

// CSV 내보내기 전용 서버 API.
// 기존 클라이언트 CSV는 화면에 로드된 45일 구독 데이터만 필터링했기 때문에
// 지정 기간(예: 3개월 전)이 누락됐고, 예약당 메모를 N번 조회했다.
// 여기서는 날짜 범위를 Firestore 쿼리로 내려 정확히 읽고, 메모는 reservationDocId in [...]
// 배치로 묶어 조회한다.
export async function POST(req: NextRequest) {
  try {
    const { idToken, startDate, endDate, includeNotes } = await req.json();

    try {
      await requireActiveStaff(idToken);
    } catch (authErr) {
      const res = toAuthErrorResponse(authErr);
      if (res) return res;
      throw authErr;
    }

    const from = String(startDate || "0000-00-00");
    const to = String(endDate || "9999-99-99");
    const CAP = 5000;

    // 인덱스: reservations (isDeleted, reservationDate) — read_all과 동일 형태 재사용.
    const snap = await adminDb
      .collection("reservations")
      .where("isDeleted", "==", false)
      .where("reservationDate", ">=", from)
      .where("reservationDate", "<=", to)
      .orderBy("reservationDate", "desc")
      .limit(CAP)
      .get();
    const reservations = snap.docs.map(docToObj);
    const capped = snap.docs.length === CAP;

    const notesByDoc: Record<string, { createdBy: string; memoText: string }[]> = {};
    if (includeNotes && reservations.length) {
      const docIds = reservations.map((r) => String(r.id)).filter(Boolean);
      const CHUNK = 30; // Firestore in 최대 30개
      for (let i = 0; i < docIds.length; i += CHUNK) {
        const chunk = docIds.slice(i, i + CHUNK);
        const nSnap = await adminDb
          .collection("reservationNotes")
          .where("reservationDocId", "in", chunk)
          .get();
        for (const d of nSnap.docs) {
          const data = d.data();
          if (data.isDeleted === true || data.deleted === true) continue;
          const rdid = String(data.reservationDocId || "");
          if (!rdid) continue;
          const memoText = String(data.memoText || data.memo || data.note || data.content || data.text || "").trim();
          if (!memoText) continue;
          (notesByDoc[rdid] ||= []).push({ createdBy: String(data.createdBy || ""), memoText });
        }
      }
    }

    return NextResponse.json({ success: true, reservations, notesByDoc, capped });
  } catch (e) {
    console.error("[/api/reservations/export]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
