"use client";

import { useRef, useState } from "react";
import type { StaffUser } from "@/lib/auth";
import {
  deleteReservation,
  getPatientFullHistoryPage,
  invalidatePatientFullHistoryCache,
  type ReservationRecord,
} from "@/lib/reservations";

const HISTORY_PAGE_SIZE = 10;

// 환자 전체 예약 이력 모달: 라이브 윈도우와 무관한 온디맨드 페이지네이션 조회 + 행 삭제 + 편집 타깃.
export function usePatientHistoryModal({ currentUser }: { currentUser: StaffUser | null }) {
  const [historyPatientId, setHistoryPatientId] = useState<string | null>(null);
  const [historyPatientName, setHistoryPatientName] = useState("");
  const [historyList, setHistoryList] = useState<ReservationRecord[]>([]);
  const [historyCapped, setHistoryCapped] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyEditTarget, setHistoryEditTarget] = useState<ReservationRecord | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyCursors, setHistoryCursors] = useState<(string | null)[]>([null]);
  const [historyHasNext, setHistoryHasNext] = useState(false);
  const historySeqRef = useRef(0);

  async function handleHistoryDelete(r: ReservationRecord) {
    if (!currentUser) return;
    if (!confirm(`${r.reservationDate} 예약을 삭제할까요?`)) return;
    const result = await deleteReservation(r.id, r.reservationId, currentUser);
    if (result.success) {
      setHistoryList((prev) => prev.filter((x) => x.id !== r.id));
      if (historyPatientId) {
        invalidatePatientFullHistoryCache(historyPatientId);
      }
    } else {
      alert(result.message || "삭제 실패");
    }
  }

  async function openPatientHistory(patientId: string, name: string, page = 1, cursors: (string | null)[] = [null]) {
    const seq = ++historySeqRef.current;
    setHistoryPatientId(patientId);
    setHistoryPatientName(name);
    setHistoryError("");
    setHistoryPage(page);

    setHistoryList([]);
    setHistoryCapped(false);
    setHistoryHasNext(false);
    setHistoryLoading(true);
    try {
      const result = await getPatientFullHistoryPage(patientId, {
        cursor: cursors[page - 1] || null,
        limit: HISTORY_PAGE_SIZE,
      });
      if (seq !== historySeqRef.current) return;
      setHistoryList(result.reservations);
      setHistoryCapped(result.capped);
      setHistoryHasNext(result.hasMore);
      setHistoryCursors((prev) => {
        const next = page === 1 ? [null] : [...prev];
        if (result.nextCursor) next[page] = result.nextCursor;
        return next;
      });
    } catch (e) {
      if (seq !== historySeqRef.current) return;
      setHistoryError(e instanceof Error ? e.message : "이력 조회 중 오류가 발생했습니다.");
    } finally {
      if (seq === historySeqRef.current) setHistoryLoading(false);
    }
  }

  function goHistoryPage(nextPage: number) {
    if (!historyPatientId || nextPage < 1) return;
    void openPatientHistory(historyPatientId, historyPatientName, nextPage, historyCursors);
  }

  function closeHistory() {
    setHistoryPatientId(null);
  }

  // 이력 모달에서 예약을 편집(DetailDrawer)한 뒤: 캐시 무효화 + 현재 페이지 재조회.
  function refreshHistoryAfterEdit() {
    if (!historyPatientId) return;
    invalidatePatientFullHistoryCache(historyPatientId);
    void openPatientHistory(historyPatientId, historyPatientName, historyPage, historyCursors);
  }

  return {
    historyPatientId,
    historyPatientName,
    historyList,
    historyCapped,
    historyLoading,
    historyError,
    historyEditTarget,
    setHistoryEditTarget,
    historyPage,
    historyHasNext,
    openPatientHistory,
    goHistoryPage,
    handleHistoryDelete,
    closeHistory,
    refreshHistoryAfterEdit,
  };
}
