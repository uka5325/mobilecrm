import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";

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


function getLogTime(value: unknown) {
  try {
    const v = value as { toDate?: () => Date } | Date | string | number | null;
    const date =
      v && typeof (v as { toDate?: unknown }).toDate === "function"
        ? (v as { toDate: () => Date }).toDate()
        : v instanceof Date
          ? v
          : new Date(v as string | number);

    const time = date.getTime();
    return Number.isFinite(time) ? time : 0;
  } catch {
    return 0;
  }
}

function mapLogDoc(id: string, data: Record<string, unknown>): LogRecord {
  return {
    id,

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
  const {
    action,
    targetType,
    targetId = "",
    staff,
    message,
    before = null,
    after = null,
    patientId = "",
    reservationId = "",
    invoiceId = "",
  } = params;

  if (!staff?.uid) {
    throw new Error("로그를 저장할 직원 정보가 없습니다.");
  }

  await addDoc(collection(db, "logs"), {
    action,
    targetType,
    targetId,

    staffUid: staff.uid,

    staffName: staff.displayName,
    staffEmail: staff.email,
    staffRole: staff.role,
    staffCode: staff.staffCode || "",

    patientId,
    reservationId,
    invoiceId,

    message,

    before,
    after,

    createdAt: serverTimestamp(),
  });
}

export async function getLogsByReservationId(
  reservationId: string,
  targetId?: string
) {
  const id = cleanText(reservationId);
  const target = cleanText(targetId);

  if (!id && !target) return [];

  const result: Record<string, LogRecord> = {};

  if (id) {
    const q = query(collection(db, "logs"), where("reservationId", "==", id));
    const snap = await getDocs(q);

    snap.docs.forEach((docSnap) => {
      result[docSnap.id] = mapLogDoc(docSnap.id, docSnap.data());
    });
  }

  if (target) {
    const q = query(collection(db, "logs"), where("targetId", "==", target));
    const snap = await getDocs(q);

    snap.docs.forEach((docSnap) => {
      result[docSnap.id] = mapLogDoc(docSnap.id, docSnap.data());
    });
  }

  return Object.values(result).sort(
    (a, b) => getLogTime(b.createdAt) - getLogTime(a.createdAt)
  );
}

export async function getLatestLogsByReservationIds(reservationIds: string[]) {
  const ids = Array.from(new Set(reservationIds.map(cleanText).filter(Boolean)));

  if (!ids.length) return {};

  const result: Record<string, LogRecord> = {};

  async function fetchByField(fieldName: "reservationId" | "targetId") {
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);

      const q = query(collection(db, "logs"), where(fieldName, "in", chunk));
      const snap = await getDocs(q);

      snap.docs.forEach((docSnap) => {
        const log = mapLogDoc(docSnap.id, docSnap.data());
        const keys = [log.reservationId, log.targetId].filter(Boolean);

        keys.forEach((key) => {
          const prev = result[key];

          if (!prev || getLogTime(log.createdAt) > getLogTime(prev.createdAt)) {
            result[key] = log;
          }
        });
      });
    }
  }

  await Promise.all([
    fetchByField("reservationId"),
    fetchByField("targetId"),
  ]);

  return result;
}
