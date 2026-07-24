import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, query, where, getDocs } from "firebase/firestore";
import { cleanText } from "@/lib/stringUtils";
import { callReservationsApi } from "./reservationClientApi";
import {
  cleanNumber,
  mapReservationDoc,
  type DoctorOption,
  type ReservationRecord,
} from "@/features/reservations/domain/reservationModels";

// ─── 의사 목록 (서버 API + 세션 캐시) ─────────────────────────────────────────
const DOCTORS_CACHE_KEY = "crm_doctors_v1";

function setCachedDoctors(doctors: DoctorOption[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DOCTORS_CACHE_KEY, JSON.stringify(doctors));
  } catch {}
}

function sortDoctors(doctors: DoctorOption[]) {
  return [...doctors].sort((a, b) => {
    return (
      cleanNumber(a.orderNo) -
        cleanNumber(b.orderNo) ||
      a.displayName.localeCompare(b.displayName)
    );
  });
}

function makeDoctorOptionsFromReservations(
  reservations: ReservationRecord[]
): DoctorOption[] {
  const names = Array.from(
    new Set(
      reservations
        .flatMap((item) => item.doctors || [])
        .map(cleanText)
        .filter(Boolean)
    )
  );

  return names.map((name, index) => ({
    uid: `fallback-doctor-${index}-${name}`,
    displayName: name,
    email: "",
    orderNo: index + 1,
  }));
}

let _doctorsPromise: Promise<DoctorOption[]> | null = null;
let _doctorsCachedAt = 0;
const DOCTORS_TTL_MS = 10 * 60 * 1000;

export async function getDoctors(): Promise<DoctorOption[]> {
  if (_doctorsPromise && Date.now() - _doctorsCachedAt < DOCTORS_TTL_MS) return _doctorsPromise;

  _doctorsCachedAt = Date.now();
  _doctorsPromise = (async () => {
    const result = await callReservationsApi("read_doctors", {});
    const rawDoctors = (result.doctors as Record<string, unknown>[] | undefined) || [];

    const doctors = rawDoctors
      .map((d) => ({
        uid: String(d.id || ""),
        displayName: cleanText(d.displayName || d["display_name"] || d.name),
        email: cleanText(d.email),
        orderNo: cleanNumber(d.orderNo ?? d["order_no"]),
        role: String(d.role || ""),
        active: d.active,
      }))
      .filter((d) => d.displayName && d.role === "doctor" && d.active !== false);

    setCachedDoctors(sortDoctors(doctors));
    return sortDoctors(doctors);
  })();

  return _doctorsPromise;
}

export function invalidateDoctorsCache() {
  _doctorsPromise = null;
  _doctorsCachedAt = 0;
}

// 예약 정렬: 목록(date)=날짜+시간+이름, 타임라인(time)=시간+이름. 정렬 키 차이를 보존.
function sortReservations(
  list: ReservationRecord[],
  sortKey: "date" | "time"
): ReservationRecord[] {
  return [...list].sort((a, b) => {
    const aa = sortKey === "date"
      ? `${a.reservationDate} ${a.reservationTime} ${a.name}`
      : `${a.reservationTime} ${a.name}`;
    const bb = sortKey === "date"
      ? `${b.reservationDate} ${b.reservationTime} ${b.name}`
      : `${b.reservationTime} ${b.name}`;
    return aa.localeCompare(bb);
  });
}

// 클라이언트 SDK로 의사 목록 조회 (세션 내 캐싱)
let _clientDoctorsCache: DoctorOption[] | null = null;
let _clientDoctorsCacheAt = 0;
const CLIENT_DOCTORS_TTL = 10 * 60 * 1000;

async function getClientDoctors(): Promise<DoctorOption[]> {
  if (_clientDoctorsCache && Date.now() - _clientDoctorsCacheAt < CLIENT_DOCTORS_TTL) {
    return _clientDoctorsCache;
  }
  const snap = await getDocs(
    query(collection(db, "staff"), where("role", "==", "doctor"), where("active", "==", true))
  );
  const doctors: DoctorOption[] = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        uid: d.id,
        displayName: cleanText(data.displayName || data.display_name || data.name),
        email: cleanText(data.email),
        orderNo: cleanNumber(data.orderNo ?? data.order_no),
      };
    })
    .filter((d) => d.displayName)
    .sort((a, b) => a.orderNo - b.orderNo || a.displayName.localeCompare(b.displayName));
  _clientDoctorsCache = doctors;
  _clientDoctorsCacheAt = Date.now();
  return doctors;
}

// 예약을 [from, to] 날짜 범위로 실시간 구독한다. to가 null이면 from 이후 전체.
// 화면별 필요한 범위만 구독하는 구조의 기반(홈=오늘, 스케줄=선택 범위).
// 인덱스: reservations (isDeleted ASC, reservationDate) — firestore.indexes.json.
export function subscribeReservationsByRange(
  from: string,
  to: string | null,
  callback: (data: {
    reservations: ReservationRecord[];
    doctors: DoctorOption[];
  }) => void,
  onError?: (error: Error) => void
) {
  let unsubscribeSnapshot: (() => void) | null = null;
  let latestDoctors: DoctorOption[] = [];

  const unsubscribeAuth = auth.onAuthStateChanged((user) => {
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    if (!user) return;

    // 실시간 단일 경로: onSnapshot이 데이터를 공급. 의사 목록만 별도 조회.
    getClientDoctors().then((d) => { latestDoctors = d; }).catch(() => {});

    const constraints = [
      where("isDeleted", "==", false),
      where("reservationDate", ">=", from),
    ];
    if (to) constraints.push(where("reservationDate", "<=", to));

    unsubscribeSnapshot = onSnapshot(
      query(collection(db, "reservations"), ...constraints),
      (snap) => {
        if (snap.metadata.fromCache && snap.empty) {
          callback({ reservations: [], doctors: latestDoctors });
          return;
        }
        const reservations = sortReservations(
          snap.docs
            .map((d) => mapReservationDoc(d.id, d.data() as Record<string, unknown>))
            .filter((item) => !item.isDeleted),
          "date"
        );
        const fallback = makeDoctorOptionsFromReservations(reservations);
        callback({ reservations, doctors: latestDoctors.length ? latestDoctors : fallback });
      },
      (error) => {
        console.error("[subscribeReservationsByRange error]", (error as Error)?.message ?? "");
        onError?.(error);
      }
    );
  });

  return () => {
    unsubscribeAuth();
    unsubscribeSnapshot?.();
  };
}

export async function searchReservationsByDateRange(
  from: string,
  to: string
): Promise<ReservationRecord[]> {
  // KPI/대시보드는 기간 전체를 서버 pagination으로 정확히 집계한다(500 상한 부분집계 금지).
  // 하드 상한 초과 시 서버가 KPI_QUERY_LIMIT_EXCEEDED 오류를 주고, 여기서 그대로 throw한다.
  const result = await callReservationsApi("read_range_all", { from, to });
  if (!result.success) throw new Error(String(result.message || "검색 실패"));
  const raw = (result.reservations as Record<string, unknown>[] | undefined) || [];
  return raw
    .map((r) => mapReservationDoc(String(r.id || ""), r))
    .filter((item) => !item.isDeleted)
    .sort((a, b) => `${b.reservationDate} ${b.reservationTime}`.localeCompare(`${a.reservationDate} ${a.reservationTime}`));
}

// CSV 내보내기용 서버 조회: 지정 기간을 Firestore 쿼리로 정확히 읽고 메모를 배치로 묶는다.
// (기존 클라 CSV의 "45일 메모리 데이터만 포함 + 메모 N회 호출" 문제 해결)
export async function fetchReservationsForExport(
  startDate: string,
  endDate: string,
  includeNotes: boolean
): Promise<{
  reservations: ReservationRecord[];
  notesByDoc: Record<string, { createdBy: string; memoText: string }[]>;
  capped: boolean;
}> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error("로그인 상태를 확인할 수 없습니다.");
  const idToken = await firebaseUser.getIdToken();
  const res = await fetch("/api/reservations/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, startDate, endDate, includeNotes }),
  });
  if (!res.ok) throw new Error(`서버 오류가 발생했습니다. (${res.status})`);
  const data = (await res.json()) as Record<string, unknown> & { success: boolean; message?: string };
  if (!data.success) throw new Error(String(data.message || "내보내기에 실패했습니다."));
  const raw = (data.reservations as Record<string, unknown>[] | undefined) || [];
  return {
    reservations: raw.map((r) => mapReservationDoc(String(r.id || ""), r)),
    notesByDoc: (data.notesByDoc as Record<string, { createdBy: string; memoText: string }[]>) || {},
    capped: Boolean(data.capped),
  };
}
