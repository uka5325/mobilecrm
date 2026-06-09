import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
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
  fileUrl: string;
  storagePath: string;
  fileSize: number;
  uploadedAt?: unknown;
  uploadedBy: string;
  uploadedByUid: string;
  isDeleted: boolean;
};

export type ChartRecord = {
  id: string;
  reservationDocId: string;
  reservationId: string;
  patientId: string;
  label: string;
  chartUrl: string;
  storagePath: string;
  createdAt?: unknown;
  createdBy: string;
  createdByUid: string;
  updatedAt?: unknown;
  updatedBy: string;
  updatedByUid: string;
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
    fileSize: Number(data.fileSize || 0),
    uploadedAt: data.uploadedAt,
    uploadedBy: cleanText(data.uploadedBy),
    uploadedByUid: cleanText(data.uploadedByUid),
    isDeleted: Boolean(data.isDeleted),
  };
}

function mapChartDoc(id: string, data: Record<string, unknown>): ChartRecord {
  return {
    id,
    reservationDocId: cleanText(data.reservationDocId),
    reservationId: cleanText(data.reservationId),
    patientId: cleanText(data.patientId),
    label: cleanText(data.label),
    chartUrl: cleanText(data.chartUrl),
    storagePath: cleanText(data.storagePath),
    createdAt: data.createdAt,
    createdBy: cleanText(data.createdBy),
    createdByUid: cleanText(data.createdByUid),
    updatedAt: data.updatedAt,
    updatedBy: cleanText(data.updatedBy),
    updatedByUid: cleanText(data.updatedByUid),
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

export async function uploadPhotoToStorage(
  reservationDocId: string,
  file: File
): Promise<{ storagePath: string; fileUrl: string }> {
  const ts = Date.now();
  const uid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  const safeName = sanitizeFileName(file.name);
  const storagePath = `reservationFiles/${reservationDocId}/photos/${ts}_${uid}_${safeName}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const fileUrl = await getDownloadURL(storageRef);
  return { storagePath, fileUrl };
}

export async function savePhotoRecord(
  reservationDocId: string,
  reservationId: string,
  patientId: string,
  file: File,
  storagePath: string,
  fileUrl: string,
  staff: StaffUser
): Promise<PhotoRecord> {
  const docRef = await addDoc(collection(db, "reservationPhotos"), {
    reservationDocId,
    reservationId,
    patientId,
    fileName: file.name,
    fileUrl,
    storagePath,
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
    fileName: file.name, fileUrl, storagePath,
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
  const { storagePath, fileUrl } = await uploadPhotoToStorage(reservationDocId, file);
  return savePhotoRecord(reservationDocId, reservationId, patientId, file, storagePath, fileUrl, staff);
}

export async function deleteReservationPhoto(
  photoId: string,
  storagePath: string,
  fileName: string,
  reservationId: string,
  patientId: string,
  staff: StaffUser
): Promise<void> {
  await deleteDoc(doc(db, "reservationPhotos", photoId));
  try {
    await deleteObject(ref(storage, storagePath));
  } catch {
    // Storage 삭제 실패해도 Firestore는 이미 삭제됨
  }
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

// ─── Charts ──────────────────────────────────────────────────────────────────

export async function getReservationCharts(
  reservationDocId: string
): Promise<ChartRecord[]> {
  const snap = await getDocs(
    query(
      collection(db, "reservationCharts"),
      where("reservationDocId", "==", reservationDocId),
      where("isDeleted", "==", false)
    )
  );
  return sortByTime(
    snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) =>
      mapChartDoc(d.id, d.data())
    )
  );
}

export async function uploadReservationChart(
  reservationDocId: string,
  reservationId: string,
  patientId: string,
  blob: Blob,
  label: string,
  staff: StaffUser
): Promise<ChartRecord> {
  const ts = Date.now();
  const uid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  const storagePath = `reservationFiles/${reservationDocId}/charts/${ts}_${uid}.png`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, blob, { contentType: "image/png" });
  const chartUrl = await getDownloadURL(storageRef);

  const docRef = await addDoc(collection(db, "reservationCharts"), {
    reservationDocId,
    reservationId,
    patientId,
    label,
    chartUrl,
    storagePath,
    createdAt: serverTimestamp(),
    createdBy: staff.displayName,
    createdByUid: staff.uid,
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
    isDeleted: false,
  });

  createLog({
    action: "file_upload",
    targetType: "file",
    targetId: docRef.id,
    staff,
    message: `상담차트 생성: ${label}`,
    reservationId,
    patientId,
  }).catch(() => {});

  return mapChartDoc(docRef.id, {
    reservationDocId, reservationId, patientId, label, chartUrl, storagePath,
    createdAt: null, createdBy: staff.displayName, createdByUid: staff.uid,
    updatedAt: null, updatedBy: staff.displayName, updatedByUid: staff.uid,
    isDeleted: false,
  });
}

export async function updateReservationChart(
  chartId: string,
  oldStoragePath: string,
  reservationDocId: string,
  reservationId: string,
  patientId: string,
  label: string,
  blob: Blob,
  staff: StaffUser
): Promise<ChartRecord> {
  // 기존 Storage 파일 삭제 후 같은 경로에 재업로드
  const ts = Date.now();
  const uid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  const storagePath = `reservationFiles/${reservationDocId}/charts/${ts}_${uid}.png`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, blob, { contentType: "image/png" });
  const chartUrl = await getDownloadURL(storageRef);

  // 기존 파일 삭제 (실패 무시)
  try { await deleteObject(ref(storage, oldStoragePath)); } catch {}

  await updateDoc(doc(db, "reservationCharts", chartId), {
    chartUrl,
    storagePath,
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  createLog({
    action: "file_upload",
    targetType: "file",
    targetId: chartId,
    staff,
    message: `상담차트 수정: ${label}`,
    reservationId,
    patientId,
  }).catch(() => {});

  return mapChartDoc(chartId, {
    reservationDocId, reservationId, patientId, label, chartUrl, storagePath,
    createdAt: null, createdBy: "", createdByUid: "",
    updatedAt: null, updatedBy: staff.displayName, updatedByUid: staff.uid,
    isDeleted: false,
  });
}

export async function deleteReservationChart(
  chartId: string,
  storagePath: string,
  label: string,
  reservationId: string,
  patientId: string,
  staff: StaffUser
): Promise<void> {
  await deleteDoc(doc(db, "reservationCharts", chartId));
  try { await deleteObject(ref(storage, storagePath)); } catch {}
  await createLog({
    action: "file_delete",
    targetType: "file",
    targetId: chartId,
    staff,
    message: `상담차트 삭제: ${label}`,
    reservationId,
    patientId,
  });
}
