"use client";

import { type PointerEvent, useEffect, useRef, useState } from "react";
import { getBlob, ref } from "firebase/storage";
import { storage } from "@/lib/firebase";

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
  const drawRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef  = useRef<HTMLImageElement | null>(null);

  const [tool, setTool] = useState<Tool>("pen");
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Clear drawing layer every time a chart is opened
  useEffect(() => {
    if (!open) return;
    const c = drawRef.current;
    if (!c) return;
    if (!existingUrl) {
      c.width  = DEFAULT_W;
      c.height = DEFAULT_H;
    }
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
  }, [open, existingUrl]);

  // Sync canvas pixel dimensions to the img's natural size after it loads
  // so pen coordinates and save compositing are always pixel-accurate
  function onImgLoad() {
    const img = imgRef.current;
    const c   = drawRef.current;
    if (!img || !c) return;
    c.width  = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
  }

  // ─── Drawing ────────────────────────────────────────────────────────────────

  function getPos(e: PointerEvent<HTMLCanvasElement>) {
    const c = drawRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.width  / r.width),
      y: (e.clientY - r.top)  * (c.height / r.height),
    };
  }

  function startDraw(e: PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawRef.current?.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    lastPos.current = getPos(e);
  }

  function draw(e: PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!isDrawing) return;
    const c = drawRef.current;
    if (!c) return;
    const ctx  = c.getContext("2d")!;
    const pos  = getPos(e);
    const prev = lastPos.current ?? pos;

    // Eraser uses destination-out → removes drawn pixels, revealing img below
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = "#111827";
    ctx.lineWidth   = tool === "pen" ? 2.5 : 24;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
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
    const c = drawRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
  }

  // ─── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    const drawCanvas = drawRef.current;
    if (!drawCanvas) return;

    if (!existingUrl) {
      // Blank new chart — white background + strokes
      const out = document.createElement("canvas");
      out.width  = drawCanvas.width;
      out.height = drawCanvas.height;
      const ctx  = out.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(drawCanvas, 0, 0);
      out.toBlob(async (b) => { if (b) await onSave(b); }, "image/png");
      return;
    }

    // Composite: original image (via Firebase SDK) + drawing layer
    try {
      const match = existingUrl.match(/\/o\/([^?]+)/);
      const path  = match ? decodeURIComponent(match[1]) : existingUrl;

      // Try Firebase SDK first, fall back to direct fetch with the download token
      let blobSrc: string;
      try {
        const blob = await getBlob(ref(storage, path));
        blobSrc = URL.createObjectURL(blob);
      } catch {
        const res = await fetch(existingUrl);
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        blobSrc = URL.createObjectURL(await res.blob());
      }

      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const out = document.createElement("canvas");
          out.width  = img.naturalWidth;
          out.height = img.naturalHeight;
          const ctx  = out.getContext("2d")!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, out.width, out.height);
          ctx.drawImage(img, 0, 0);
          // Scale strokes to original resolution
          ctx.drawImage(drawCanvas, 0, 0, out.width, out.height);
          URL.revokeObjectURL(blobSrc);
          out.toBlob(async (b) => {
            if (b) { await onSave(b); resolve(); }
            else    reject(new Error("toBlob returned null"));
          }, "image/png");
        };
        img.onerror = () => { URL.revokeObjectURL(blobSrc); reject(new Error("이미지 로드 실패")); };
        img.src = blobSrc;
      });
    } catch (e) {
      onError?.(`저장에 실패했습니다. (${e instanceof Error ? e.message : String(e)})`);
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
              <button type="button" onClick={resetCanvas}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-50 active:scale-95">
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
          <div className="min-h-0 flex-1 overflow-auto bg-gray-100 p-2">
            <div className="relative mx-auto w-fit rounded border border-gray-200 bg-white shadow-sm" style={{ maxWidth: "min(700px, calc(100vw - 48px))" }}>
              {existingUrl ? (
                <>
                  {/* Background: plain <img> — always renders regardless of CORS */}
                  <img
                    ref={imgRef}
                    src={existingUrl}
                    alt=""
                    onLoad={onImgLoad}
                    draggable={false}
                    className="block"
                    style={{ width: "100%", height: "auto", userSelect: "none" }}
                  />
                  {/* Drawing layer: transparent canvas covering the img */}
                  <canvas
                    ref={drawRef}
                    className="absolute inset-0 touch-none"
                    style={{ width: "100%", height: "100%", cursor: tool === "pen" ? "crosshair" : "cell" }}
                    onPointerDown={startDraw}
                    onPointerMove={draw}
                    onPointerUp={endDraw}
                    onPointerCancel={endDraw}
                    onPointerLeave={endDraw}
                  />
                </>
              ) : (
                <canvas
                  ref={drawRef}
                  width={DEFAULT_W}
                  height={DEFAULT_H}
                  className="block touch-none"
                  style={{ maxWidth: "100%", height: "auto", cursor: tool === "pen" ? "crosshair" : "cell" }}
                  onPointerDown={startDraw}
                  onPointerMove={draw}
                  onPointerUp={endDraw}
                  onPointerCancel={endDraw}
                  onPointerLeave={endDraw}
                />
              )}
            </div>
          </div>

          {/* 저장 버튼 */}
          <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3">
            <button type="button" onClick={onClose} disabled={saving}
              className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-600 transition hover:bg-gray-50 active:scale-95 disabled:opacity-40">
              취소
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="rounded-xl bg-black px-5 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
