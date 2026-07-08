"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  collection,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCurrentUserContext } from "@/components/CurrentUserProvider";
import {
  getPatientSummaryCache,
  invalidatePatientSummaryCache,
  setPatientSummaryCache,
} from "@/lib/patientSummaryClientCache";
import { listPatientsSummary, type PatientRecord } from "@/lib/reservations";

const SUMMARY_LIMIT = 30;

function text(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function mapPatientDocument(doc: QueryDocumentSnapshot<DocumentData>): PatientRecord {
  const data = doc.data() as Record<string, unknown>;
  return {
    id: doc.id,
    patientId: text(data.patientId) || doc.id,
    name: text(data.name),
    birth: text(data.birth),
    birthInput: text(data.birthInput),
    gender: text(data.gender),
    phone: text(data.phone),
    nationality: text(data.nationality),
    reservationCount: numberOrUndefined(data.reservationCount),
    depositCount: numberOrUndefined(data.depositCount),
    surgeryCostCount: numberOrUndefined(data.surgeryCostCount),
    invoiceCount: numberOrUndefined(data.invoiceCount),
    memoCount: numberOrUndefined(data.memoCount),
    totalDepositAmount: numberOrUndefined(data.totalDepositAmount),
    totalSurgeryCost: numberOrUndefined(data.totalSurgeryCost),
    lastReservationDate: text(data.lastReservationDate),
    lastReservationTime: text(data.lastReservationTime),
    hasMemo: data.hasMemo === true,
    hasInvoice: data.hasInvoice === true,
    reservationCountCapped: data.reservationCountCapped === true,
  };
}

function patientSummaryQuery() {
  return query(
    collection(db, "patients"),
    where("isDeleted", "==", false),
    orderBy("lastReservationDate", "desc"),
    limit(SUMMARY_LIMIT)
  );
}

type PatientSummaryContextValue = {
  patients: PatientRecord[];
  nextCursor: string | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  started: boolean;
  start: () => void;
  refresh: () => Promise<void>;
};

const PatientSummaryContext = createContext<PatientSummaryContextValue | null>(null);

export function PatientSummaryProvider({ children }: { children: ReactNode }) {
  const { currentUser, authReady } = useCurrentUserContext();
  const uid = currentUser?.uid || null;

  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const patientsRef = useRef<PatientRecord[]>([]);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const startedUidRef = useRef<string | null>(null);

  const applyPatients = useCallback((nextPatients: PatientRecord[], cursor: string | null, cacheUid: string) => {
    patientsRef.current = nextPatients;
    setPatients(nextPatients);
    setNextCursor(cursor);
    setPatientSummaryCache(cacheUid, nextPatients, cursor);
    setLoading(false);
    setRefreshing(false);
    setError(null);
  }, []);

  useEffect(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    startedUidRef.current = null;
    setStarted(false);
    setError(null);
    setRefreshing(false);

    if (!uid) {
      patientsRef.current = [];
      setPatients([]);
      setNextCursor(null);
      setLoading(false);
      return;
    }

    const cached = getPatientSummaryCache(uid);
    const cachedPatients = cached?.patients ?? [];
    patientsRef.current = cachedPatients;
    setPatients(cachedPatients);
    setNextCursor(cached?.nextCursor ?? null);
    setLoading(false);

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [uid]);

  const start = useCallback(() => {
    if (!authReady || !uid || startedUidRef.current === uid) return;

    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    startedUidRef.current = uid;
    setStarted(true);
    setError(null);

    const cached = getPatientSummaryCache(uid);
    if (cached) {
      patientsRef.current = cached.patients;
      setPatients(cached.patients);
      setNextCursor(cached.nextCursor);
      setLoading(false);
      setRefreshing(true);
    } else {
      patientsRef.current = [];
      setPatients([]);
      setNextCursor(null);
      setLoading(true);
      setRefreshing(false);
    }

    unsubscribeRef.current = onSnapshot(
      patientSummaryQuery(),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (snapshot.metadata.fromCache && snapshot.empty) {
          setLoading(false);
          setRefreshing(true);
          return;
        }

        const mapped = snapshot.docs.map(mapPatientDocument);
        const cursor = snapshot.docs.length === SUMMARY_LIMIT
          ? snapshot.docs[snapshot.docs.length - 1].id
          : null;

        patientsRef.current = mapped;
        setPatients(mapped);
        setNextCursor(cursor);
        setPatientSummaryCache(uid, mapped, cursor);
        setLoading(false);
        setRefreshing(snapshot.metadata.fromCache);
        setError(null);
      },
      (listenerError) => {
        console.error("[PatientSummaryProvider listener error]", listenerError.message);
        unsubscribeRef.current = null;
        startedUidRef.current = null;
        setStarted(false);

        // 배포 순서상 rules/index가 아직 반영되지 않았거나 일시적인 listener 오류가 나도
        // 고객관리 자체가 막히지 않도록 기존 서버 API를 1회 fallback으로 사용한다.
        void listPatientsSummary(SUMMARY_LIMIT)
          .then((result) => applyPatients(result.patients, result.nextCursor, uid))
          .catch((fallbackError) => {
            setLoading(false);
            setRefreshing(false);
            setError(fallbackError instanceof Error ? fallbackError.message : "고객 목록을 불러오지 못했습니다.");
          });
      }
    );
  }, [applyPatients, authReady, uid]);

  const refresh = useCallback(async () => {
    if (!authReady || !uid) return;
    if (startedUidRef.current !== uid) start();

    setRefreshing(patientsRef.current.length > 0);
    setLoading(patientsRef.current.length === 0);
    setError(null);

    try {
      const snapshot = await getDocsFromServer(patientSummaryQuery());
      const mapped = snapshot.docs.map(mapPatientDocument);
      const cursor = snapshot.docs.length === SUMMARY_LIMIT
        ? snapshot.docs[snapshot.docs.length - 1].id
        : null;
      applyPatients(mapped, cursor, uid);
    } catch (refreshError) {
      // 직접 조회가 실패하면 서버 API를 한 번 사용해 현재 화면을 유지한다.
      try {
        const result = await listPatientsSummary(SUMMARY_LIMIT);
        applyPatients(result.patients, result.nextCursor, uid);
      } catch (fallbackError) {
        setLoading(false);
        setRefreshing(false);
        setError(
          fallbackError instanceof Error
            ? fallbackError.message
            : refreshError instanceof Error
              ? refreshError.message
              : "고객 목록을 새로고침하지 못했습니다."
        );
      }
    }
  }, [applyPatients, authReady, start, uid]);

  useEffect(() => {
    if (uid) return;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    startedUidRef.current = null;
    patientsRef.current = [];
    setStarted(false);
    setPatients([]);
    setNextCursor(null);
    setLoading(false);
    setRefreshing(false);
    setError(null);
    invalidatePatientSummaryCache();
  }, [uid]);

  const value = useMemo<PatientSummaryContextValue>(() => ({
    patients,
    nextCursor,
    loading,
    refreshing,
    error,
    started,
    start,
    refresh,
  }), [patients, nextCursor, loading, refreshing, error, started, start, refresh]);

  return (
    <PatientSummaryContext.Provider value={value}>
      {children}
    </PatientSummaryContext.Provider>
  );
}

export function usePatientSummary(): PatientSummaryContextValue {
  const context = useContext(PatientSummaryContext);
  if (!context) {
    throw new Error("usePatientSummary must be used within PatientSummaryProvider");
  }
  return context;
}
