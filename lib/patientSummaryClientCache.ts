import type { PatientRecord } from "./reservations";

const CACHE_KEY_PREFIX = "arc_crm_patients_summary_v1_";
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_VERSION = 1;

type CachedData = {
  version: number;
  cachedAt: number;
  patients: PatientRecord[];
  nextCursor: string | null;
  hasMore: boolean;
};

function cacheKey(uid: string) {
  return CACHE_KEY_PREFIX + uid;
}

function readSessionStorage(uid: string): CachedData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      parsed.version !== CACHE_VERSION ||
      typeof parsed.cachedAt !== "number" ||
      !Array.isArray(parsed.patients)
    ) {
      return null;
    }
    return parsed as CachedData;
  } catch {
    return null;
  }
}

let _memoryCache: (CachedData & { uid: string }) | null = null;

export function getPatientSummaryCache(uid: string): CachedData | null {
  if (_memoryCache && _memoryCache.uid === uid) {
    return _memoryCache;
  }
  const stored = readSessionStorage(uid);
  if (stored) {
    _memoryCache = { ...stored, uid };
  }
  return stored;
}

export function isPatientSummaryCacheFresh(cache: CachedData | null): boolean {
  if (!cache) return false;
  return Date.now() - cache.cachedAt < CACHE_TTL_MS;
}

export function setPatientSummaryCache(
  uid: string,
  patients: PatientRecord[],
  nextCursor: string | null
) {
  const data: CachedData = {
    version: CACHE_VERSION,
    cachedAt: Date.now(),
    patients,
    nextCursor,
    hasMore: !!nextCursor,
  };
  _memoryCache = { ...data, uid };
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(cacheKey(uid), JSON.stringify(data));
  } catch {
    // quota or security error
  }
}

export function invalidatePatientSummaryCache(uid?: string) {
  _memoryCache = null;
  if (typeof window === "undefined") return;
  try {
    if (uid) {
      sessionStorage.removeItem(cacheKey(uid));
    } else {
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(CACHE_KEY_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => sessionStorage.removeItem(k));
    }
  } catch {
    // ignore
  }
}

export { CACHE_TTL_MS as PATIENT_SUMMARY_CACHE_TTL_MS };
