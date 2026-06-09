"use client";

import { type PointerEvent, useEffect, useRef, useState } from "react";

type Tool = "pen" | "eraser";

type Props = {
  open: boolean;
  existingUrl?: string;
  onSave: (blob: Blob) => Promise<void>;
  onClose: () => void;
  saving: boolean;
  onError?: (msg: string) => void;
};

const DEFAULT_W = 700;
const DEFAULT_H = 900;

export function ChartCanvas({ open, existingUrl, onSave, onClose, saving, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [isDrawing, setIsDrawing] = useState(false);
  const [loading, setLoading] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!existingUrl) {
      canvas.width  = DEFAULT_W;
      canvas.height = DEFAULT_H;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }

    setLoading(true);

    (async () => {
      // Fetch via same-origin proxy → canvas stays untainted → toBlob works
      let src = existingUrl;
      let isBlobUrl = false;

      try {
        const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(existingUrl)}`);
        if (res.ok) {
          src = URL.createObjectURL(await res.blob());
          isBlobUrl = true;
        }
      } catch {
        // fallback: direct URL — canvas may be tainted, save might fail
      }

      const img = new Image();
      img.onload = () => {
        const c = canvasRef.current;
        if (!c) return;

        // Size canvas to fit the viewport, maintaining aspect ratio
        const maxW  = Math.min(window.innerWidth - 48, DEFAULT_W);
        const scale = Math.min(maxW / img.naturalWidth, (window.innerHeight * 0.8) / img.naturalHeight, 1);
        c.width  = Math.round(img.naturalWidth  * scale);
        c.height = Math.round(img.naturalHeight * scale);

        // Fresh context required after dimension change
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);

        if (isBlobUrl) URL.revokeObjectURL(src);
        setLoading(false);
      };
      img.onerror = () => {
        if (isBlobUrl) URL.revokeObjectURL(src);
        setLoading(false);
        onError?.("차트 이미지를 불러오지 못했습니다.");
      };
      img.src = src;
    })();
  }, [open, existingUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Drawing ────────────────────────────────────────────────────────────────

  function getPos(e: PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.width  / r.width),
      y: (e.clientY - r.top)  * (c.height / r.height),
    };
  }

  function startDraw(e: PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    lastPos.current = getPos(e);
  }

  function draw(e: PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!isDrawing) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx  = c.getContext("2d")!;
    const pos  = getPos(e);
    const prev = lastPos.current ?? pos;

    ctx.lineCap  = "round";
    ctx.lineJoin = "round";

    if (tool === "eraser") {
      // White paint — erases both pen strokes AND original image content
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth   = 24;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "#111827";
      ctx.lineWidth   = 2.5;
    }

    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(pos.x,  pos.y);
    ctx.stroke();

    lastPos.current = pos;
  }

  function endDraw(e: PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    setIsDrawing(false);
    lastPos.current = null;
  }

  function resetCanvas() {
    const c = canvasRef.current;
    if (!c) return;
    // Re-trigger the load effect by dispatching a synthetic re-init
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    if (!existingUrl) return;

    setLoading(true);
    (async () => {
      let src = existingUrl;
      let isBlobUrl = false;
      try {
        const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(existingUrl)}`);
        if (res.ok) { src = URL.createObjectURL(await res.blob()); isBlobUrl = true; }
      } catch { /* fallback */ }

      const img = new Image();
      img.onload = () => {
        const c = canvasRef.current;
        if (!c) return;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        if (isBlobUrl) URL.revokeObjectURL(src);
        setLoading(false);
      };
      img.onerror = () => { if (isBlobUrl) URL.revokeObjectURL(src); setLoading(false); };
      img.src = src;
    })();
  }

  // ─── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    const c = canvasRef.current;
    if (!c) return;
    try {
      c.toBlob(async (blob) => {
        if (!blob) { onError?.("저장에 실패했습니다."); return; }
        await onSave(blob);
      }, "image/png");
    } catch {
      // Canvas is tainted — getBlob failed during load, can't export
      onError?.("저장할 수 없습니다. 로그인 상태를 확인하고 다시 시도하세요.");
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[1100] bg-black/60" onClick={saving ? undefined : onClose} />
      <div className="fixed inset-0 z-[1101] flex flex-col items-center justify-center p-3">
        <div className="flex w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl" style={{ maxHeight: "calc(100vh - 24px)" }}>

          {/* 헤더 */}
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
            <div className="text-sm font-semibold text-gray-800">
              {existingUrl ? "차트 수정" : "차트 생성"}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setTool("pen")}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition active:scale-95 ${tool === "pen" ? "border-[#111827] bg-[#111827] text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                ✏️ 펜슬
              </button>
              <button type="button" onClick={() => setTool("eraser")}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition active:scale-95 ${tool === "eraser" ? "border-[#111827] bg-[#111827] text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                ⬜ 지우개
              </button>
              <button type="button" onClick={resetCanvas} disabled={loading}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-50 active:scale-95 disabled:opacity-40">
                ↩ 초기화
              </button>
              <div className="mx-1 h-5 w-px bg-gray-200" />
              <button type="button" onClick={onClose} disabled={saving}
                className="text-xl leading-none text-gray-400 hover:text-gray-600 disabled:opacity-40">
                ×
              </button>
            </div>
          </div>

          {/* 캔버스 영역 */}
          <div className="relative min-h-0 flex-1 overflow-auto bg-gray-100 p-2">
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
                <span className="text-xs text-gray-500">불러오는 중...</span>
              </div>
            )}
            <canvas
              ref={canvasRef}
              width={DEFAULT_W}
              height={DEFAULT_H}
              className="mx-auto block touch-none rounded border border-gray-200 bg-white shadow-sm"
              style={{ maxWidth: "100%", height: "auto", cursor: tool === "pen" ? "crosshair" : "cell" }}
              onPointerDown={startDraw}
              onPointerMove={draw}
              onPointerUp={endDraw}
              onPointerCancel={endDraw}
              onPointerLeave={endDraw}
            />
          </div>

          {/* 저장 버튼 */}
          <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3">
            <button type="button" onClick={onClose} disabled={saving}
              className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-600 transition hover:bg-gray-50 active:scale-95 disabled:opacity-40">
              취소
            </button>
            <button type="button" onClick={handleSave} disabled={saving || loading}
              className="rounded-xl bg-black px-5 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
