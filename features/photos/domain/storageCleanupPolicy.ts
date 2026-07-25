export const STORAGE_CLEANUP_MAX_ATTEMPTS = 5;
export const STORAGE_CLEANUP_LEASE_MS = 5 * 60 * 1000;

export function isAllowedStoragePath(storagePath: string): boolean {
  return storagePath.startsWith("reservationFiles/")
    && storagePath.length <= 500
    && !storagePath.includes("../");
}

export function storageCleanupRetryDelayMs(attempts: number): number {
  const normalizedAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  return Math.min(oneHour * 2 ** (normalizedAttempts - 1), oneDay);
}

export function storageDeleteErrorCode(error: unknown): string {
  const raw = (error as { code?: unknown })?.code;
  const code = raw === undefined || raw === null ? "unknown" : String(raw);
  return code.replace(/[^a-zA-Z0-9_.:/-]/g, "_").slice(0, 80) || "unknown";
}

export function isStorageObjectNotFound(error: unknown): boolean {
  const code = storageDeleteErrorCode(error);
  return code === "404" || code === "storage/object-not-found";
}

export function isRetryableStorageDeleteError(error: unknown): boolean {
  const code = storageDeleteErrorCode(error);
  if (code === "401" || code === "403") return false;
  if (code === "storage/unauthorized" || code === "storage/invalid-argument") return false;
  return true;
}

export function classifyStorageDeleteError(
  error: unknown
): { status: "deleted" } | { status: "failed"; errorCode: string } {
  if (isStorageObjectNotFound(error)) return { status: "deleted" };
  return { status: "failed", errorCode: storageDeleteErrorCode(error) };
}

export function storageCleanupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}
