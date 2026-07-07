"use client";

import { useEffect, useRef, useState } from "react";
import type { StaffUser } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import {
  deleteReservationPhoto,
  getReservationPhotos,
  uploadReservationPhoto,
  type PhotoRecord,
} from "@/lib/reservationFiles";
import { compressImage } from "@/lib/imageCompress";

type Props = {
  reservationDocId: string;
  reservationId: string;
  patientId: string;
  currentUser: StaffUser;
};

export function FilesTab(props: Props) {
  const { reservationDocId, reservationId, patientId, currentUser } = props;
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    setLoading(true);
    try {
      setPhotos(await getReservationPhotos(reservationDocId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationDocId]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    const invalid = selected.find((file) => file.size > 10 * 1024 * 1024 || !file.type.startsWith("image/"));
    if (invalid) {
      setError(`업로드 불가 파일: ${invalid.name} (이미지, 최대 10MB)`);
      return;
    }

    setUploading(true);
    setError("");
    if (inputRef.current) inputRef.current.value = "";

    try {
      for (const original of selected) {
        const file = await compressImage(original);
        await uploadReservationPhoto(
          reservationDocId,
          reservationId,
          patientId,
          file,
          currentUser
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진 업로드에 실패했습니다.");
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function view(photo: PhotoRecord) {
    try {
      if (!photo.storagePath) {
        window.open(photo.fileUrl, "_blank", "noopener,noreferrer");
        return;
      }
      const user = auth.currentUser;
      if (!user) throw new Error("로그인이 필요합니다.");
      const token = await user.getIdToken();
      const response = await fetch(`/api/proxy-image?path=${encodeURIComponent(photo.storagePath)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("사진을 불러오지 못했습니다.");
      const url = URL.createObjectURL(await response.blob());
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진을 불러오지 못했습니다.");
    }
  }

  async function remove(photo: PhotoRecord) {
    if (photo.storageDeleteStatus !== "failed" && !confirm(`"${photo.fileName}" 사진을 삭제할까요?`)) return;
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
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진 삭제에 실패했습니다.");
      await load();
    }
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">사진 {!loading && `${photos.length}장`}</div>
        <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50">
          {uploading ? "업로드 중..." : "+ 사진 추가"}
        </button>
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
      </div>

      {loading ? (
        <div className="rounded-xl border border-dashed p-4 text-center text-xs text-gray-400">불러오는 중...</div>
      ) : photos.length === 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-center text-xs text-gray-400">등록된 사진이 없습니다</div>
      ) : (
        <ul className="divide-y rounded-xl border bg-white">
          {photos.map((photo) => (
            <li key={photo.id} className="flex items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1 truncate text-sm">{photo.fileName}</div>
              {photo.storageDeleteStatus === "failed" && <span className="text-xs text-amber-600">삭제 실패</span>}
              <button type="button" onClick={() => void view(photo)} className="rounded border px-2 py-1 text-xs">보기</button>
              <button type="button" onClick={() => void remove(photo)} className="rounded border px-2 py-1 text-xs text-red-500">
                {photo.storageDeleteStatus === "failed" ? "재시도" : "삭제"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
