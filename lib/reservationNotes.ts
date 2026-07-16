import { auth } from "./firebase";
import type { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";
import { toMillis } from "./dateUtils";

export type ReservationNote = {
  id: string;
  reservationId: string;
  reservationDocId: string;
  patientId: string;
  memoText: string;
  createdAt?: unknown;
  createdBy: string;
  createdByUid: string;
  updatedAt?: unknown;
  updatedBy: string;
  updatedByUid: string;
  isDeleted: boolean;
};

export type MutationResult = { success: true } | { success: false; message: string };

async function callNotesApi(action: string, payload: Record<string, unknown>) {
  try {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return { success: false as const, message: "로그인이 필요합니다." };
    const idToken = await firebaseUser.getIdToken();
    const res = await fetch("/api/reservation-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, action, payload }),
    });
    // HTTP 상태와 본문 형식을 함께 검사한다. 500 HTML 오류 페이지나 잘못된 JSON에서
    // res.json()이 던지는 날것의 파싱 에러 대신 사용자용 메시지를 돌려준다.
    const body = (await res.json().catch(() => null)) as
      | (Record<string, unknown> & { success?: unknown; message?: string })
      | null;
    if (!res.ok || !body || typeof body.success !== "boolean") {
      return {
        success: false as const,
        message: body?.message || `메모 요청에 실패했습니다. (${res.status})`,
      };
    }
    return body as Record<string, unknown> & { success: boolean; message?: string };
  } catch {
    return { success: false as const, message: "네트워크를 확인해주세요." };
  }
}

function mapNote(
  data: Record<string, unknown>,
  fallbacks: { reservationId?: string; reservationDocId?: string; patientId?: string } = {}
): ReservationNote {
  return {
    id: cleanText(data.id),
    reservationId: cleanText(data.reservationId || fallbacks.reservationId),
    reservationDocId: cleanText(data.reservationDocId || fallbacks.reservationDocId),
    patientId: cleanText(data.patientId || fallbacks.patientId),
    memoText: cleanText(data.memoText || data.memo || data.note || data.content || data.text),
    createdAt: data.createdAt,
    createdBy: cleanText(data.createdBy || data.createdByName || data.staffName),
    createdByUid: cleanText(data.createdByUid),
    updatedAt: data.updatedAt,
    updatedBy: cleanText(data.updatedBy),
    updatedByUid: cleanText(data.updatedByUid),
    isDeleted: data.isDeleted === true,
  };
}

export type ReservationNotesResult =
  | { success: true; notes: ReservationNote[] }
  | { success: false; message: string };

export async function getReservationNotes(
  reservationId: string,
  reservationDocId: string,
  patientId?: string,
  options: { limit?: number } = {}
): Promise<ReservationNotesResult> {
  try {
    const result = await callNotesApi("read", {
      reservationId: cleanText(reservationId),
      reservationDocId: cleanText(reservationDocId),
      patientId: cleanText(patientId),
      limit: options.limit,
    });

    // 실패/네트워크 오류와 "메모 없음"을 값으로 구분한다. success이면서 notes가 명시적 배열일
    // 때만 정상 빈 목록으로 인정하고, 그 외(실패·오형식)는 에러로 반환한다.
    if (!result.success) {
      return { success: false, message: result.message || "메모를 불러오지 못했습니다." };
    }
    if (!Array.isArray(result.notes)) {
      return { success: false, message: "메모 응답 형식이 올바르지 않습니다." };
    }

    const notes = (result.notes as Record<string, unknown>[])
      .map((d) => mapNote(d, { reservationId, reservationDocId, patientId }))
      .filter((n) => !n.isDeleted && n.memoText)
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return { success: true, notes };
  } catch {
    return { success: false, message: "메모를 불러오지 못했습니다. 네트워크를 확인해주세요." };
  }
}

export async function addReservationNote(params: {
  reservationId: string;
  reservationDocId: string;
  patientId: string;
  memoText: string;
  staff: StaffUser;
}): Promise<MutationResult> {
  const memoText = params.memoText.trim();
  if (!memoText) return { success: false, message: "메모 내용을 입력하세요." };

  const result = await callNotesApi("create", {
    reservationId: params.reservationId,
    reservationDocId: params.reservationDocId,
    patientId: params.patientId,
    memoText,
    staffName: params.staff.displayName,
    staffUid: params.staff.uid,
  });

  return result.success ? { success: true } : { success: false, message: result.message || "저장 실패" };
}

export async function updateReservationNote(params: {
  noteId: string;
  reservationId: string;
  patientId: string;
  memoText: string;
  staff: StaffUser;
}): Promise<MutationResult> {
  const memoText = params.memoText.trim();
  if (!memoText) return { success: false, message: "메모 내용을 입력하세요." };

  const result = await callNotesApi("update", {
    noteId: params.noteId,
    memoText,
    reservationId: params.reservationId,
    patientId: params.patientId,
    staffName: params.staff.displayName,
    staffUid: params.staff.uid,
  });

  return result.success ? { success: true } : { success: false, message: result.message || "수정 실패" };
}

export async function deleteReservationNote(params: {
  noteId: string;
  reservationId: string;
  patientId: string;
  staff: StaffUser;
}): Promise<MutationResult> {
  const result = await callNotesApi("delete", {
    noteId: params.noteId,
    reservationId: params.reservationId,
    patientId: params.patientId,
    staffName: params.staff.displayName,
    staffUid: params.staff.uid,
  });

  return result.success ? { success: true } : { success: false, message: result.message || "삭제 실패" };
}
