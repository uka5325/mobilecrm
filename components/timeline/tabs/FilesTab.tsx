"use client";

import { useEffect, useRef, useState } from "react";
import type { StaffUser } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import {
  deleteReservationPhoto,
  deleteStorageFile,
  getReservationPhotos,
  uploadPhotoToStorage,
  savePhotoRecord,
  type PhotoRecord,
} from "@/lib/reservationFiles";
import { compressImage } from "@/lib/imageCompress";
import { createLog } from "@/lib/logs";

type Props = {
  reservationDocId: string;
  reservationId: string;
  patientId: string;
  currentUser: StaffUser;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(value: unknown): string {
  if (!value) return "";
  let ms: number | null = null;
  if (typeof value === "object" && value !== null && "toMillis" in value) {
    ms = (value as { toMillis: () => number }).toMillis();
  } else if (typeof value === "number") {
    ms = value;
  }
  if (!ms) return "";
  const date = new Date(ms);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

export function FilesTab({ reservationDocId, reservationId, patientId, currentUser }: Props) {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [viewingUrl, setViewingUrl] = useState<string | null>(null);
  const [viewingObjectUrl, setViewingObjectUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [error, setError] = useState("");
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  async function openViewer(photo: PhotoRecord) {
    if (!photo.storagePath) {
      setViewingUrl(photo.fileUrl);
      return;
    }
    setViewerLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error("로그인 정보를 확인할 수 없습니다.");
      const idToken = await firebaseUser.getIdToken();
      const response = await fetch(`/api/proxy-image?path=${encodeURIComponent(photo.storagePath)}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!response.ok) throw new Error(`proxy-image ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      setViewingObjectUrl(objectUrl);
      setViewingUrl(objectUrl);
    } catch {
      setError("사진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setViewerLoading(false);
    }
  }

  function closeViewer() {
    if (viewingObjectUrl) URL.revokeObjectURL(viewingObjectUrl);
    setViewingObjectUrl(null);
    setViewingUrl(null);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationDocId]);

  async function load() {
    setPhotosLoading(true);
    try {
      setPhotos(await getReservationPhotos(reservationDocId));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setError(`파일 목록을 불러오지 못했습니다. (${message})`);
    } finally {
      setPhotosLoading(false);
    }
  }

  async function reportCompensationFailure(errorCode: string) {
    await createLog({
      action: "STORAGE_DELETE_FAILED",
      targetType: "file",
      targetId: reservationDocId,
      staff: currentUser,
      message: `사진 정보 저장 실패 후 업로드 원본 정리 실패 (code=${errorCode})`,
      reservationId,
      patientId,
    }).catch(() => {});
  }

  async function handlePhotoFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    const fileArray = Array.from(files);
    const maxFileSize = 10 * 1024 * 1024;
    const allowedTypes = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "image/gif"];
    const invalidFiles = fileArray.filter(
      (file) => file.size > maxFileSize || !allowedTypes.includes(file.type)
    );
    if (invalidFiles.length > 0) {
      setError(`업로드 불가 파일이 있습니다: ${invalidFiles.map((file) => file.name).join(", ")}\n(최대 10MB, 이미지 파일만 허용)`);
      return;
    }

    setTimeout(() => {
      if (photoInputRef.current) photoInputRef.current.value = "";
    }, 0);
    setUploadingCount((count) => count + fileArray.length);
    const objectUrls: string[] = [];

    void (async () => {
      try {
        const maxConcurrent = 5;
        const compressed: File[] = [];
        for (let index = 0; index < fileArray.length; index += maxConcurrent) {
          const chunk = fileArray.slice(index, index + maxConcurrent);
          compressed.push(...await Promise.all(chunk.map((file) => compressImage(file))));
        }

        const storageResults: { f: File; storagePath: string; contentType: string }[] = [];
        for (let index = 0; index < compressed.length; index += maxConcurrent) {
          const chunk = compressed.slice(index, index + maxConcurrent);
          storageResults.push(...await Promise.all(
            chunk.map((file) => uploadPhotoToStorage(reservationDocId, file).then((result) => ({ file, ...result })))
          ).then((items) => items.map(({ file, ...rest }) => ({ f: file, ...rest }))));
        }

        const optimisticItems: PhotoRecord[] = storageResults.map(({ f, storagePath }) => {
          const objectUrl = URL.createObjectURL(f);
          objectUrls.push(objectUrl);
          return {
            id: `tmp_${Math.random().toString(36).slice(2)}`,
            reservationDocId,
            reservationId,
            patientId,
            fileName: f.name,
            fileUrl: objectUrl,
            storagePath,
            contentType: f.type,
            fileSize: f.size,
            uploadedAt: null,
            uploadedBy: currentUser.displayName,
            uploadedByUid: currentUser.uid,
            isDeleted: false,
          };
        });
        setPhotos((previous) => [...optimisticItems, ...previous]);
        setUploadingCount((count) => count - fileArray.length);

        storageResults.forEach(({ f, storagePath }, index) => {
          const temporaryId = optimisticItems[index].id;
          savePhotoRecord(
            reservationDocId,
            reservationId,
            patientId,
            f,
            storagePath,
            currentUser
          )
            .then((record) => {
              URL.revokeObjectURL(objectUrls[index]);
              setPhotos((previous) => previous.map((photo) =>
                photo.id === temporaryId ? record : photo
              ));
            })
            .catch(async () => {
              URL.revokeObjectURL(objectUrls[index]);
              const cleanup = await deleteStorageFile(storagePath);
              setPhotos((previous) => previous.filter((photo) => photo.id !== temporaryId));
              if (!cleanup.deleted) {
                await reportCompensationFailure(cleanup.errorCode);
                setError(
                  `사진 정보 저장에 실패했고 업로드 원본 정리도 실패했습니다. 관리자에게 알려주세요. (${cleanup.errorCode})`
                );
                return;
              }
              setError("사진 정보 저장에 실패해 업로드 원본을 정리했습니다. 다시 업로드해 주세요.");
            });
        });
      } catch (uploadError) {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        setUploadingCount((count) => count - fileArray.length);
        const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
        setError(`사진 업로드에 실패했습니다. (${message})`);
      }
    })();
  }

  async function handleDeletePhoto(photo: PhotoRecord, isRetry = false) {
    if (!isRetry && !confirm(`"${photo.fileName}" 사진을 삭제할까요?`)) return;
    try {
      await deleteReservationPhoto(
        photo.id,
        photo.storagePath,
        photo.fileName,
        reservationId,
        patientId,
        currentUser,
        reservationDocId
      );
      setPhotos((previous) => previous.filter((item) => item.id !== photo.id));
    } catch (deleteError) {
      await load();
      setError(deleteError instanceof Error ? deleteError.message : "사진 삭제에 실패했습니다.");
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-800">
            사진
            {!photosLoading && (
              <span className="ml-1.5 text-xs font-normal text-gray-400">{photos.length}장</span>
            )}
            {uploadingCount > 0 && (
              <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-normal text-blue-500">
                업로드 중 {uploadingCount}장
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="rounded-lg border border-[#dfe3e8] bg-white px-3 py-1.5 text-xs text-gray-700 transition hover:-translate-y-0.5 hover:bg-gray-50 active:scale-95"
          >
            + 사진 추가
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => handlePhotoFiles(event.target.files)}
          />
        </div>

        {photosLoading ? (
          <div className="rounded-xl border border-dashed border-[#dfe3e8] p-4 text-center text-xs text-gray-400">
            불러오는 중...
          </div>
        ) : photos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#dfe3e8] p-4 text-center text-xs text-gray-400">
            등록된 사진이 없습니다
          </div>
        ) : (
          <ul className="divide-y divide-[#f0f0f0] rounded-xl border border-[#edf0f3] bg-white">
            {photos.map((photo) => (
              <li key={photo.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-gray-800">{photo.fileName}</div>
                  <div className="mt-0.5 flex gap-2 text-xs text-gray-400">
                    <span>{formatFileSize(photo.fileSize)}</span>
                    {formatDate(photo.uploadedAt) && <span>{formatDate(photo.uploadedAt)}</span>}
                  </div>
                  {photo.storageDeleteStatus === "failed" && (
                    <div className="mt-0.5 text-xs font-medium text-amber-600">
                      원본 삭제 실패 — 재시도해 주세요
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => openViewer(photo)}
                  disabled={viewerLoading}
                  className="shrink-0 rounded-lg border border-[#dfe3e8] px-2.5 py-1 text-xs text-gray-600 transition hover:bg-gray-50 active:scale-95 disabled:opacity-50"
                >
                  보기
                </button>
                {photo.storageDeleteStatus === "failed" ? (
                  <button
                    type="button"
                    onClick={() => handleDeletePhoto(photo, true)}
                    className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-700 transition hover:bg-amber-100 active:scale-95"
                  >
                    재시도
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDeletePhoto(photo)}
                    className="shrink-0 rounded-lg border border-red-100 px-2.5 py-1 text-xs text-red-500 transition hover:bg-red-50 active:scale-95"
                  >
                    삭제
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {viewingUrl && (
        <>
          <div className="fixed inset-0 z-[1050] bg-black/70" onClick={closeViewer} />
          <div className="fixed inset-0 z-[1051] flex items-center justify-center p-4">
            <div className="relative max-h-full max-w-3xl">
              <button
                type="button"
                onClick={closeViewer}
                className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-xl shadow-lg"
              >
                ×
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={viewingUrl}
                alt="파일 보기"
                className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
