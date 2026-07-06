import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  deleteObject,
  ref,
  uploadBytes,
} from "firebase/storage";
import { db, storage } from "./firebase";
import type { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";
import { toMillis } from "./settingsUtils";
import { createLog } from "./logs";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PhotoRecord = {
  id: string;
  reservationDocId: string;
  reservationId: string;
  patientId: string;
  fileName: string;
  // 신규 업로드는 fileUrl을 저장하지 않는다("") — storagePath + 인증 proxy로만 접근.
  // 레거시 레코드는 기존 다운로드 토큰 URL을 유지(fallback 용).
  fileUrl: string;
  storagePath: string;
  contentType: string;
  fileSize: number;
  uploadedAt?: unknown;
  uploadedBy: string;
  uploadedByUid: string;
  isDeleted: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9가-힣._-]/g, "_").slice(0, 80);
}

function mapPhotoDoc(id: string, data: Record<string, unknown>): PhotoRecord {
  return {
    id,
    reservationDocId: cleanText(data.reservationDocId),
    reservationId: cleanText(data.reservationId),
    patientId: cleanText(data.patientId),
    fileName: cleanText(data.fileName),
    fileUrl: cleanText(data.fileUrl),
    storagePath: cleanText(data.storagePath),
    contentType: cleanText(data.contentType),
    fileSize: Number(data.fileSize || 0),
    uploadedAt: data.uploadedAt,
    uploadedBy: cleanText(data.uploadedBy),
    uploadedByUid: cleanText(data.uploadedByUid),
    isDeleted: Boolean(data.isDeleted),
  };
}

function sortByTime<T extends { uploadedAt?: unknown; createdAt?: unknown }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    const ta = toMillis((a as { uploadedAt?: unknown; createdAt?: unknown }).uploadedAt ?? (a as { createdAt?: unknown }).createdAt) ?? 0;
    const tb = toMillis((b as { uploadedAt?: unknown; createdAt?: unknown }).uploadedAt ?? (b as { createdAt?: unknown }).createdAt) ?? 0;
    return tb - ta;
  });
}

// ─── Photos ──────────────────────────────────────────────────────────────────

export async function getReservationPhotos(
  reservationDocId: string
): Promise<PhotoRecord[]> {
  const snap = await getDocs(
    query(
      collection(db, "reservationPhotos"),
      where("reservationDocId", "==", reservationDocId),
      where("isDeleted", "==", false)
    )
  );
  return sortByTime(
    snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) =>
      mapPhotoDoc(d.id, d.data())
    )
  );
}

export type PendingPhoto = {
  tempId: string;
  fileName: string;
  fileSize: number;
  objectUrl: string;
  storagePath: string;
};

// storagePath 등 식별자를 로그에 남길 때 원문(파일명 PII 포함 가능) 대신 쓰는 안전한 짧은 해시.
function safeHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export async function uploadPhotoToStorage(
  reservationDocId: string,
  file: File
): Promise<{ storagePath: string; contentType: string }> {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("파일 크기는 10MB 이하여야 합니다.");
  }
  const ts = Date.now();
  const uid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  const safeName = sanitizeFileName(file.name);
  const storagePath = `reservationFiles/${reservationDocId}/photos/${ts}_${uid}_${safeName}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, { contentType: file.type });
  // 장기 유효 다운로드 토큰 URL(getDownloadURL)은 저장하지 않는다 — storagePath + 인증 proxy만 사용.
  return { storagePath, contentType: file.type };
}

export async function savePhotoRecord(
  reservationDocId: string,
  reservationId: string,
  patientId: string,
  file: File,
  storagePath: string,
  staff: StaffUser
): Promise<PhotoRecord> {
  const contentType = file.type;
  const docRef = await addDoc(collection(db, "reservationPhotos"), {
    reservationDocId,
    reservationId,
    patientId,
    fileName: file.name,
    // 신규 업로드는 다운로드 토큰 URL을 저장하지 않는다(storagePath 중심).
    fileUrl: "",
    storagePath,
    contentType,
    fileSize: file.size,
    uploadedAt: serverTimestamp(),
    uploadedBy: staff.displayName,
    uploadedByUid: staff.uid,
    isDeleted: false,
  });

  // fire-and-forget — log failure must not block the caller
  createLog({
    action: "file_upload",
    targetType: "file",
    targetId: docRef.id,
    staff,
    message: `사진 추가: ${file.name}`,
    reservationId,
    patientId,
  }).catch(() => {});

  return mapPhotoDoc(docRef.id, {
    reservationDocId, reservationId, patientId,
    fileName: file.name, fileUrl: "", storagePath, contentType,
    fileSize: file.size, uploadedAt: null,
    uploadedBy: staff.displayName, uploadedByUid: staff.uid, isDeleted: false,
  });
}

export async function uploadReservationPhoto(
  reservationDocId: string,
  reservationId: string,
  patientId: string,
  file: File,
  staff: StaffUser
): Promise<PhotoRecord> {
  const { storagePath } = await uploadPhotoToStorage(reservationDocId, file);
  return savePhotoRecord(reservationDocId, reservationId, patientId, file, storagePath, staff);
}

// 사진 삭제 — Firestore 메타 soft delete와 Storage 원본 삭제를 분리해 관측한다.
// Storage 삭제가 실패하면 성공으로 숨기지 않고, 사진 문서에 상태를 기록하고 예외를 던진다.
export async function deleteReservationPhoto(
  photoId: string,
  storagePath: string,
  fileName: string,
  reservationId: string,
  patientId: string,
  staff: StaffUser,
  reservationDocId?: string
): Promise<void> {
  // 1) Firestore 메타 soft delete
  await updateDoc(doc(db, "reservationPhotos", photoId), {
    isDeleted: true,
    deletedAt: serverTimestamp(),
  });

  await createLog({
    action: "file_delete",
    targetType: "file",
    targetId: photoId,
    staff,
    message: `사진 삭제: ${fileName}`,
    reservationId,
    patientId,
  });

  // 2) Storage 원본 삭제 — 실패 시 관측 가능하게 기록하고 예외를 던진다(성공으로 숨기지 않음).
  try {
    await deleteObject(ref(storage, storagePath));
    await updateDoc(doc(db, "reservationPhotos", photoId), {
      storageDeleteStatus: "deleted",
      storageDeleteAttemptedAt: serverTimestamp(),
    });
  } catch (e) {
    const errorCode = (e as { code?: string })?.code || "unknown";
    // URL/경로 원문은 로그에 남기지 않는다 — 안전한 해시/식별자만.
    await updateDoc(doc(db, "reservationPhotos", photoId), {
      storageDeleteStatus: "failed",
      storageDeleteErrorCode: errorCode,
      storageDeleteAttemptedAt: serverTimestamp(),
    }).catch(() => {});
    createLog({
      action: "STORAGE_DELETE_FAILED",
      targetType: "file",
      targetId: photoId,
      staff,
      message: `사진 Storage 원본 삭제 실패 (code=${errorCode}, path#${safeHash(storagePath)})`,
      reservationId,
      patientId,
    }).catch(() => {});
    void reservationDocId; // 호출부 호환용(관측 식별자) — 현재 로그는 photoId/patientId로 충분
    throw new Error("사진 원본 삭제에 실패했습니다. 목록에서 재시도해 주세요.");
  }
}
