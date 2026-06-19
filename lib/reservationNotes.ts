import { auth } from "./firebase";
import type { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";
import { toMillis } from "./settingsUtils";

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

async function callNotesApi(action: string, payload: Record<string, unknown>) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) return { success: false as const };
  const idToken = await firebaseUser.getIdToken();
  const res = await fetch("/api/reservation-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action, payload }),
  });
  return res.json() as Promise<Record<string, unknown> & { success: boolean; message?: string }>;
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

export async function getReservationNotes(
  reservationId: string,
  reservationDocId: string,
  patientId?: string
): Promise<ReservationNote[]> {
  const result = await callNotesApi("read", {
    reservationId: cleanText(reservationId),
    reservationDocId: cleanText(reservationDocId),
    patientId: cleanText(patientId),
  });

  if (!result.success || !Array.isArray(result.notes)) return [];

  return (result.notes as Record<string, unknown>[])
    .map((d) => mapNote(d, { reservationId, reservationDocId, patientId }))
    .filter((n) => !n.isDeleted && n.memoText)
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export async function addReservationNote(params: {
  reservationId: string;
  reservationDocId: string;
  patientId: string;
  memoText: string;
  staff: StaffUser;
}) {
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

  return result.success
    ? { success: true, id: String(result.id || "") }
    : { success: false, message: result.message || "저장 실패" };
}

export async function updateReservationNote(params: {
  noteId: string;
  reservationId: string;
  patientId: string;
  memoText: string;
  staff: StaffUser;
}) {
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
}) {
  const result = await callNotesApi("delete", {
    noteId: params.noteId,
    reservationId: params.reservationId,
    patientId: params.patientId,
    staffName: params.staff.displayName,
    staffUid: params.staff.uid,
  });

  return result.success ? { success: true } : { success: false, message: result.message || "삭제 실패" };
}
