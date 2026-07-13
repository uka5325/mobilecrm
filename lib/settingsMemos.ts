import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import type { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";
import { toDate } from "./settingsUtils";
import { callSettingsApi } from "./settingsApi";
import { assertCanEditMemo } from "./settingsShared";

export type ConferenceMemo = {
  id: string;
  memoDate: string;
  memoText: string;
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  deleted?: boolean;
  deletedAt?: unknown;
  deletedBy?: string;
};

function normalizeDateOnly(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return todayString();

  const dash = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (dash) {
    return `${dash[1]}-${String(Number(dash[2])).padStart(2, "0")}-${String(
      Number(dash[3])
    ).padStart(2, "0")}`;
  }

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  return raw.slice(0, 10);
}

function todayString() {
  const d = new Date();

  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

const MEMO_CACHE_PREFIX = "crm_memos_";

function invalidateMemoCache(memoDate: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(MEMO_CACHE_PREFIX + memoDate);
  } catch {}
}

// 동기 캐시 getter — 즉시 페인트용(로딩 깜빡임 제거)
export function getCachedConferenceMemos(memoDate: string): ConferenceMemo[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(MEMO_CACHE_PREFIX + normalizeDateOnly(memoDate));
    return raw ? (JSON.parse(raw) as ConferenceMemo[]) : null;
  } catch {
    return null;
  }
}

export async function getConferenceMemos(
  memoDate: string,
  limit = 50,
  force = false
): Promise<ConferenceMemo[]> {
  const targetDate = normalizeDateOnly(memoDate);
  const cacheKey = MEMO_CACHE_PREFIX + targetDate;

  // force=false면 캐시 우선(네트워크 생략). force=true면 변경 반영 위해 재조회.
  if (!force && typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) return JSON.parse(raw) as ConferenceMemo[];
    } catch {}
  }

  const result = await callSettingsApi("get_memos", { memoDate: targetDate, limit });
  const memos = (result.memos as ConferenceMemo[]) ?? [];

  setTimeout(() => {
    try { sessionStorage.setItem(cacheKey, JSON.stringify(memos)); } catch {}
  }, 0);

  return memos;
}

// 스냅샷 갱신 시 다음 전체 새로고침의 즉시표시 시드를 최신으로 유지.
export function writeConferenceMemoCache(memoDate: string, memos: ConferenceMemo[]) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(MEMO_CACHE_PREFIX + normalizeDateOnly(memoDate), JSON.stringify(memos));
  } catch {}
}

function mapConferenceMemoDoc(id: string, data: Record<string, unknown>): ConferenceMemo {
  return {
    id,
    memoDate: String(data.memoDate || ""),
    memoText: String(data.memoText || ""),
    createdBy: String(data.createdBy || ""),
    createdByName: String(data.createdByName || ""),
    createdAt: data.createdAt,
    deleted: data.deleted === true,
    deletedAt: data.deletedAt,
    deletedBy: String(data.deletedBy || ""),
  };
}

// 오늘의 전체 메모 실시간 구독 — 클라이언트 onSnapshot(conferenceMemos는 read 전용으로
// 개방됨, firestore.rules 참고). 예약 범위 구독(lib/reservations.ts)과 동일한
// 게이팅/정리 패턴: auth 상태가 바뀌면 재구독하고, unsubscribe로 정리한다.
export function subscribeConferenceMemos(
  memoDate: string,
  callback: (memos: ConferenceMemo[]) => void,
  onError?: (error: Error) => void
) {
  const targetDate = normalizeDateOnly(memoDate);
  let unsubscribeSnapshot: (() => void) | null = null;

  const unsubscribeAuth = auth.onAuthStateChanged((user) => {
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    if (!user) return;

    unsubscribeSnapshot = onSnapshot(
      query(collection(db, "conferenceMemos"), where("memoDate", "==", targetDate)),
      (snap) => {
        if (snap.metadata.fromCache && snap.empty) {
          callback([]);
          return;
        }
        const memos = snap.docs
          .map((d) => mapConferenceMemoDoc(d.id, d.data() as Record<string, unknown>))
          .filter((m) => !m.deleted)
          .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
        callback(memos);
      },
      (error) => {
        console.error("[subscribeConferenceMemos error]", (error as Error)?.message ?? "");
        onError?.(error);
      }
    );
  });

  return () => {
    unsubscribeAuth();
    unsubscribeSnapshot?.();
  };
}

export async function addConferenceMemo(
  memoDate: string,
  memoText: string,
  staff: StaffUser
) {
  assertCanEditMemo(staff);

  const targetDate = normalizeDateOnly(memoDate);
  const text = cleanText(memoText);

  if (!text) throw new Error("메모 내용을 입력하세요.");

  const result = await callSettingsApi("add_memo", {
    memoDate: targetDate,
    memoText: text,
    createdByName: staff.displayName || staff.email || "",
  });

  invalidateMemoCache(targetDate);
  return result.id as string;
}

export async function deleteConferenceMemo(memoId: string, staff: StaffUser, memoDate?: string) {
  assertCanEditMemo(staff);

  const id = cleanText(memoId);
  if (!id) throw new Error("메모 ID가 없습니다.");

  await callSettingsApi("delete_memo", { memoId: id });

  if (memoDate) invalidateMemoCache(normalizeDateOnly(memoDate));
  return true;
}

export async function updateConferenceMemo(memoId: string, memoText: string, staff: StaffUser, memoDate?: string) {
  assertCanEditMemo(staff);

  const id = cleanText(memoId);
  if (!id) throw new Error("메모 ID가 없습니다.");

  const text = cleanText(memoText);
  if (!text) throw new Error("메모 내용을 입력하세요.");

  await callSettingsApi("update_memo", { memoId: id, memoText: text });

  if (memoDate) invalidateMemoCache(normalizeDateOnly(memoDate));
  return true;
}
