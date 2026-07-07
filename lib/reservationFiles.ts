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
  // Storage 원본 삭제 상태 — "failed"면 목록에 계속 표시하고 재시도 버튼을 노출한다.
  storageDeleteStatus?: "pending" | "deleted" | "failed";
  storageDeleteErrorCode?: string;
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
    ...(data.storageDeleteStatus ? { storageDeleteStatus: data.storageDeleteStatus as PhotoRecord["storageDeleteStatus"] } : {}),
    ...(data.storageDeleteErrorCode ? { storageDeleteErrorCode: cleanText(data.storageDeleteErrorCode) } : {}),
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

export async function deleteStorageFile(storagePath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, storagePath));
  } catch {
    // best-effort cleanup
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

// Storage 삭제 시도 결과를 분류하는 순수 함수 — Firestore/Storage 의존이 없어 단위 테스트 가능.
// object-not-found는 이미 삭제된 것으로 보고 "deleted"(성공) 처리한다(재시도 시 다시 실패하지 않게).
// 그 외 에러는 "failed"로 분류해 isDeleted를 건드리지 않고 재시도 가능한 상태로 남긴다.
export function classifyStorageDeleteError(
  err: unknown
): { status: "deleted" } | { status: "failed"; errorCode: string } {
  const errorCode = (err as { code?: string })?.code || "unknown";
  if (errorCode === "storage/object-not-found") return { status: "deleted" };
  return { status: "failed", errorCode };
}

// 사진 삭제 — Firestore 메타 soft delete와 Storage 원본 삭제를 분리해 관측한다.
// Storage 삭제가 실패하면 성공으로 숨기지 않고, 사진 문서에 상태를 기록하고 예외를 던진다.
// 사진 삭제(재시도 가능) — 순서:
//   1) storageDeleteStatus=pending 기록(아직 isDeleted는 건드리지 않음 — 삭제 미확정 상태)
//   2) Storage 원본 삭제 시도
//   성공(또는 이미 없음: object-not-found): isDeleted=true + storageDeleteStatus=deleted +
//     file_delete 성공 로그(Storage 삭제 성공 후에만 기록)
//   실패(그 외 에러): isDeleted는 false로 유지 → 사진이 목록에 계속 표시되고 재시도 가능,
//     storageDeleteStatus=failed + errorCode/attemptedAt 기록, STORAGE_DELETE_FAILED 로그, 예외를 던진다.
export async function deleteReservationPhoto(
  photoId: string,
  storagePath: string,
  fileName: string,
  reservationId: string,
  patientId: string,
  staff: StaffUser,
  reservationDocId?: string
): Promise<void> {
  void reservationDocId; // 호출부 호환용(관측 식별자) — 현재 로그는 photoId/patientId로 충분
  const photoRef = doc(db, "reservationPhotos", photoId);

  // 1) pending 상태 기록 — isDeleted는 아직 그대로(false) 둔다.
  await updateDoc(photoRef, {
    storageDeleteStatus: "pending",
    storageDeleteAttemptedAt: serverTimestamp(),
  });

  // 2) Storage 원본 삭제 시도
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (e) {
    const outcome = classifyStorageDeleteError(e);
    if (outcome.status === "failed") {
      // URL/경로 원문은 로그에 남기지 않는다 — 안전한 해시/식별자만. isDeleted는 false로 유지되어
      // 목록에 계속 표시되고(getReservationPhotos는 isDeleted==false만 조회) 재시도 버튼이 노출된다.
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
    // object-not-found → 아래로 흘러 성공 처리.
  }

  // 3) 성공(또는 이미 없음) — Firestore soft delete를 여기서 확정한다.
  await updateDoc(photoRef, {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    storageDeleteStatus: "deleted",
    storageDeleteAttemptedAt: serverTimestamp(),
  });

  // file_delete 성공 로그는 Storage 삭제가 실제로 성공한 뒤에만 기록한다.
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
