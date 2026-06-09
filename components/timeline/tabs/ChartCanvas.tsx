"use client";

import { type PointerEvent, useEffect, useRef, useState } from "react";

type Tool = "pen" | "eraser";

type Props = {
  open: boolean;
  existingUrl?: string; // 수정 시 기존 차트 URL
  onSave: (blob: Blob) => Promise<void>;
  onClose: () => void;
  saving: boolean;
};

export function ChartCanvas({ open, existingUrl, onSave, onClose, saving }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // 기존 이미지 or 빈 흰 배경 초기화
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (existingUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // 이미지 비율에 맞게 캔버스 크기 조정
        const maxW = Math.min(window.innerWidth - 48, 700);
        const scale = Math.min(maxW / img.naturalWidth, 900 / img.naturalHeight, 1);
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.onerror = () => {
        // 이미지 로드 실패해도 빈 캔버스 유지
      };
      img.src = existingUrl;
    }
  }, [open, existingUrl]);

  // 도구 변경 시 커서 스타일 업데이트
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.cursor = tool === "pen" ? "crosshair" : "cell";
  }, [tool]);

  function getPos(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    const pos = getPos(e);
    lastPos.current = pos;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e: PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pos = getPos(e);
    const prev = lastPos.current ?? pos;

    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = tool === "pen" ? "#111827" : "#ffffff";
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 기존 이미지가 있으면 다시 그려서 필기만 제거
    if (existingUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = existingUrl;
    }
  }

  async function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(
      async (blob: Blob | null) => {
        if (!blob) return;
        await onSave(blob);
      },
      "image/png"
    );
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
              {/* 도구 선택 */}
              <button
                type="button"
                onClick={() => setTool("pen")}
                title="펜슬"
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition active:scale-95 ${
                  tool === "pen"
                    ? "border-[#111827] bg-[#111827] text-white"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                ✏️ 펜슬
              </button>
              <button
                type="button"
                onClick={() => setTool("eraser")}
                title="지우개"
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition active:scale-95 ${
                  tool === "eraser"
                    ? "border-[#111827] bg-[#111827] text-white"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                ⬜ 지우개
              </button>
              <button
                type="button"
                onClick={resetCanvas}
                title="초기화"
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-50 active:scale-95"
              >
                ↩ 초기화
              </button>
              <div className="mx-1 h-5 w-px bg-gray-200" />
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="text-xl leading-none text-gray-400 hover:text-gray-600 disabled:opacity-40"
              >
                ×
              </button>
            </div>
          </div>

          {/* 캔버스 영역 */}
          <div className="min-h-0 flex-1 overflow-auto bg-gray-100 p-2">
            <canvas
              ref={canvasRef}
              width={700}
              height={900}
              className="mx-auto block touch-none rounded border border-gray-200 bg-white shadow-sm"
              style={{ maxWidth: "100%", height: "auto" }}
              onPointerDown={startDraw}
              onPointerMove={draw}
              onPointerUp={endDraw}
              onPointerCancel={endDraw}
              onPointerLeave={endDraw}
            />
          </div>

          {/* 저장 버튼 */}
          <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-600 transition hover:bg-gray-50 active:scale-95 disabled:opacity-40"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-black px-5 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
