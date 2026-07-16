"use client";

import { useState } from "react";
import { fetchReservationsForExport } from "@/lib/reservations";
import { getCardStatus } from "@/lib/timelineUtils";
import { getReservationBirthInfo } from "@/lib/reservationUtils";
import { todayString } from "@/lib/dateUtils";
import { buildCsvContent } from "@/lib/csv";
import { toDate } from "@/lib/dateUtils";

// 예약 목록 CSV 내보내기: 기간 선택 상태 + 서버 조회/CSV 생성/다운로드 트리거.
export function useReservationsCsvExport({ setPageError }: { setPageError: (msg: string) => void }) {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [dlStart, setDlStart] = useState(() => todayString().slice(0, 7) + "-01");
  const [dlEnd, setDlEnd] = useState(todayString);
  const [downloading, setDownloading] = useState(false);

  function toDateStr(value: unknown): string {
    const d = toDate(value);
    if (!d) return "";
    return (
      d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0") + " " +
      String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      // 서버에서 지정 기간 전체를 정확히 읽고, 메모는 배치로 묶어서 받는다(누락/과금 방지).
      const { reservations: rows, notesByDoc, capped } = await fetchReservationsForExport(dlStart, dlEnd, true);

      const header = [
        "예약일", "예약시간", "환자명", "생년월일", "성별", "연락처",
        "병원명", "예약유형", "상담부위", "담당자", "수술결정여부",
        "현재상태", "전체메모", "등록일", "최종수정일",
      ];

      const csvRows = rows.map((r) => {
        const birthInfo = getReservationBirthInfo(r);
        const notes = notesByDoc[r.id] || [];
        const allMemo = notes.map((n) => `[${n.createdBy || ""}] ${n.memoText}`).join(" | ");

        return [
          r.reservationDate || "",
          r.reservationTime || "",
          r.name || "",
          birthInfo.birthDisplay || "",
          birthInfo.gender || "",
          r.phone || "",
          r.hospital || "",
          r.appointmentType || "상담",
          r.consultArea || "",
          r.coordinators.join(", "),
          r.surgeryReserved ? "예" : "아니오",
          getCardStatus(r),
          allMemo,
          toDateStr(r.createdAt),
          toDateStr(r.updatedAt),
        ];
      });

      // formula injection 방어 + 안전한 quoting/BOM은 공통 유틸에서 처리.
      const csv = buildCsvContent([header, ...csvRows]);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `예약목록_${dlStart}_${dlEnd}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloadOpen(false);
      if (capped) setPageError("내보낼 데이터가 많아 최대치(5000건)까지만 포함되었습니다.");
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "CSV 내보내기 중 오류가 발생했습니다.");
    } finally {
      setDownloading(false);
    }
  }

  return {
    downloadOpen,
    setDownloadOpen,
    dlStart,
    setDlStart,
    dlEnd,
    setDlEnd,
    downloading,
    handleDownload,
  };
}
