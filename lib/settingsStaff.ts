import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  startAfter,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { auth, db } from "./firebase";
import type { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";
import { createLog } from "./logs";
import { invalidateDoctorsCache } from "./reservations";
import { callSettingsApi } from "./settingsApi";
import { assertCanManageSettings } from "./settingsShared";

export type SettingsStaffRole =
  | "admin"
  | "coordinator"
  | "staff"
  | "interpreter";

export type SettingsStaffRecord = {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: SettingsStaffRole | string;
  active: boolean;
  staffCode?: string;
  orderNo?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByUid?: string;
};

// active는 여기 포함하지 않는다 — 활성화/비활성화는 전용 서버 API
// (/api/staff/activate, /api/staff/deactivate)로만 처리한다(토큰 revoke 동반).
export type StaffUpdatePayload = {
  displayName?: string;
  role?: SettingsStaffRole | string;
  orderNo?: number;
};

function cleanRole(value: unknown): SettingsStaffRole | string {
  const role = cleanText(value).toLowerCase();

  if (["admin", "coordinator", "staff", "interpreter"].includes(role)) {
    return role as SettingsStaffRole;
  }

  return role || "staff";
}

let _staffListCache: SettingsStaffRecord[] | null = null;
// 앱 통일 prefix(arc_crm_) 사용 — 과거 mcrm_ prefix 키는 clearAllClientCaches()가
// 레거시 정리 대상으로 당분간 함께 purge한다(lib/clientCache.ts).
const _STAFF_CACHE_KEY = "arc_crm_staff_list";
const _STAFF_CACHE_TTL = 5 * 60 * 1000;

export function clearStaffListCache() {
  _staffListCache = null;
  try { localStorage.removeItem(_STAFF_CACHE_KEY); } catch {}
}

export async function getStaffListForSettings(): Promise<SettingsStaffRecord[]> {
  if (_staffListCache) return _staffListCache;
  try {
    const raw = localStorage.getItem(_STAFF_CACHE_KEY);
    if (raw) {
      const { ts, data } = JSON.parse(raw) as { ts: number; data: SettingsStaffRecord[] };
      if (Date.now() - ts < _STAFF_CACHE_TTL) { _staffListCache = data; return data; }
    }
  } catch {}
  const result = await callSettingsApi("get_staff_list");
  const rawList = (result.staff as Record<string, unknown>[] | undefined) || [];

  const sorted = rawList
    .map((data) => ({
      id: cleanText(data.id),
      uid: cleanText(data.uid || data.id),
      email: cleanText(data.email),
      displayName: cleanText(data.displayName || data["display_name"] || data.email || data.id),
      role: cleanRole(data.role),
      active: data.active !== false,
      staffCode: cleanText(data.staffCode || data["staff_code"]),
      orderNo:
        typeof data.orderNo === "number"
          ? data.orderNo
          : typeof data["order_no"] === "number"
            ? data["order_no"] as number
            : 999999,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      updatedBy: cleanText(data.updatedBy),
      updatedByUid: cleanText(data.updatedByUid),
    }))
    .sort((a, b) => {
      const roleOrder: Record<string, number> = {
        admin: 1,
        coordinator: 2,
        staff: 3,
        interpreter: 4,
      };
      const ar = roleOrder[String(a.role)] || 99;
      const br = roleOrder[String(b.role)] || 99;
      return (
        ar - br ||
        Number(a.orderNo || 999999) - Number(b.orderNo || 999999) ||
        a.displayName.localeCompare(b.displayName)
      );
    });
  try { localStorage.setItem(_STAFF_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: sorted })); } catch {}
  _staffListCache = sorted;
  return _staffListCache;
}

export async function updateStaffFromSettings(
  staffId: string,
  payload: StaffUpdatePayload,
  actor: StaffUser
) {
  assertCanManageSettings(actor);

  const id = cleanText(staffId);
  if (!id) throw new Error("직원 ID가 없습니다.");

  const updatePayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    updatedBy: actor.displayName || actor.email || "",
    updatedByUid: actor.uid,
  };

  const ref = doc(db, "staff", id);
  let oldDisplayName = "";

  if (payload.displayName !== undefined) {
    const oldSnap = await getDoc(ref);
    oldDisplayName = cleanText(oldSnap.data()?.displayName);
    updatePayload.displayName = cleanText(payload.displayName);
  }

  if (payload.role !== undefined) {
    updatePayload.role = cleanRole(payload.role);
  }

  if (payload.orderNo !== undefined) {
    updatePayload.orderNo = Number(payload.orderNo || 999999);
  }

  await updateDoc(ref, updatePayload);
  invalidateDoctorsCache();

  const newDisplayName = typeof updatePayload.displayName === "string" ? updatePayload.displayName : "";
  if (oldDisplayName && newDisplayName && oldDisplayName !== newDisplayName) {
    const CHUNK = 400;
    let lastDoc: QueryDocumentSnapshot | null = null;
    let hasMore = true;

    while (hasMore) {
      const constraints: QueryConstraint[] = [
        where("doctors", "array-contains", oldDisplayName),
        limit(CHUNK),
        ...(lastDoc ? [startAfter(lastDoc)] : []),
      ];
      const snap = await getDocs(query(collection(db, "reservations"), ...constraints));
      if (snap.empty) break;

      const batch = writeBatch(db);
      snap.docs.forEach((d) => {
        const doctors = (d.data().doctors as string[] | undefined) || [];
        batch.update(d.ref, { doctors: doctors.map((n) => (n === oldDisplayName ? newDisplayName : n)) });
      });
      await batch.commit();

      lastDoc = snap.docs[snap.docs.length - 1];
      hasMore = snap.docs.length === CHUNK;
    }
  }

  createLog({
    action: "settings_update",
    targetType: "settings",
    targetId: id,
    staff: actor,
    message: "직원 설정을 수정했습니다.",
    after: updatePayload,
  }).catch((e) => console.warn("[updateStaffFromSettings] log write failed:", e));

  return true;
}

export async function createStaffFromSettings(
  params: {
    email: string;
    password: string;
    displayName: string;
    role: SettingsStaffRole;
    staffCode?: string;
  },
  actor: StaffUser
): Promise<void> {
  assertCanManageSettings(actor);

  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/staff/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...params }),
  });

  const data = (await res.json()) as { success: boolean; message?: string };
  if (!data.success) {
    throw new Error(data.message || "직원 생성에 실패했습니다.");
  }
  invalidateDoctorsCache();
}

export async function deactivateStaffFromSettings(
  staffId: string,
  actor: StaffUser
) {
  assertCanManageSettings(actor);

  const id = cleanText(staffId);
  if (!id) throw new Error("직원 ID가 없습니다.");

  if (id === actor.uid) {
    throw new Error("본인 계정은 비활성화할 수 없습니다.");
  }

  // 비활성화는 서버 API로 처리한다 — active:false 직후 refresh token을 revoke해야
  // 이미 로그인한 세션이 즉시 무력화된다(클라 Firestore 직접 쓰기로는 revoke 불가).
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/staff/deactivate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ uid: id }),
  });
  const data = (await res.json()) as {
    success: boolean;
    message?: string;
    tokenRevoked?: boolean;
    partialSuccess?: boolean;
    staffDeactivated?: boolean;
    errorCode?: string;
  };
  // staffDeactivated가 true면 active:false 자체는 반영된 부분 성공(토큰 revoke만 실패)이므로
  // throw하지 않고 그대로 반환한다 — 호출부(UI)가 "재확인 필요" 메시지를 표시할 수 있게.
  if (!data.success && !data.staffDeactivated) {
    throw new Error(data.message || "직원 비활성화에 실패했습니다.");
  }
  invalidateDoctorsCache();
  return data;
}

export async function activateStaffFromSettings(
  staffId: string,
  actor: StaffUser
) {
  assertCanManageSettings(actor);

  const id = cleanText(staffId);
  if (!id) throw new Error("직원 ID가 없습니다.");

  // 활성화도 전용 서버 API로 처리한다 — active는 클라 Firestore 직접 쓰기로
  // 바꿀 수 없다(firestore.rules에서 차단). 활성화는 세션 무력화 대상이 아니므로 token revoke는 없다.
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/staff/activate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ uid: id }),
  });
  const data = (await res.json()) as { success: boolean; message?: string };
  if (!data.success) {
    throw new Error(data.message || "직원 활성화에 실패했습니다.");
  }
  invalidateDoctorsCache();
  return data;
}

/* ============================================================
   보안 — 내 비밀번호 변경
============================================================ */

export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
  staff: StaffUser
) {
  if (!staff?.uid) throw new Error("로그인 정보를 확인할 수 없습니다.");

  const user = auth.currentUser;

  if (!user || !user.email) {
    throw new Error("현재 로그인 계정을 확인할 수 없습니다.");
  }

  const current = cleanText(currentPassword);
  const next = cleanText(newPassword);

  if (!current) throw new Error("현재 비밀번호를 입력하세요.");
  if (!next) throw new Error("새 비밀번호를 입력하세요.");
  if (next.length < 6) {
    throw new Error("새 비밀번호는 최소 6자 이상 입력하세요.");
  }

  const credential = EmailAuthProvider.credential(user.email, current);

  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, next);

  createLog({
    action: "settings_update",
    targetType: "settings",
    targetId: "password",
    staff,
    message: "내 비밀번호를 변경했습니다.",
    after: { changed: true },
  }).catch((e) => console.warn("[changeMyPassword] log write failed:", e));

  return true;
}
