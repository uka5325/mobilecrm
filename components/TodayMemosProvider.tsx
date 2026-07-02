"use client";

// ─────────────────────────────────────────────────────────────────────────────
// 오늘의 전체 메모 전역 단일 구독
//
// 배경: 홈 화면이 예약과 마찬가지로 마운트마다(=홈 재진입마다) force=true로 메모를
// 다시 읽던 문제를 ReservationsProvider와 동일한 방식으로 해결한다. conferenceMemos는
// firestore.rules에서 read 전용으로 개방돼 있어(쓰기는 여전히 /api/settings 경유),
// 클라이언트 onSnapshot으로 진짜 실시간 구독이 가능하다. AppShell 안에 이 Provider를
// 1회만 두면 구독도 세션 중 1회만 attach되고, 이후로는 변경분만 push된다.
// ─────────────────────────────────────────────────────────────────────────────

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  subscribeConferenceMemos,
  getConferenceMemos,
  getCachedConferenceMemos,
  writeConferenceMemoCache,
  type ConferenceMemo,
} from "@/lib/settings";
import { todayString } from "@/lib/dateUtils";

type TodayMemosContextValue = {
  memos: ConferenceMemo[];
  loading: boolean;
  refresh: () => Promise<void>;
};

type State = { memos: ConferenceMemo[]; loading: boolean };

const TodayMemosContext = createContext<TodayMemosContextValue | null>(null);

export function TodayMemosProvider({ children }: { children: ReactNode }) {
  const today = todayString();

  const [state, setState] = useState<State>(() => {
    const cached = getCachedConferenceMemos(today);
    return { memos: cached ?? [], loading: cached === null };
  });

  useEffect(() => {
    // 구독은 내부적으로 auth.onAuthStateChanged로 자체 게이팅 → 미인증/로그인 페이지에서 안전.
    const unsubscribe = subscribeConferenceMemos(
      today,
      (memos) => {
        setState({ memos, loading: false });
        writeConferenceMemoCache(today, memos);
      },
      (error) => {
        console.error("[TodayMemosProvider] subscribe error:", (error as Error)?.message ?? "");
        setState((s) => ({ ...s, loading: false }));
      }
    );
    return () => unsubscribe();
  }, [today]);

  const refresh = useCallback(async () => {
    try {
      const memos = await getConferenceMemos(today, 50, true);
      setState({ memos, loading: false });
      writeConferenceMemoCache(today, memos);
    } catch (e) {
      console.error("[TodayMemosProvider] refresh error:", e);
    }
  }, [today]);

  const value = useMemo<TodayMemosContextValue>(
    () => ({ ...state, refresh }),
    [state, refresh]
  );

  return <TodayMemosContext.Provider value={value}>{children}</TodayMemosContext.Provider>;
}

export function useTodayMemosContext(): TodayMemosContextValue {
  const ctx = useContext(TodayMemosContext);
  if (!ctx) {
    // Provider 밖(예: 로그인 페이지)에서 호출 시 안전한 빈 값. 실사용 경로는 항상 Provider 내부.
    return { memos: [], loading: false, refresh: async () => {} };
  }
  return ctx;
}
