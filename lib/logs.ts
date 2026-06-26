import { auth } from "./firebase";
import type { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";
import { toMillis } from "./settingsUtils";

export type LogAction =
  | "login"
  | "logout"
  | "patient_create"
  | "patient_update"
  | "reservation_create"
  | "reservation_update"
  | "reservation_delete"
  | "invoice_create"
  | "invoice_update"
  | "invoice_delete"
  | "file_upload"
  | "file_delete"
  | "memo_create"
  | "memo_update"
  | "memo_delete"
  | "settings_update";

export type LogTargetType =
  | "auth"
  | "patient"
  | "reservation"
  | "invoice"
  | "file"
  | "memo"
  | "settings";

type CreateLogParams = {
  action: LogAction;
  targetType: LogTargetType;
  targetId?: string;
  staff: StaffUser;
  message: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  patientId?: string;
  reservationId?: string;
  invoiceId?: string;
};

export type LogRecord = {
  id: string;
  action: LogAction | string;
  targetType: LogTargetType | string;
  targetId: string;
  staffUid: string;
  staffName: string;
  staffEmail: string;
  staffRole: string;
  staffCode: string;
  patientId: string;
  reservationId: string;
  invoiceId: string;
  message: string;
  before?: unknown;
  after?: unknown;
  createdAt?: unknown;
};

async function callLogsApi(action: string, payload: Record<string, unknown>) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) return { success: false as const };
  const idToken = await firebaseUser.getIdToken();
  const res = await fetch("/api/logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action, payload }),
  });
  if (!res.ok) return { success: false as const };
  return res.json() as Promise<Record<string, unknown> & { success: boolean }>;
}

function mapLogDoc(data: Record<string, unknown>): LogRecord {
  return {
    id: cleanText(data.id),
    action: cleanText(data.action),
    targetType: cleanText(data.targetType),
    targetId: cleanText(data.targetId),
    staffUid: cleanText(data.staffUid),
    staffName: cleanText(data.staffName),
    staffEmail: cleanText(data.staffEmail),
    staffRole: cleanText(data.staffRole),
    staffCode: cleanText(data.staffCode),
    patientId: cleanText(data.patientId),
    reservationId: cleanText(data.reservationId),
    invoiceId: cleanText(data.invoiceId),
    message: cleanText(data.message),
    before: data.before,
    after: data.after,
    createdAt: data.createdAt,
  };
}

export async function createLog(params: CreateLogParams) {
  if (!params.staff?.uid) return;
  callLogsApi("create", {
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId ?? "",
    staffUid: params.staff.uid,
    staffName: params.staff.displayName,
    staffEmail: params.staff.email,
    staffRole: params.staff.role,
    staffCode: params.staff.staffCode || "",
    patientId: params.patientId ?? "",
    reservationId: params.reservationId ?? "",
    invoiceId: params.invoiceId ?? "",
    message: params.message,
    before: params.before ?? null,
    after: params.after ?? null,
  }).catch((e) => console.warn("[createLog]", e));
}

export async function getLogsByReservationId(
  reservationId: string,
  targetId?: string,
  patientId?: string,
  opts?: { sinceDays?: number }
): Promise<LogRecord[]> {
  const id = cleanText(reservationId);
  const tid = cleanText(targetId);
  const pid = cleanText(patientId);
  if (!id && !tid && !pid) return [];

  // sinceDays>0이면 최근 N일만 조회(상세 오픈 기본 3일), 미지정/0이면 전체(최대 50).
  const result = await callLogsApi("read", { reservationId: id, targetId: tid, patientId: pid, sinceDays: opts?.sinceDays });
  if (!result.success || !Array.isArray(result.logs)) return [];

  return (result.logs as Record<string, unknown>[]).map(mapLogDoc);
}

export async function getLatestLogsByReservationIds(reservationIds: string[]) {
  const ids = Array.from(new Set(reservationIds.map(cleanText).filter(Boolean)));
  if (!ids.length) return {};

  // 30개 단위 배치 (Firestore in 쿼리 제한)
  const BATCH = 30;
  const allLogs: LogRecord[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const res = await callLogsApi("read_batch", { reservationIds: batch });
    if (res.success && Array.isArray(res.logs)) {
      allLogs.push(...(res.logs as Record<string, unknown>[]).map(mapLogDoc));
    }
  }

  // reservationId별 최신 로그 1개 추출
  const result: Record<string, LogRecord> = {};
  for (const log of allLogs) {
    const rid = log.reservationId;
    if (!rid) continue;
    if (!result[rid] || toMillis(log.createdAt) > toMillis(result[rid].createdAt)) {
      result[rid] = log;
    }
  }
  return result;
}
