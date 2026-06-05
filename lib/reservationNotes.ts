import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import type { StaffUser } from "./auth";
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

function cleanText(value: unknown) {
  return String(value || "").trim();
}

export async function getReservationNotes(
  reservationId: string,
  reservationDocId: string
): Promise<ReservationNote[]> {
  const snap = await getDocs(
    query(
      collection(db, "reservationNotes"),
      where("reservationId", "==", reservationId),
      where("isDeleted", "==", false),
      orderBy("createdAt", "desc")
    )
  );

  return snap.docs.map((d) => {
    const data = d.data();

    return {
      id: d.id,
      reservationId: cleanText(data.reservationId),
      reservationDocId: cleanText(data.reservationDocId || reservationDocId),
      patientId: cleanText(data.patientId),
      memoText: cleanText(data.memoText),
      createdAt: data.createdAt,
      createdBy: cleanText(data.createdBy),
      createdByUid: cleanText(data.createdByUid),
      updatedAt: data.updatedAt,
      updatedBy: cleanText(data.updatedBy),
      updatedByUid: cleanText(data.updatedByUid),
      isDeleted: data.isDeleted === true,
    };
  });
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
