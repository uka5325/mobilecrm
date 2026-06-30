"use client";

// ─────────────────────────────────────────────────────────────────────────────
// 전역 단일 예약 구독 (#3 비용 절감의 핵심)
//
// 배경: 스케줄·고객관리 페이지가 각자 subscribeAllReservations(onSnapshot)를 마운트하면
// 페이지를 오갈 때마다 최근 45일 예약 전량을 재읽기한다(Firestore 읽기 비용 급증).
// AppShell은 dynamic(ssr:false)로 라우트 전환에도 유지되므로, 그 안에 이 Provider를 1회만 두면
// 구독도 1회만 살아 있고 모든 페이지가 context로 공유한다 → 페이지 전환 시 재읽기 제거.
//
// 즉시표시 캐시는 RESERVATIONS_CACHE_KEY로 일원화(로그아웃 purge 출처는 lib/clientCache).
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
  subscribeAllReservations,
  fetchAllReservationsOnce,
  type DoctorOption,
  type ReservationRecord,
} from "@/lib/reservations";
import { RESERVATIONS_CACHE_KEY } from "@/lib/clientCache";

const CACHE_TTL = 5 * 60 * 1000; // 5분

type CacheEntry = { reservations: ReservationRecord[]; doctors: DoctorOption[]; cachedAt: number };

function readCache(): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(RESERVATIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed: CacheEntry = JSON.parse(raw);
    if (Date.now() - parsed.cachedAt > CACHE_TTL) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(reservations: ReservationRecord[], doctors: DoctorOption[]) {
  if (typeof window === "undefined") return;
  setTimeout(() => {
    try {
      localStorage.setItem(
        RESERVATIONS_CACHE_KEY,
        JSON.stringify({ reservations, doctors, cachedAt: Date.now() })
      );
    } catch {}
  }, 0);
}

type ReservationsContextValue = {
  reservations: ReservationRecord[];
  doctors: DoctorOption[];
  loading: boolean;
  refresh: () => Promise<void>;
};

type State = { reservations: ReservationRecord[]; doctors: DoctorOption[]; loading: boolean };

const ReservationsContext = createContext<ReservationsContextValue | null>(null);

export function ReservationsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => {
    const cached = readCache();
    const reservations = cached?.reservations ?? [];
    return { reservations, doctors: cached?.doctors ?? [], loading: reservations.length === 0 };
  });

  useEffect(() => {
    // 구독은 내부적으로 auth.onAuthStateChanged로 자체 게이팅 → 미인증/로그인 페이지에서 안전.
    const unsubscribe = subscribeAllReservations(
      (data) => {
        setState({ reservations: data.reservations, doctors: data.doctors, loading: false });
        writeCache(data.reservations, data.doctors);
      },
      (error) => {
        console.error("[ReservationsProvider] subscribe error:", (error as Error)?.message ?? "");
        setState((s) => ({ ...s, loading: false }));
      }
    );
    return () => unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchAllReservationsOnce();
      // 빈/실패 결과로 실시간 구독이 채운 목록을 덮어쓰지 않음.
      if (data.reservations.length > 0) {
        setState({ reservations: data.reservations, doctors: data.doctors, loading: false });
        writeCache(data.reservations, data.doctors);
      }
    } catch (e) {
      console.error("[ReservationsProvider] refresh error:", e);
    }
  }, []);

  const value = useMemo<ReservationsContextValue>(
    () => ({ ...state, refresh }),
    [state, refresh]
  );

  return <ReservationsContext.Provider value={value}>{children}</ReservationsContext.Provider>;
}

export function useReservationsContext(): ReservationsContextValue {
  const ctx = useContext(ReservationsContext);
  if (!ctx) {
    // Provider 밖(예: 로그인 페이지)에서 호출 시 안전한 빈 값. 실사용 경로는 항상 Provider 내부.
    return { reservations: [], doctors: [], loading: false, refresh: async () => {} };
  }
  return ctx;
}
