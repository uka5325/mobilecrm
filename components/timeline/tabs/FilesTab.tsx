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
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function FilesTab({ reservationDocId, reservationId, patientId, currentUser }: Props) {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [uploadingCount, setUploadingCount] = useState(0);

  // 이미지/파일 뷰어 — storagePath가 있으면 인증된 /api/proxy-image로 blob을 받아
  // object URL로 표시(장기 유효 다운로드 토큰을 <img src>에 직접 노출하지 않음).
  // objectUrl이 세팅돼 있으면 닫을 때 revoke 대상.
  const [viewingUrl, setViewingUrl] = useState<string | null>(null);
  const [viewingObjectUrl, setViewingObjectUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);

  // 오류 메시지
  const [error, setError] = useState("");

  const photoInputRef = useRef<HTMLInputElement | null>(null);

  async function openViewer(photo: PhotoRecord) {
    if (!photo.storagePath) {
      // 레거시 레코드(storagePath 없음) — fileUrl 폴백만 가능.
      setViewingUrl(photo.fileUrl);
      return;
    }
    setViewerLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error("로그인 정보를 확인할 수 없습니다.");
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/proxy-image?path=${encodeURIComponent(photo.storagePath)}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`proxy-image ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      setViewingObjectUrl(objectUrl);
      setViewingUrl(objectUrl);
    } catch {
      // storagePath가 있는 (신규) 레코드는 raw URL로 조용히 폴백하지 않는다 — 사용자에게 오류를 표시.
      // (레거시 fileUrl 폴백은 storagePath가 없을 때만 위에서 허용)
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationDocId]);

  async function load() {
    setPhotosLoading(true);
    try {
      const p = await getReservationPhotos(reservationDocId);
      setPhotos(p);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`파일 목록을 불러오지 못했습니다. (${msg})`);
    } finally {
      setPhotosLoading(false);
    }
  }

  // ─── 사진 업로드 ────────────────────────────────────────────────────────────

  async function handlePhotoFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    const fileArr = Array.from(files);

    // 파일 크기 및 타입 검증 (업로드 전)
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "image/gif"];
    const invalidFiles = fileArr.filter((f) => f.size > MAX_FILE_SIZE || !ALLOWED_TYPES.includes(f.type));
    if (invalidFiles.length > 0) {
      setError(`업로드 불가 파일이 있습니다: ${invalidFiles.map((f) => f.name).join(", ")}\n(최대 10MB, 이미지 파일만 허용)`);
      return;
    }

    // Reset input after extracting files — iOS Safari cancels the upload if reset too early
    setTimeout(() => { if (photoInputRef.current) photoInputRef.current.value = ""; }, 0);
    setUploadingCount((n) => n + fileArr.length);
    const objectUrls: string[] = [];

    // Run this batch independently — does not block the button
    (async () => {
      try {
        // 최대 5개씩 청크 단위로 업로드 (동시 업로드 폭탄 방지)
        const MAX_CONCURRENT = 5;
        const allCompressed: File[] = [];
        for (let i = 0; i < fileArr.length; i += MAX_CONCURRENT) {
          const chunk = fileArr.slice(i, i + MAX_CONCURRENT);
          const chunkCompressed = await Promise.all(chunk.map((f) => compressImage(f)));
          allCompressed.push(...chunkCompressed);
        }
        const compressed = allCompressed;

        const storageResults: { f: File; storagePath: string; contentType: string }[] = [];
        for (let i = 0; i < compressed.length; i += MAX_CONCURRENT) {
          const chunk = compressed.slice(i, i + MAX_CONCURRENT);
          const chunkResults = await Promise.all(
            chunk.map((f) => uploadPhotoToStorage(reservationDocId, f).then((r) => ({ f, ...r })))
          );
          storageResults.push(...chunkResults);
        }

        // Show optimistic items immediately
        const optimisticItems: PhotoRecord[] = storageResults.map(({ f, storagePath }) => {
          const oUrl = URL.createObjectURL(f);
          objectUrls.push(oUrl);
          return {
            id: `tmp_${Math.random().toString(36).slice(2)}`,
            reservationDocId,
            reservationId,
            patientId,
            fileName: f.name,
            fileUrl: oUrl,
            storagePath,
            contentType: f.type,
            fileSize: f.size,
            uploadedAt: null,
            uploadedBy: currentUser.displayName,
            uploadedByUid: currentUser.uid,
            isDeleted: false,
          };
        });
        setPhotos((prev) => [...optimisticItems, ...prev]);
        setUploadingCount((n) => n - fileArr.length);

        // Persist to Firestore — on failure, clean up the Storage object and remove the optimistic item
        storageResults.forEach(({ f, storagePath }, i) => {
          const tempId = optimisticItems[i].id;
          savePhotoRecord(reservationDocId, reservationId, patientId, f, storagePath, currentUser)
            .then((record) => {
              URL.revokeObjectURL(objectUrls[i]);
              setPhotos((prev) => prev.map((p) => (p.id === tempId ? record : p)));
            })
            .catch(async () => {
              URL.revokeObjectURL(objectUrls[i]);
              await deleteStorageFile(storagePath);
              setPhotos((prev) => prev.filter((p) => p.id !== tempId));
              setError("사진 정보 저장에 실패했습니다. 다시 업로드해 주세요.");
            });
        });
      } catch (e) {
        objectUrls.forEach((u) => URL.revokeObjectURL(u));
        setUploadingCount((n) => n - fileArr.length);
        const msg = e instanceof Error ? e.message : String(e);
        setError(`사진 업로드에 실패했습니다. (${msg})`);
      }
    })();
  }

  // isRetry: 이미 실패(storageDeleteStatus=failed)한 항목을 재시도할 때는 확인창을 다시 띄우지 않는다.
  async function handleDeletePhoto(photo: PhotoRecord, isRetry = false) {
    if (!isRetry && !confirm(`"${photo.fileName}" 사진을 삭제할까요?`)) return;
    try {
      await deleteReservationPhoto(
        photo.id, photo.storagePath, photo.fileName,
        reservationId, patientId, currentUser, reservationDocId
      );
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (e) {
      // Storage 원본 삭제 실패 — isDeleted는 false로 유지되어 목록에 계속 표시된다(재시도 가능).
      // 최신 상태(storageDeleteStatus=failed 등)를 다시 불러와 재시도 버튼이 보이게 한다.
      await load();
      setError(e instanceof Error ? e.message : "사진 삭제에 실패했습니다.");
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* ── 사진 섹션 ─────────────────────────────────────────── */}
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
            onChange={(e) => handlePhotoFiles(e.target.files)}
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

      {/* ── 이미지 뷰어 모달 ───────────────────────────────────── */}
      {viewingUrl && (
        <>
          <div
            className="fixed inset-0 z-[1050] bg-black/70"
            onClick={closeViewer}
          />
          <div className="fixed inset-0 z-[1051] flex items-center justify-center p-4">
            <div className="relative max-h-full max-w-3xl">
              <button
                type="button"
                onClick={closeViewer}
                className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-xl shadow-lg"
              >
                ×
              </button>
              {/* 인증 proxy가 만든 Blob object URL(또는 레거시 fileUrl)을 그대로 표시한다.
                  next/image는 외부 로더/최적화 대상이 아니고 blob: URL을 지원하지 않으므로 <img>가 필요하다. */}
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
