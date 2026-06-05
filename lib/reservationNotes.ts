import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  doc,
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
      reservationId: String(data.reservationId || ""),
      reservationDocId: String(data.reservationDocId || reservationDocId || ""),
      patientId: String(data.patientId || ""),
      memoText: String(data.memoText || ""),
      createdAt: data.createdAt,
      createdBy: String(data.createdBy || ""),
      createdByUid: String(data.createdByUid || ""),
      updatedAt: data.updatedAt,
      updatedBy: String(data.updatedBy || ""),
      updatedByUid: String(data.updatedByUid || ""),
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
    targetType: "reservationNote",
    targetId: ref.id,
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
    targetType: "reservationNote",
    targetId: params.noteId,
    staff: params.staff,
    message: "메모를 삭제했습니다.",
    patientId: params.patientId,
    reservationId: params.reservationId,
    before: null,
    after: {
      isDeleted: true,
    },
  });

  return { success: true };
}
