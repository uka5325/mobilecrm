"use client";

import { useEffect, useRef, useState } from "react";
import type { StaffUser } from "@/lib/auth";
import {
  deleteReservationChart,
  deleteReservationPhoto,
  getReservationCharts,
  getReservationPhotos,
  uploadPhotoToStorage,
  savePhotoRecord,
  uploadReservationChart,
  updateReservationChart,
  type ChartRecord,
  type PhotoRecord,
} from "@/lib/reservationFiles";
import { ChartCanvas } from "@/components/timeline/tabs/ChartCanvas";
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
  const [charts, setCharts] = useState<ChartRecord[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [chartsLoading, setChartsLoading] = useState(true);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [chartSaving, setChartSaving] = useState(false);

  // 상담차트 캔버스 모달
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [editingChart, setEditingChart] = useState<ChartRecord | null>(null);
  // 신규 차트 생성 시 업로드된 기반 이미지 URL (캔버스에 로드)
  const [baseImageUrl, setBaseImageUrl] = useState<string | undefined>(undefined);

  // 이미지/파일 뷰어
  const [viewingUrl, setViewingUrl] = useState<string | null>(null);

  // 오류 메시지
  const [error, setError] = useState("");

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const baseImageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationDocId]);

  async function load() {
    setPhotosLoading(true);
    setChartsLoading(true);
    try {
      const [p, c] = await Promise.all([
        getReservationPhotos(reservationDocId),
        getReservationCharts(reservationDocId),
      ]);
      setPhotos(p);
      setCharts(c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`파일 목록을 불러오지 못했습니다. (${msg})`);
    } finally {
      setPhotosLoading(false);
      setChartsLoading(false);
    }
  }

  // ─── 사진 업로드 ────────────────────────────────────────────────────────────

  async function handlePhotoFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    const fileArr = Array.from(files);
    // Reset input after extracting files — iOS Safari cancels the upload if reset too early
    setTimeout(() => { if (photoInputRef.current) photoInputRef.current.value = ""; }, 0);
    setUploadingCount((n) => n + fileArr.length);
    const objectUrls: string[] = [];

    // Run this batch independently — does not block the button
    (async () => {
      try {
        const compressed = await Promise.all(fileArr.map((f) => compressImage(f)));

        const storageResults = await Promise.all(
          compressed.map((f) => uploadPhotoToStorage(reservationDocId, f).then((r) => ({ f, ...r })))
        );

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
            fileSize: f.size,
            uploadedAt: null,
            uploadedBy: currentUser.displayName,
            uploadedByUid: currentUser.uid,
            isDeleted: false,
          };
        });
        setPhotos((prev) => [...optimisticItems, ...prev]);
        setUploadingCount((n) => n - fileArr.length);

        // Persist to Firestore in background
        storageResults.forEach(({ f, fileUrl, storagePath }, i) => {
          const tempId = optimisticItems[i].id;
          savePhotoRecord(reservationDocId, reservationId, patientId, f, storagePath, fileUrl, currentUser)
            .then((record) => {
              URL.revokeObjectURL(objectUrls[i]);
              setPhotos((prev) => prev.map((p) => (p.id === tempId ? record : p)));
            })
            .catch(() => {});
        });
      } catch (e) {
        objectUrls.forEach((u) => URL.revokeObjectURL(u));
        setUploadingCount((n) => n - fileArr.length);
        const msg = e instanceof Error ? e.message : String(e);
        setError(`사진 업로드에 실패했습니다. (${msg})`);
      }
    })();
  }

  async function handleDeletePhoto(photo: PhotoRecord) {
    if (!confirm(`"${photo.fileName}" 사진을 삭제할까요?`)) return;
    try {
      await deleteReservationPhoto(
        photo.id, photo.storagePath, photo.fileName,
        reservationId, patientId, currentUser
      );
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch {
      setError("사진 삭제에 실패했습니다.");
    }
  }

  // ─── 상담차트: 기반 이미지 업로드 → 캔버스 ──────────────────────────────────

  function openNewChart() {
    // 기반 이미지 없이 빈 캔버스로 바로 열기
    setEditingChart(null);
    setBaseImageUrl(undefined);
    setCanvasOpen(true);
  }

  async function handleBaseImageFile(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    // 로컬 Object URL로 캔버스에 바로 로드 (업로드는 저장 시 한 번만)
    const url = URL.createObjectURL(file);
    setEditingChart(null);
    setBaseImageUrl(url);
    setCanvasOpen(true);
    if (baseImageInputRef.current) baseImageInputRef.current.value = "";
  }

  function openEditChart(chart: ChartRecord) {
    setEditingChart(chart);
    setBaseImageUrl(chart.chartUrl);
    setCanvasOpen(true);
  }

  async function handleSaveChart(blob: Blob) {
    setChartSaving(true);
    setError("");
    try {
      if (editingChart) {
        const updated = await updateReservationChart(
          editingChart.id,
          editingChart.storagePath,
          reservationDocId,
          reservationId,
          patientId,
          editingChart.label,
          blob,
          currentUser
        );
        setCharts((prev) =>
          prev.map((c) => (c.id === updated.id ? { ...c, chartUrl: updated.chartUrl, storagePath: updated.storagePath } : c))
        );
      } else {
        const label = `차트 ${charts.length + 1}`;
        const newChart = await uploadReservationChart(
          reservationDocId, reservationId, patientId,
          blob, label, currentUser
        );
        setCharts((prev) => [newChart, ...prev]);
      }
      setCanvasOpen(false);
      setEditingChart(null);
      setBaseImageUrl(undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`차트 저장에 실패했습니다. (${msg})`);
    } finally {
      setChartSaving(false);
    }
  }

  async function handleDeleteChart(chart: ChartRecord) {
    if (!confirm(`"${chart.label}" 차트를 삭제할까요?`)) return;
    try {
      await deleteReservationChart(
        chart.id, chart.storagePath, chart.label,
        reservationId, patientId, currentUser
      );
      setCharts((prev) => prev.filter((c) => c.id !== chart.id));
    } catch {
      setError("차트 삭제에 실패했습니다.");
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
                </div>
                <button
                  type="button"
                  onClick={() => setViewingUrl(photo.fileUrl)}
                  className="shrink-0 rounded-lg border border-[#dfe3e8] px-2.5 py-1 text-xs text-gray-600 transition hover:bg-gray-50 active:scale-95"
                >
                  보기
                </button>
                <button
                  type="button"
                  onClick={() => handleDeletePhoto(photo)}
                  className="shrink-0 rounded-lg border border-red-100 px-2.5 py-1 text-xs text-red-500 transition hover:bg-red-50 active:scale-95"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 상담차트 섹션 ──────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-800">
            상담차트
            {!chartsLoading && (
              <span className="ml-1.5 text-xs font-normal text-gray-400">{charts.length}개</span>
            )}
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={openNewChart}
              className="rounded-lg border border-[#dfe3e8] bg-white px-3 py-1.5 text-xs text-gray-700 transition hover:-translate-y-0.5 hover:bg-gray-50 active:scale-95"
            >
              ✏️ 빈 차트
            </button>
            <button
              type="button"
              onClick={() => baseImageInputRef.current?.click()}
              className="rounded-lg border border-[#dfe3e8] bg-white px-3 py-1.5 text-xs text-gray-700 transition hover:-translate-y-0.5 hover:bg-gray-50 active:scale-95"
            >
              📎 파일로 생성
            </button>
            <input
              ref={baseImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleBaseImageFile(e.target.files)}
            />
          </div>
        </div>

        {chartsLoading ? (
          <div className="rounded-xl border border-dashed border-[#dfe3e8] p-4 text-center text-xs text-gray-400">
            불러오는 중...
          </div>
        ) : charts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#dfe3e8] p-4 text-center text-xs text-gray-400">
            등록된 차트가 없습니다
          </div>
        ) : (
          <ul className="divide-y divide-[#f0f0f0] rounded-xl border border-[#edf0f3] bg-white">
            {charts.map((chart) => (
              <li key={chart.id} className="flex items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-gray-800">{chart.label}</div>
                  {formatDate(chart.updatedAt || chart.createdAt) && (
                    <div className="mt-0.5 text-xs text-gray-400">
                      {formatDate(chart.updatedAt || chart.createdAt)}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setViewingUrl(chart.chartUrl)}
                  className="shrink-0 rounded-lg border border-[#dfe3e8] px-2.5 py-1 text-xs text-gray-600 transition hover:bg-gray-50 active:scale-95"
                >
                  보기
                </button>
                <button
                  type="button"
                  onClick={() => openEditChart(chart)}
                  className="shrink-0 rounded-lg border border-[#dfe3e8] px-2.5 py-1 text-xs text-gray-600 transition hover:bg-gray-50 active:scale-95"
                >
                  수정
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteChart(chart)}
                  className="shrink-0 rounded-lg border border-red-100 px-2.5 py-1 text-xs text-red-500 transition hover:bg-red-50 active:scale-95"
                >
                  삭제
                </button>
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
            onClick={() => setViewingUrl(null)}
          />
          <div className="fixed inset-0 z-[1051] flex items-center justify-center p-4">
            <div className="relative max-h-full max-w-3xl">
              <button
                type="button"
                onClick={() => setViewingUrl(null)}
                className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-xl shadow-lg"
              >
                ×
              </button>
              <img
                src={viewingUrl}
                alt="파일 보기"
                className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
              />
            </div>
          </div>
        </>
      )}

      {/* ── 차트 캔버스 모달 ───────────────────────────────────── */}
      <ChartCanvas
        open={canvasOpen}
        existingUrl={baseImageUrl}
        onSave={handleSaveChart}
        onClose={() => {
          if (!chartSaving) {
            setCanvasOpen(false);
            setEditingChart(null);
            setBaseImageUrl(undefined);
          }
        }}
        saving={chartSaving}
      />
    </div>
  );
}
