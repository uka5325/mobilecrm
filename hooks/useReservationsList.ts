"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePatientSummary } from "@/components/PatientSummaryProvider";
import { searchPatients, listPatientsSummary, type PatientRecord } from "@/lib/reservations";
import type { PatientGroup } from "@/components/reservations/ReservationsTable";

const PAGE_SIZE = 10;

// 예약관리 환자 목록 상태 머신: Provider 요약 동기화 + 검색(디바운스) + 커서 페이지네이션 + 그룹 페이지.
export function useReservationsList({ uid, authReady }: { uid: string | undefined; authReady: boolean }) {
  const {
    patients: summaryPatients,
    nextCursor: summaryNextCursor,
    loading: summaryLoading,
    refreshing: summaryRefreshing,
    error: summaryError,
    start: startPatientSummary,
    refresh: refreshPatientSummary,
  } = usePatientSummary();

  const [initialLoading, setInitialLoading] = useState(
    () => summaryLoading && summaryPatients.length === 0
  );
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const searchSeqRef = useRef(0);
  const extraPatientsRef = useRef<PatientRecord[]>([]);

  const [search, setSearch] = useState("");
  const [groupPage, setGroupPage] = useState(1);
  const [patients, setPatients] = useState<PatientRecord[]>(() => summaryPatients);
  const [patientsNextCursor, setPatientsNextCursor] = useState<string | null>(
    () => summaryNextCursor
  );
  const hasPatientsRef = useRef(patients.length > 0);

  useEffect(() => {
    hasPatientsRef.current = patients.length > 0;
  }, [patients.length]);

  const isSearchMode = useMemo(() => {
    const term = search.trim();
    if (!term) return false;
    const digitsOnly = /^[0-9]+$/.test(term);
    return digitsOnly ? term.length >= 4 : term.length >= 2;
  }, [search]);

  // 기본 목록은 Provider 값을 직접 사용한다. 페이지 로컬 patients는 검색 결과와
  // 더보기 갱신 트리거에만 사용해 mount 직후 빈 배열/로딩 화면을 거치지 않는다.
  const visiblePatients = useMemo(() => {
    if (isSearchMode) return patients;

    const byId = new Map<string, PatientRecord>();
    for (const patient of summaryPatients) byId.set(patient.patientId, patient);
    for (const patient of extraPatientsRef.current) {
      if (!byId.has(patient.patientId)) byId.set(patient.patientId, patient);
    }
    return [...byId.values()];
  }, [isSearchMode, patients, summaryPatients]);

  const patientGroups = useMemo<PatientGroup[]>(() => {
    // patients 요약을 단일 소스로 그룹 구성(예약 구독 없음 — 상세는 클릭 시 lazy-load).
    // NOTE: 검색 시에는 서버 검색 결과를, 기본 목록에서는 Provider 데이터를 직접 사용한다.
    const groups: PatientGroup[] = [];
    for (const p of visiblePatients) {
      if (!p.patientId) continue;
      groups.push({
        patientKey: p.patientId,
        patientId: p.patientId,
        name: p.name,
        birth: p.birth || "",
        birthInput: p.birthInput || p.birth || "",
        gender: p.gender || "",
        phone: p.phone || "",
        nationality: p.nationality || "",
        reservations: [],
        reservationCount: p.reservationCount,
        reservationCountCapped: p.reservationCountCapped,
        settlementCount: p.settlementCount,
        netSettlementAmount: p.netSettlementAmount,
        invoiceCount: p.invoiceCount,
        memoCount: p.memoCount,
        lastReservationDate: p.lastReservationDate || "",
      });
    }
    return groups.sort((a, b) =>
      (b.lastReservationDate || "").localeCompare(a.lastReservationDate || "")
    );
  }, [visiblePatients]);

  const tableLoading = isSearchMode
    ? initialLoading
    : summaryLoading && visiblePatients.length === 0;
  const tableRefreshing = isSearchMode ? refreshing : summaryRefreshing;
  const tableError = isSearchMode ? listError : summaryError;

  useEffect(() => { setGroupPage(1); }, [search]);

  // 기본 목록의 cursor/추가 페이지 상태만 동기화한다. 화면 데이터 자체는 Provider를 직접 표시한다.
  useEffect(() => {
    if (isSearchMode) return;

    const baseIds = new Set(summaryPatients.map((patient) => patient.patientId));
    extraPatientsRef.current = extraPatientsRef.current.filter(
      (patient) => !baseIds.has(patient.patientId)
    );
    if (extraPatientsRef.current.length === 0) {
      setPatientsNextCursor(summaryNextCursor);
    }
  }, [isSearchMode, summaryPatients, summaryNextCursor]);

  const reloadPatients = useCallback(({ force = false }: { force?: boolean } = {}) => {
    if (!uid) return;
    if (force) {
      void refreshPatientSummary();
      return;
    }
    startPatientSummary();
  }, [uid, refreshPatientSummary, startPatientSummary]);

  const reloadCurrent = useCallback(() => {
    const term = search.trim();
    const digitsOnly = term.length > 0 && /^[0-9]+$/.test(term);
    const longEnough = digitsOnly ? term.length >= 4 : term.length >= 2;

    if (term && longEnough) {
      if (hasPatientsRef.current) setRefreshing(true); else setInitialLoading(true);
      setListError(null);
      searchPatients(term)
        .then((list) => {
          setPatientsNextCursor(null);
          setPatients(list);
          setListError(null);
        })
        .catch((e) => { setListError(e instanceof Error ? e.message : "데이터를 불러오지 못했습니다."); })
        .finally(() => { setInitialLoading(false); setRefreshing(false); });
      return;
    }

    extraPatientsRef.current = [];
    setPatients(summaryPatients);
    setPatientsNextCursor(summaryNextCursor);
    void refreshPatientSummary();
  }, [search, summaryPatients, summaryNextCursor, refreshPatientSummary]);

  // 서버 커서로 다음 페이지를 이어붙인다("더보기") — 검색 중에는 사용하지 않음.
  const loadMorePatients = useCallback(async () => {
    if (!patientsNextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await listPatientsSummary(30, patientsNextCursor);
      const byId = new Map<string, PatientRecord>();
      for (const patient of extraPatientsRef.current) byId.set(patient.patientId, patient);
      for (const patient of r.patients) byId.set(patient.patientId, patient);
      const baseIds = new Set(summaryPatients.map((patient) => patient.patientId));
      extraPatientsRef.current = [...byId.values()].filter(
        (patient) => !baseIds.has(patient.patientId)
      );
      // visiblePatients가 재계산되도록 로컬 state도 같은 병합 결과로 갱신한다.
      setPatients([...summaryPatients, ...extraPatientsRef.current]);
      setPatientsNextCursor(r.nextCursor);
    } catch {
      /* 무시 — 다음 클릭 시 재시도 */
    } finally {
      setLoadingMore(false);
    }
  }, [patientsNextCursor, loadingMore, summaryPatients]);

  useEffect(() => {
    if (!authReady || !uid) return;
    const term = search.trim();
    const digitsOnly = term.length > 0 && /^[0-9]+$/.test(term);
    const longEnough = digitsOnly ? term.length >= 4 : term.length >= 2;
    if (!term || !longEnough) {
      searchSeqRef.current += 1;
      reloadPatients();
      return;
    }
    const seq = ++searchSeqRef.current;
    const handle = setTimeout(() => {
      if (hasPatientsRef.current) setRefreshing(true); else setInitialLoading(true);
      setPatientsNextCursor(null);
      setListError(null);
      searchPatients(term)
        .then((list) => { if (searchSeqRef.current === seq) { setPatients(list); setListError(null); } })
        .catch((e) => { if (searchSeqRef.current === seq) { setListError(e instanceof Error ? e.message : "검색에 실패했습니다."); } })
        .finally(() => { if (searchSeqRef.current === seq) { setInitialLoading(false); setRefreshing(false); } });
    }, 300);
    return () => clearTimeout(handle);
  }, [authReady, uid, search, reloadPatients]);

  const pagedGroups = useMemo(() => {
    const start = (groupPage - 1) * PAGE_SIZE;
    return patientGroups.slice(start, start + PAGE_SIZE);
  }, [patientGroups, groupPage]);

  const totalPages = Math.max(1, Math.ceil(patientGroups.length / PAGE_SIZE));

  return {
    search,
    setSearch,
    patientGroups,
    pagedGroups,
    groupPage,
    setGroupPage,
    totalPages,
    tableLoading,
    tableRefreshing,
    tableError,
    patientsNextCursor,
    loadingMore,
    loadMorePatients,
    reloadCurrent,
  };
}
