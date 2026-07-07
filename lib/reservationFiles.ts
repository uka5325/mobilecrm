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
import { deleteObject, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "./firebase";
import type { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";
import { toMillis } from "./settingsUtils";
import { createLog } from "./logs";

export type PhotoRecord = {
  id: string;
  reservationDocId: string;
  reservationId: string;
  patientId: string;
  fileName: string;
  fileUrl: string;
  storagePath: string;
  contentType: string;
  fileSize: number;
  uploadedAt?: unknown;
  uploadedBy: string;
  uploadedByUid: string;
  isDeleted: boolean;
  storageDeleteStatus?: "pending" | "deleted" | "failed";
  storageDeleteErrorCode?: string;
};

export type PendingPhoto = {
  tempId: string;
  fileName: string;
  fileSize: number;
  objectUrl: string;
  storagePath: string;
};

const LOCAL_CLEANUP_KEY = "crm_pending_storage_cleanup";

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
    ...(data.storageDeleteStatus
      ? { storageDeleteStatus: data.storageDeleteStatus as PhotoRecord["storageDeleteStatus"] }
      : {}),
    ...(data.storageDeleteErrorCode
      ? { storageDeleteErrorCode: cleanText(data.storageDeleteErrorCode) }
      : {}),
  };
}

function sortByTime<T extends { uploadedAt?: unknown; createdAt?: unknown }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = toMillis(a.uploadedAt ?? a.createdAt) ?? 0;
    const tb = toMillis(b.uploadedAt ?? b.createdAt) ?? 0;
    return tb - ta;
  });
}

function safeHash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function rememberLocalCleanup(storagePath: string) {
  if (typeof window === "undefined") return;
  try {
    const previous = JSON.parse(localStorage.getItem(LOCAL_CLEANUP_KEY) || "[]") as Array<{
      storagePath: string;
      createdAt: number;
    }>;
    const next = [
      ...previous.filter((item) => item.storagePath !== storagePath),
      { storagePath, createdAt: Date.now() },
    ].slice(-50);
    localStorage.setItem(LOCAL_CLEANUP_KEY, JSON.stringify(next));
  } catch {
    // localStorage가 차단돼 있어도 아래 사용자 경고는 계속 표시한다.
  }
}

async function requestServerCleanup(storagePath: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const idToken = await user.getIdToken();
    const response = await fetch("/api/storage-cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, storagePath }),
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return body.success === true && (body.deleted === true || body.queued === true);
  } catch {
    return false;
  }
}

export async function getReservationPhotos(reservationDocId: string): Promise<PhotoRecord[]> {
  const snap = await getDocs(
    query(
      collection(db, "reservationPhotos"),
      where("reservationDocId", "==", reservationDocId),
      where("isDeleted", "==", false)
    )
  );
  return sortByTime(
    snap.docs.map((item) => mapPhotoDoc(item.id, item.data() as Record<string, unknown>))
  );
}

export async function uploadPhotoToStorage(
  reservationDocId: string,
  file: File
): Promise<{ storagePath: string; contentType: string }> {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("파일 크기는 10MB 이하여야 합니다.");
  }
  const timestamp = Date.now();
  const uid = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  const storagePath = `reservationFiles/${reservationDocId}/photos/${timestamp}_${uid}_${sanitizeFileName(file.name)}`;
  await uploadBytes(ref(storage, storagePath), file, { contentType: file.type });
  return { storagePath, contentType: file.type };
}

// 사진 메타데이터 저장 실패 시 사용하는 보상 삭제.
// 클라이언트 삭제 실패 → 서버 관리자 권한 재시도 → 실패 시 storageCleanupJobs 기록 순으로 처리한다.
export async function deleteStorageFile(storagePath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, storagePath));
    return;
  } catch (error) {
    const code = (error as { code?: string })?.code || "";
    if (code === "storage/object-not-found") return;
  }

  if (await requestServerCleanup(storagePath)) return;

  rememberLocalCleanup(storagePath);
  if (typeof window !== "undefined") {
    window.alert(
      "사진 정보 저장에 실패했고 원본 파일 자동 정리도 완료되지 않았습니다. 관리자에게 알려주세요."
    );
  }
}

export async function savePhotoRecord(
  reservationDocId: string,
  reservationId: string,
  patientId: string,
  file: File,
  storagePath: string,
  staff: StaffUser
): Promise<PhotoRecord> {
  const docRef = await addDoc(collection(db, "reservationPhotos"), {
    reservationDocId,
    reservationId,
    patientId,
    fileName: file.name,
    fileUrl: "",
    storagePath,
    contentType: file.type,
    fileSize: file.size,
    uploadedAt: serverTimestamp(),
    uploadedBy: staff.displayName,
    uploadedByUid: staff.uid,
    isDeleted: false,
  });

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
    reservationDocId,
    reservationId,
    patientId,
    fileName: file.name,
    fileUrl: "",
    storagePath,
    contentType: file.type,
    fileSize: file.size,
    uploadedAt: null,
    uploadedBy: staff.displayName,
    uploadedByUid: staff.uid,
    isDeleted: false,
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
  try {
    return await savePhotoRecord(
      reservationDocId,
      reservationId,
      patientId,
      file,
      storagePath,
      staff
    );
  } catch (error) {
    await deleteStorageFile(storagePath);
    throw error;
  }
}

export function classifyStorageDeleteError(
  error: unknown
): { status: "deleted" } | { status: "failed"; errorCode: string } {
  const errorCode = (error as { code?: string })?.code || "unknown";
  if (errorCode === "storage/object-not-found") return { status: "deleted" };
  return { status: "failed", errorCode };
}

export async function deleteReservationPhoto(
  photoId: string,
  storagePath: string,
  fileName: string,
  reservationId: string,
  patientId: string,
  staff: StaffUser,
  reservationDocId?: string
): Promise<void> {
  void reservationDocId;
  const photoRef = doc(db, "reservationPhotos", photoId);

  await updateDoc(photoRef, {
    storageDeleteStatus: "pending",
    storageDeleteAttemptedAt: serverTimestamp(),
  });

  try {
    await deleteObject(ref(storage, storagePath));
  } catch (error) {
    const outcome = classifyStorageDeleteError(error);
    if (outcome.status === "failed") {
      await updateDoc(photoRef, {
        storageDeleteStatus: "failed",
        storageDeleteErrorCode: outcome.errorCode,
        storageDeleteAttemptedAt: serverTimestamp(),
      }).catch(() => {});
      createLog({
        action: "STORAGE_DELETE_FAILED",
        targetType: "file",
        targetId: photoId,
        staff,
        message: `사진 Storage 원본 삭제 실패 (code=${outcome.errorCode}, path#${safeHash(storagePath)})`,
        reservationId,
        patientId,
      }).catch(() => {});
      throw new Error("사진 원본 삭제에 실패했습니다. 목록에서 다시 시도해 주세요.");
    }
  }

  await updateDoc(photoRef, {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    storageDeleteStatus: "deleted",
    storageDeleteAttemptedAt: serverTimestamp(),
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
}
