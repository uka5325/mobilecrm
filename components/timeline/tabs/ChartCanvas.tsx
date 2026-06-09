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

export function ChartCanvas({ open, existingUrl, onSave, onClose, saving, onError }: Props) {
  // drawRef: transparent canvas for pen/eraser strokes only — never loaded with external images
  const drawRef = useRef<HTMLCanvasElement | null>(null);
  // imgRef: displays the existing chart as a plain <img> (same as viewer — always works)
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [tool, setTool] = useState<Tool>("pen");
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  // natural dimensions of the existing image, needed for compositing at save time
  const imgSizeRef = useRef<{ w: number; h: number } | null>(null);

  // Reset drawing canvas whenever chart opens
  useEffect(() => {
    if (!open) return;
    const canvas = drawRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [open, existingUrl]);

  // Track natural image size once the background img loads
  function handleImgLoad() {
    const img = imgRef.current;
    if (!img) return;
    imgSizeRef.current = { w: img.naturalWidth, h: img.naturalHeight };
  }

  // ─── Drawing ────────────────────────────────────────────────────────────────

  function getPos(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = drawRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function startDraw(e: PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = drawRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    lastPos.current = getPos(e);
  }

  function draw(e: PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = drawRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e);
    const prev = lastPos.current ?? pos;

    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = tool === "pen" ? "#111827" : "rgba(0,0,0,1)";
    ctx.lineWidth = tool === "pen" ? 2.5 : 24;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    lastPos.current = pos;
  }

  function endDraw(e: PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    setIsDrawing(false);
    lastPos.current = null;
  }

  function resetCanvas() {
    const canvas = drawRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ─── Save: composite background image + drawing layer ───────────────────────

  async function handleSave() {
    const drawCanvas = drawRef.current;
    if (!drawCanvas) return;

    try {
      if (!existingUrl) {
        // New blank chart — just save the drawing on a white background
        const out = document.createElement("canvas");
        out.width = drawCanvas.width;
        out.height = drawCanvas.height;
        const ctx = out.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(drawCanvas, 0, 0);
        out.toBlob(async (blob) => { if (blob) await onSave(blob); }, "image/png");
        return;
      }

      // Existing chart — download original via Firebase SDK (untainted), overlay strokes
      const match = existingUrl.match(/\/o\/([^?]+)/);
      const path = match ? decodeURIComponent(match[1]) : existingUrl;
      const blob = await getBlob(ref(storage, path));
      const src = URL.createObjectURL(blob);

      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const out = document.createElement("canvas");
          out.width = img.naturalWidth;
          out.height = img.naturalHeight;
          const ctx = out.getContext("2d")!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, out.width, out.height);
          ctx.drawImage(img, 0, 0);
          // Scale drawing canvas strokes to match original image dimensions
          ctx.drawImage(drawCanvas, 0, 0, out.width, out.height);
          URL.revokeObjectURL(src);
          out.toBlob(async (b) => {
            if (b) { await onSave(b); resolve(); }
            else reject(new Error("toBlob failed"));
          }, "image/png");
        };
        img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("img load failed")); };
        img.src = src;
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
            {/* Container: img (background) + canvas (drawing layer) overlaid */}
            <div ref={containerRef} className="relative mx-auto w-fit rounded border border-gray-200 bg-white shadow-sm" style={{ maxWidth: "100%" }}>
              {existingUrl && (
                <img
                  ref={imgRef}
                  src={existingUrl}
                  alt="차트 배경"
                  onLoad={handleImgLoad}
                  className="block"
                  style={{ maxWidth: "min(700px, calc(100vw - 48px))", height: "auto" }}
                  draggable={false}
                />
              )}
              <canvas
                ref={drawRef}
                width={700}
                height={existingUrl ? undefined : 900}
                className="touch-none"
                style={
                  existingUrl
                    ? { position: "absolute", inset: 0, width: "100%", height: "100%", cursor: tool === "pen" ? "crosshair" : "cell" }
                    : { display: "block", maxWidth: "100%", height: "auto", cursor: tool === "pen" ? "crosshair" : "cell" }
                }
                onPointerDown={startDraw}
                onPointerMove={draw}
                onPointerUp={endDraw}
                onPointerCancel={endDraw}
                onPointerLeave={endDraw}
              />
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
