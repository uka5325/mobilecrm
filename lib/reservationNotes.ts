import {
  addDoc,
  collection,
  doc,
  getDocs,
  type QuerySnapshot,
  type DocumentData,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import type { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";
import { toMillis } from "./settingsUtils";
import { createLog } from "./logs";

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


export async function getReservationNotes(
  reservationId: string,
  reservationDocId: string,
  patientId?: string
): Promise<ReservationNote[]> {
  const cleanReservationId = cleanText(reservationId);
  const cleanReservationDocId = cleanText(reservationDocId);
  const cleanPatientId = cleanText(patientId);

  const requests: Promise<QuerySnapshot<DocumentData>>[] = [];

  const targets = [
    { field: "reservationId", value: cleanReservationId },
    { field: "reservationDocId", value: cleanReservationDocId },
    { field: "patientId", value: cleanPatientId },
  ].filter((item) => item.value);

  targets.forEach((target) => {
    requests.push(
      getDocs(
        query(
          collection(db, "reservationNotes"),
          where(target.field, "==", target.value)
        )
      )
    );
  });

  if (!requests.length) return [];

  const snaps = await Promise.allSettled(requests);
  const noteMap = new Map<string, ReservationNote>();

  snaps.forEach((result) => {
    if (result.status !== "fulfilled") {
      console.error("[reservationNotes query failed]", result.reason);
      return;
    }

    result.value.docs.forEach((d) => {
      const data = d.data();

      const isDeleted =
        data.isDeleted === true ||
        data.deleted === true ||
        data.status === "deleted";

      if (isDeleted) return;

      const memoText = cleanText(
        data.memoText ||
          data.memo ||
          data.note ||
          data.content ||
          data.text
      );

      if (!memoText) return;

      const note: ReservationNote = {
        id: d.id,
        reservationId: cleanText(data.reservationId || cleanReservationId),
        reservationDocId: cleanText(
          data.reservationDocId || cleanReservationDocId
        ),
        patientId: cleanText(data.patientId || cleanPatientId),
        memoText,
        createdAt: data.createdAt,
        createdBy: cleanText(
          data.createdBy ||
            data.createdByName ||
            data.staffName ||
            data.writer
        ),
        createdByUid: cleanText(data.createdByUid || data.createdBy),
        updatedAt: data.updatedAt,
        updatedBy: cleanText(data.updatedBy),
        updatedByUid: cleanText(data.updatedByUid),
        isDeleted,
      };

      noteMap.set(note.id, note);
    });
  });

  const notes = Array.from(noteMap.values()).sort(
    (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)
  );

  return notes;
}

export async function addReservationNote(params: {
  reservationId: string;
  reservationDocId: string;
  patientId: string;
  memoText: string;
  staff: StaffUser;
}) {
  const memoText = params.memoText.trim();

  if (!memoText) {
    return { success: false, message: "메모 내용을 입력하세요." };
  }

  const ref = await addDoc(collection(db, "reservationNotes"), {
    reservationId: params.reservationId,
    reservationDocId: params.reservationDocId,
    patientId: params.patientId,
    memoText,
    createdAt: serverTimestamp(),
    createdBy: params.staff.displayName,
    createdByUid: params.staff.uid,
    updatedAt: serverTimestamp(),
    updatedBy: params.staff.displayName,
    updatedByUid: params.staff.uid,
    isDeleted: false,
  });

  await createLog({
    action: "memo_create",
    targetType: "reservation",
    targetId: params.reservationId,
    staff: params.staff,
    message: memoText,
    patientId: params.patientId,
    reservationId: params.reservationId,
    before: null,
    after: {
      memoText,
      noteId: ref.id,
    },
  });

  return { success: true, id: ref.id };
}

export async function updateReservationNote(params: {
  noteId: string;
  reservationId: string;
  patientId: string;
  memoText: string;
  staff: StaffUser;
}) {
  const memoText = params.memoText.trim();

  if (!memoText) {
    return { success: false, message: "메모 내용을 입력하세요." };
  }

  await updateDoc(doc(db, "reservationNotes", params.noteId), {
    memoText,
    updatedAt: serverTimestamp(),
    updatedBy: params.staff.displayName,
    updatedByUid: params.staff.uid,
  });

  await createLog({
    action: "memo_update",
    targetType: "reservation",
    targetId: params.reservationId,
    staff: params.staff,
    message: "메모를 수정했습니다.",
    patientId: params.patientId,
    reservationId: params.reservationId,
    before: null,
    after: {
      memoText,
      noteId: params.noteId,
    },
  });

  return { success: true };
}

export async function deleteReservationNote(params: {
  noteId: string;
  reservationId: string;
  patientId: string;
  staff: StaffUser;
}) {
  await updateDoc(doc(db, "reservationNotes", params.noteId), {
    isDeleted: true,
    updatedAt: serverTimestamp(),
    updatedBy: params.staff.displayName,
    updatedByUid: params.staff.uid,
  });

  await createLog({
    action: "memo_delete",
    targetType: "reservation",
    targetId: params.reservationId,
    staff: params.staff,
    message: "메모를 삭제했습니다.",
    patientId: params.patientId,
    reservationId: params.reservationId,
    before: null,
    after: {
      noteId: params.noteId,
      isDeleted: true,
    },
  });

  return { success: true };
}
