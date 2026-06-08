"use client";

import { useEffect, useState } from "react";
import { createReservationsBatch } from "@/lib/reservations";
import type { StaffUser } from "@/lib/auth";

type Props = {
  open: boolean;
  onClose: () => void;
  currentUser: StaffUser;
};

export function ImportDrawer({ open, onClose, currentUser }: Props) {
  const [importUrl, setImportUrl] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importResultMessage, setImportResultMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (open) {
      setImportUrl("");
      setImportResultMessage("");
      setErrorMessage("");
    }
  }, [open]);

  async function handleImportFromSheet() {
    if (!importUrl.trim()) {
      setErrorMessage("구글시트 URL을 입력하세요.");
      return;
    }

    setImportLoading(true);
    setErrorMessage("");
    setImportResultMessage("");

    try {
      const response = await fetch("/api/import-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim() }),
      });

      const result = await response.json();

      if (!result.success) {
        setErrorMessage(result.message || "구글시트 가져오기에 실패했습니다.");
        return;
      }

      const batchResult = await createReservationsBatch(result.payloads, currentUser);

      if (!batchResult.success) {
        setErrorMessage(
          batchResult.errors?.length
            ? batchResult.errors.join("\n")
            : "저장 가능한 예약 데이터가 없습니다."
        );
        return;
      }

      setImportResultMessage(
        `✅ ${batchResult.count}건 가져오기 완료${
          batchResult.errors?.length ? ` / 실패 ${batchResult.errors.length}건` : ""
        }`
      );
    } catch {
      setErrorMessage("외부 링크 가져오기 중 오류가 발생했습니다.");
    } finally {
      setImportLoading(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[998] bg-black/35" onClick={onClose} />

      <div className="fixed right-0 top-0 z-[999] flex h-screen w-[460px] max-w-full flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
        <div className="flex items-center justify-between border-b px-6 py-5">
          <div>
            <div className="text-xl font-bold">외부 링크 가져오기</div>
            <div className="mt-1 text-sm text-gray-500">
              구글시트 URL에서 예약 데이터를 가져옵니다
            </div>
          </div>
          <button onClick={onClose} className="text-2xl text-gray-400">×</button>
        </div>

        <div className="flex-1 space-y-5 overflow-auto p-6">
          <div className="rounded-2xl border p-4">
            <div className="mb-2 text-sm font-semibold">📊 구글시트에서 가져오기</div>

            <div className="mb-3 text-xs leading-6 text-gray-500">
              예약 데이터가 담긴 구글시트 URL을 입력하세요.
              <br />
              시트 공유 권한은 반드시{" "}
              <b>링크가 있는 모든 사용자 보기 가능</b>으로 설정되어야 합니다.
            </div>

            <input
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />

            <div className="mt-3 rounded-xl bg-gray-50 p-3 text-xs leading-6 text-gray-500">
              <div className="mb-1 font-medium text-gray-700">자동 인식 컬럼</div>
              <div>이름, 생년월일, 연락처, 국적, 상담부위, 예약날짜, 예약시간, 원장, 실장, 예약금</div>
            </div>

            <button
              onClick={handleImportFromSheet}
              disabled={importLoading}
              className="mt-4 w-full rounded-xl bg-black py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              {importLoading ? "가져오는 중..." : "시트에서 가져오기"}
            </button>
          </div>

          {errorMessage && (
            <div className="whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {errorMessage}
            </div>
          )}

          {importResultMessage && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {importResultMessage}
            </div>
          )}
        </div>

        <div className="border-t p-4">
          <button onClick={onClose} className="w-full rounded-xl border py-3 text-sm">
            닫기
          </button>
        </div>
      </div>
    </>
  );
}
