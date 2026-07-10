from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Make the safe client wrapper the canonical module and remove the tsconfig
# alias indirection. The old implementation remains explicit as reservationsBase.
# ---------------------------------------------------------------------------
base = read("lib/reservations.ts")
safe = read("lib/reservationsSafe.ts")
write("lib/reservationsBase.ts", base)
safe = safe.replace('"./reservations"', '"./reservationsBase"')
write("lib/reservations.ts", safe)
(ROOT / "lib/reservationsSafe.ts").unlink()

tsconfig_path = ROOT / "tsconfig.json"
tsconfig = json.loads(tsconfig_path.read_text())
tsconfig["compilerOptions"]["paths"].pop("@/lib/reservations", None)
tsconfig_path.write_text(json.dumps(tsconfig, ensure_ascii=False, indent=2) + "\n")

# ---------------------------------------------------------------------------
# Type the client API call and centralize derived-cache invalidation.
# ---------------------------------------------------------------------------
base = read("lib/reservationsBase.ts")
base = replace_once(
    base,
    'import type { AmountRow, AmountRowType } from "./reservationAmountRows";\n',
    'import type { AmountRow, AmountRowType } from "./reservationAmountRows";\n'
    'import type {\n'
    '  ReservationApiAction,\n'
    '  ReservationApiPayload,\n'
    '  ReservationApiRequest,\n'
    '  ReservationApiResult,\n'
    '} from "./reservationApiContracts";\n',
    "base contract import",
)
old_call = '''async function callReservationsApi(action: string, payload: Record<string, unknown>) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    return { success: false as const, message: "로그인 상태를 확인할 수 없습니다. 페이지를 새로고침 후 다시 시도해주세요." };
  }
  if (!navigator.onLine) {
    return { success: false as const, message: "인터넷 연결을 확인해주세요." };
  }
  try {
    const idToken = await firebaseUser.getIdToken();
    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, action, payload }),
    });
    if (!res.ok) {
      return { success: false as const, message: `서버 오류가 발생했습니다. (${res.status})` };
    }
    return res.json() as Promise<Record<string, unknown> & { success: boolean; message?: string }>;
  } catch {
    return { success: false as const, message: "네트워크 오류가 발생했습니다. 연결 상태를 확인해주세요." };
  }
}
'''
new_call = '''async function callReservationsApi<A extends ReservationApiAction>(
  action: A,
  payload: ReservationApiPayload<A>
): Promise<ReservationApiResult<A>> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    return { success: false, message: "로그인 상태를 확인할 수 없습니다. 페이지를 새로고침 후 다시 시도해주세요." };
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { success: false, message: "인터넷 연결을 확인해주세요." };
  }
  try {
    const idToken = await firebaseUser.getIdToken();
    const request: ReservationApiRequest<A> = { idToken, action, payload };
    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = await res.json().catch(() => ({})) as ReservationApiResult<A>;
    if (!res.ok) {
      return {
        ...body,
        success: false,
        message: typeof body.message === "string"
          ? body.message
          : `서버 오류가 발생했습니다. (${res.status})`,
      };
    }
    return body;
  } catch {
    return { success: false, message: "네트워크 오류가 발생했습니다. 연결 상태를 확인해주세요." };
  }
}
'''
base = replace_once(base, old_call, new_call, "base typed call")

cache_anchor = '''export function invalidatePatientAmountRowsCache(patientId: string) {
  _patientAmountRowsCache.delete(amountRowsCacheKey(patientId, "deposit"));
  _patientAmountRowsCache.delete(amountRowsCacheKey(patientId, "surgery"));
}
'''
cache_replacement = cache_anchor + '''
// 예약 mutation 뒤 두 화면이 동일한 원본을 다시 읽도록 관련 세션 캐시를 한 번에 비운다.
export function invalidateReservationDerivedCaches(patientId: string) {
  const id = cleanText(patientId);
  if (!id) return;
  invalidatePatientsCache();
  invalidatePatientsSummaryCache();
  invalidatePatientFullHistoryCache(id);
  invalidatePatientAmountRowsCache(id);
}
'''
base = replace_once(base, cache_anchor, cache_replacement, "derived cache helper")

old_amount_return = '''  return apiResult.success
    ? { success: true }
    : { success: false, message: cleanText(apiResult.message) || "금액 저장에 실패했습니다." };
'''
new_amount_return = '''  if (!apiResult.success) {
    return { success: false, message: cleanText(apiResult.message) || "금액 저장에 실패했습니다." };
  }
  invalidateReservationDerivedCaches(patientId);
  return { success: true };
'''
base = replace_once(base, old_amount_return, new_amount_return, "amount cache invalidation")

old_update_success = '''  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "예약 수정에 실패했습니다." };
  }

  return { success: true };
}
'''
new_update_success = '''  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "예약 수정에 실패했습니다." };
  }

  invalidateReservationDerivedCaches(patientId);
  return { success: true };
}
'''
base = replace_once(base, old_update_success, new_update_success, "full update cache invalidation")

old_delete_success = '''  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "예약 삭제에 실패했습니다." };
  }

  // 감사로그는 서버(/api/reservations delete)에서 권위 있게 기록됨 → 클라 createLog 제거.

  return { success: true };
}
'''
new_delete_success = '''  if (!apiResult.success) {
    return { success: false, message: apiResult.message || "예약 삭제에 실패했습니다." };
  }

  // 감사로그는 서버(/api/reservations delete)에서 권위 있게 기록됨 → 클라 createLog 제거.
  const canonicalPatientId = cleanText(apiResult.patientId);
  if (canonicalPatientId) invalidateReservationDerivedCaches(canonicalPatientId);

  return { success: true };
}
'''
base = replace_once(base, old_delete_success, new_delete_success, "delete cache invalidation")

base = replace_once(
    base,
    '''  invalidatePatientsCache();
  invalidatePatientsSummaryCache();
  const savedReservationId = String(apiResult.reservationDocId || "");
''',
    '''  invalidateReservationDerivedCaches(patientId);
  const savedReservationId = String(apiResult.reservationDocId || "");
''',
    "base create cache invalidation",
)
base = replace_once(
    base,
    '''  invalidatePatientsCache();
  invalidatePatientsSummaryCache();
  return { success: true };
}

// 환자 전체 삭제''',
    '''  invalidateReservationDerivedCaches(patientId);
  return { success: true };
}

// 환자 전체 삭제''',
    "patient profile cache invalidation",
)
base = replace_once(
    base,
    '''  invalidatePatientsCache();
  invalidatePatientsSummaryCache();
  return {
    success: true,
    deletedReservations: Number(apiResult.deletedReservations || 0),
''',
    '''  invalidateReservationDerivedCaches(patientId);
  return {
    success: true,
    deletedReservations: Number(apiResult.deletedReservations || 0),
''',
    "patient delete cache invalidation",
)
write("lib/reservationsBase.ts", base)

wrapper = read("lib/reservations.ts")
wrapper = replace_once(
    wrapper,
    'import type { StaffUser } from "./auth";\n',
    'import type { StaffUser } from "./auth";\n'
    'import type {\n'
    '  ReservationApiAction,\n'
    '  ReservationApiPayload,\n'
    '  ReservationApiRequest,\n'
    '  ReservationApiResult,\n'
    '} from "./reservationApiContracts";\n',
    "wrapper contract import",
)
wrapper = replace_once(
    wrapper,
    '''type ApiResult = Record<string, unknown> & {
  success: boolean;
  message?: string;
  code?: string;
};
''',
    '''type ApiResult = ReservationApiResult;
''',
    "wrapper result type",
)
old_wrapper_call = '''async function callApi(
  action: string,
  payload: Record<string, unknown>,
  options: CallApiOptions = {}
): Promise<ApiResult> {
  const user = auth.currentUser;
  if (!user) return { success: false, message: "로그인이 필요합니다." };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { success: false, message: "인터넷 연결을 확인해주세요." };
  }

  try {
    const idToken = await user.getIdToken();
    const response = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, action, payload }),
      signal: options.signal,
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ...body,
        success: false,
        message: typeof body.message === "string"
          ? body.message
          : `서버 오류가 발생했습니다. (${response.status})`,
      };
    }
    return body as ApiResult;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { success: false, message: "네트워크 오류가 발생했습니다." };
  }
}
'''
new_wrapper_call = '''async function callApi<A extends ReservationApiAction>(
  action: A,
  payload: ReservationApiPayload<A>,
  options: CallApiOptions = {}
): Promise<ReservationApiResult<A>> {
  const user = auth.currentUser;
  if (!user) return { success: false, message: "로그인이 필요합니다." };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { success: false, message: "인터넷 연결을 확인해주세요." };
  }

  try {
    const idToken = await user.getIdToken();
    const request: ReservationApiRequest<A> = { idToken, action, payload };
    const response = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options.signal,
    });
    const body = await response.json().catch(() => ({})) as ReservationApiResult<A>;
    if (!response.ok) {
      return {
        ...body,
        success: false,
        message: typeof body.message === "string"
          ? body.message
          : `서버 오류가 발생했습니다. (${response.status})`,
      };
    }
    return body;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { success: false, message: "네트워크 오류가 발생했습니다." };
  }
}
'''
wrapper = replace_once(wrapper, old_wrapper_call, new_wrapper_call, "wrapper typed call")
wrapper = wrapper.replace(
    "return callApi(action, retryPayload);",
    "return callApi(action, retryPayload as ReservationApiPayload<typeof action>);",
)
wrapper = replace_once(
    wrapper,
    '''  base.invalidatePatientsCache();
  base.invalidatePatientsSummaryCache();
  const savedPatientId = cleanText(result.patientId || patientId);
''',
    '''  const savedPatientId = cleanText(result.patientId || patientId);
  base.invalidateReservationDerivedCaches(savedPatientId);
''',
    "wrapper create cache invalidation",
)
write("lib/reservations.ts", wrapper)

# Payloads sent by existing clients include canonical IDs as redundant integrity hints.
contracts = read("lib/reservationApiContracts.ts")
contracts = replace_once(
    contracts,
    '''  update: {
    reservationDocId: string;
    reservationId?: string;
    reservationPatch: JsonRecord;
  };
''',
    '''  update: {
    reservationDocId: string;
    reservationId?: string;
    patientId?: string;
    reservationPatch: JsonRecord;
  };
''',
    "update contract patient id",
)
write("lib/reservationApiContracts.ts", contracts)

# ---------------------------------------------------------------------------
# Harden create patient ID handling and switch reservation writes to incremental
# summary maintenance.
# ---------------------------------------------------------------------------
create = read("lib/server/reservations/commands/createReservation.ts")
create = replace_once(
    create,
    'import { NextResponse } from "next/server";\n',
    'import { randomUUID } from "node:crypto";\nimport { NextResponse } from "next/server";\n',
    "create uuid import",
)
create = replace_once(
    create,
    '''import {
  createEmptyPatientSummary,
  recomputeReservationSummary,
  safeRecompute,
} from "@/lib/patientSummary";
''',
    '''import {
  createEmptyPatientSummary,
  safeRecompute,
  updateReservationSummaryIncrementally,
} from "@/lib/patientSummary";
import type { ReservationApiPayload } from "@/lib/reservationApiContracts";
''',
    "create summary import",
)
create = replace_once(
    create,
    '''class DuplicateReservationError extends Error {}
class PatientDeletedError extends Error {}
''',
    '''class DuplicateReservationError extends Error {}
class PatientDeletedError extends Error {}

function makeGeneratedPatientId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `P-${date}-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}
''',
    "generated patient id helper",
)
create = replace_once(
    create,
    '''export async function createReservationCommand(
  payload: Record<string, unknown>,
  ctx: ReservationCommandContext
) {
  const { patient, reservation } = payload as {
    patient: Record<string, unknown>;
    reservation: Record<string, unknown>;
  };
  const responsePatientId = String(reservation?.patientId || "");
''',
    '''export async function createReservationCommand(
  payload: ReservationApiPayload<"create">,
  ctx: ReservationCommandContext
) {
  const patient = payload.patient;
  const reservation = payload.reservation;
  if (!patient || typeof patient !== "object" || !reservation || typeof reservation !== "object") {
    return NextResponse.json(
      { success: false, code: "INVALID_PAYLOAD", message: "patient/reservation 객체가 필요합니다." },
      { status: 400 }
    );
  }
''',
    "create typed signature",
)
create = replace_once(
    create,
    '''  const patientId = String(safePatient.patientId || "");
  const reservationPatientId = String(safeReservation.patientId || "");
  if (reservationPatientId && patientId && reservationPatientId !== patientId) {
    return NextResponse.json(
      {
        success: false,
        code: "PATIENT_ID_MISMATCH",
        message: "환자 식별자가 일치하지 않습니다.",
      },
      { status: 400 }
    );
  }
  safeReservation.patientId = patientId;
''',
    '''  const patientPatientId = String(safePatient.patientId || "").trim();
  const reservationPatientId = String(safeReservation.patientId || "").trim();
  if (reservationPatientId && patientPatientId && reservationPatientId !== patientPatientId) {
    return NextResponse.json(
      {
        success: false,
        code: "PATIENT_ID_MISMATCH",
        message: "환자 식별자가 일치하지 않습니다.",
      },
      { status: 400 }
    );
  }
  const canonicalPatientId = patientPatientId || reservationPatientId || makeGeneratedPatientId();
  safePatient.patientId = canonicalPatientId;
  safeReservation.patientId = canonicalPatientId;
''',
    "canonical patient id",
)
create = replace_once(
    create,
    '''  let resultPatientDocId = "";
  let linkedExistingPatient = false;
  let staleLockRepaired = false;
''',
    '''  let resultPatientDocId = "";
  let resultPatientId = canonicalPatientId;
  let createdReservationData: Record<string, unknown> | null = null;
  let linkedExistingPatient = false;
  let staleLockRepaired = false;
''',
    "create outcome variables",
)
create = replace_once(create, '      let canonicalPatientId = "";\n', '      let linkedPatientId = "";\n', "inner canonical rename")
create = create.replace("canonicalPatientId = String(\n", "linkedPatientId = String(\n")
create = create.replace("canonicalPatientId = linkToPatientId;", "linkedPatientId = linkToPatientId;")
create = replace_once(
    create,
    '''      if (canonicalPatientId) safeReservation.patientId = canonicalPatientId;

      const afterReservation = {
''',
    '''      if (linkedPatientId) {
        safeReservation.patientId = linkedPatientId;
        resultPatientId = linkedPatientId;
      }

      const afterReservation = {
''',
    "linked patient canonicalization",
)
create = replace_once(
    create,
    '''      const afterReservation = {
        ...reservationDefaults,
        ...safeReservation,
        ...deriveGroupKeysPatch(safeReservation),
        isDeleted: false,
      };

      await syncReservationAmountRowsInTx''',
    '''      const afterReservation = {
        ...reservationDefaults,
        ...safeReservation,
        ...deriveGroupKeysPatch(safeReservation),
        isDeleted: false,
      };
      createdReservationData = afterReservation;

      await syncReservationAmountRowsInTx''',
    "capture created reservation",
)
create = replace_once(
    create,
    '''  await safeRecompute(
    () => recomputeReservationSummary(String(safeReservation.patientId || "")),
    "create/reservation",
    String(safeReservation.patientId || "")
  );
''',
    '''  await safeRecompute(
    () => updateReservationSummaryIncrementally({
      patientId: resultPatientId,
      reservationDocId: reservationRef.id,
      before: null,
      after: createdReservationData,
    }),
    "create/reservation",
    resultPatientId
  );
''',
    "create incremental summary",
)
create = create.replace("    patientId: responsePatientId,", "    patientId: resultPatientId,")
write("lib/server/reservations/commands/createReservation.ts", create)

update = read("lib/server/reservations/commands/updateReservation.ts")
update = replace_once(
    update,
    'import { recomputeReservationSummary, safeRecompute } from "@/lib/patientSummary";\n',
    'import { safeRecompute, updateReservationSummaryIncrementally } from "@/lib/patientSummary";\n'
    'import type { ReservationApiPayload } from "@/lib/reservationApiContracts";\n',
    "update summary import",
)
update = replace_once(
    update,
    '''export async function updateReservationCommand(
  payload: Record<string, unknown>,
  ctx: ReservationCommandContext
) {
  const { reservationDocId, reservationPatch } = payload as {
    reservationDocId: string;
    reservationPatch: Record<string, unknown>;
  };
''',
    '''export async function updateReservationCommand(
  payload: ReservationApiPayload<"update">,
  ctx: ReservationCommandContext
) {
  const { reservationDocId, reservationPatch } = payload;
''',
    "update typed signature",
)
update = replace_once(
    update,
    '''        canonicalReservationId: string;
        staleLockRepaired: boolean;
      }
''',
    '''        canonicalReservationId: string;
        staleLockRepaired: boolean;
        beforeData: Record<string, unknown>;
        afterData: Record<string, unknown>;
      }
''',
    "update outcome data type",
)
update = replace_once(
    update,
    '''      canonicalReservationId,
      staleLockRepaired,
    };
''',
    '''      canonicalReservationId,
      staleLockRepaired,
      beforeData,
      afterData: effectiveNew,
    };
''',
    "update outcome data",
)
update = replace_once(
    update,
    '''  await safeRecompute(
    () => recomputeReservationSummary(outcome.canonicalPatientId),
    "update/reservation",
    outcome.canonicalPatientId
  );
''',
    '''  await safeRecompute(
    () => updateReservationSummaryIncrementally({
      patientId: outcome.canonicalPatientId,
      reservationDocId,
      before: outcome.beforeData,
      after: outcome.afterData,
    }),
    "update/reservation",
    outcome.canonicalPatientId
  );
''',
    "update incremental summary",
)
write("lib/server/reservations/commands/updateReservation.ts", update)

delete = read("lib/server/reservations/commands/deleteReservation.ts")
delete = replace_once(
    delete,
    'import { recomputeReservationSummary, safeRecompute } from "@/lib/patientSummary";\n',
    'import { safeRecompute, updateReservationSummaryIncrementally } from "@/lib/patientSummary";\n',
    "delete summary import",
)
delete = replace_once(
    delete,
    '''  await safeRecompute(
    () => recomputeReservationSummary(patientId),
    "delete/reservation",
    patientId
  );
''',
    '''  await safeRecompute(
    () => updateReservationSummaryIncrementally({
      patientId,
      reservationDocId,
      before: deletedData,
      after: null,
    }),
    "delete/reservation",
    patientId
  );
''',
    "delete incremental summary",
)
write("lib/server/reservations/commands/deleteReservation.ts", delete)

# ---------------------------------------------------------------------------
# Incremental patient reservation summary. Full recomputation remains for
# bootstrap/backfill/dirty reconciliation only.
# ---------------------------------------------------------------------------
summary = read("lib/patientSummary.ts")
summary = replace_once(
    summary,
    '''    lastReservationAt: "",
    reservationCountCapped: false,
''',
    '''    lastReservationAt: "",
    lastReservationDocId: "",
    reservationCountCapped: false,
''',
    "empty summary last doc",
)
summary = replace_once(
    summary,
    '''  let lastReservationTime = "";
  let lastComposite = "";
''',
    '''  let lastReservationTime = "";
  let lastReservationDocId = "";
  let lastComposite = "";
''',
    "recompute last doc variable",
)
summary = replace_once(
    summary,
    '''    const composite = `${date} ${time}`;
    if (composite > lastComposite) {
      lastComposite = composite;
      lastReservationDate = date;
      lastReservationTime = time;
    }
''',
    '''    const composite = `${date} ${time}\\u0000${d.id}`;
    if (composite > lastComposite) {
      lastComposite = composite;
      lastReservationDate = date;
      lastReservationTime = time;
      lastReservationDocId = d.id;
    }
''',
    "recompute latest selection",
)
summary = replace_once(
    summary,
    '''    lastReservationAt: lastReservationDate ? `${lastReservationDate} ${lastReservationTime}`.trim() : "",
    reservationCountCapped: snap.docs.length > RESERVATION_CAP,
''',
    '''    lastReservationAt: lastReservationDate ? `${lastReservationDate} ${lastReservationTime}`.trim() : "",
    lastReservationDocId,
    reservationCountCapped: snap.docs.length > RESERVATION_CAP,
''',
    "recompute latest patch",
)

incremental_code = r'''

type ReservationSummaryMutation = {
  patientId: string;
  reservationDocId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

function isActiveReservation(record: Record<string, unknown> | null): record is Record<string, unknown> {
  return Boolean(record) && record?.isDeleted !== true;
}

function reservationDisplayKey(record: Record<string, unknown> | null): string {
  if (!record) return "";
  return `${String(record.reservationDate || "")} ${String(record.reservationTime || "")}`.trim();
}

function reservationSortKey(record: Record<string, unknown> | null, docId: string): string {
  const display = reservationDisplayKey(record);
  return display ? `${display}\u0000${docId}` : "";
}

function latestReservationPatch(
  record: Record<string, unknown> | null,
  reservationDocId: string
): Record<string, unknown> {
  if (!record) {
    return {
      lastReservationDate: "",
      lastReservationTime: "",
      lastReservationAt: "",
      lastReservationDocId: "",
    };
  }
  const date = String(record.reservationDate || "");
  const time = String(record.reservationTime || "");
  return {
    lastReservationDate: date,
    lastReservationTime: time,
    lastReservationAt: date ? `${date} ${time}`.trim() : "",
    lastReservationDocId: reservationDocId,
  };
}

/**
 * 정상 create/update/delete 경로의 예약 요약을 before/after 차이로 갱신한다.
 * 최신 예약이 삭제되거나 과거로 이동한 경우에만 최신 후보 1건을 조회한다.
 * 301건 전체 재조회는 초기 요약이 없는 레거시 환자와 repair/reconcile에서만 사용한다.
 */
export async function updateReservationSummaryIncrementally(
  mutation: ReservationSummaryMutation
): Promise<void> {
  const patientId = String(mutation.patientId || "").trim();
  if (!patientId) return;

  const beforeActive = isActiveReservation(mutation.before);
  const afterActive = isActiveReservation(mutation.after);
  const countDelta = Number(afterActive) - Number(beforeActive);
  const depositDelta = (afterActive ? parseAmount(mutation.after.depositAmount) : 0)
    - (beforeActive ? parseAmount(mutation.before.depositAmount) : 0);
  const surgeryDelta = (afterActive ? parseAmount(mutation.after.surgeryCost) : 0)
    - (beforeActive ? parseAmount(mutation.before.surgeryCost) : 0);

  const [depositCountSnap, surgeryCountSnap] = await Promise.all([
    adminDb.collection(PATIENT_AMOUNT_ROWS)
      .where("patientId", "==", patientId)
      .where("type", "==", "deposit")
      .count()
      .get(),
    adminDb.collection(PATIENT_AMOUNT_ROWS)
      .where("patientId", "==", patientId)
      .where("type", "==", "surgery")
      .count()
      .get(),
  ]);

  const patientQuery = adminDb.collection("patients").where("patientId", "==", patientId);
  const outcome = await adminDb.runTransaction<"ok" | "missing" | "bootstrap">(async (tx) => {
    const patientSnap = await tx.get(patientQuery);
    if (patientSnap.empty) return "missing";

    const reference = patientSnap.docs[0].data() as Record<string, unknown>;
    if (
      typeof reference.reservationCount !== "number" ||
      typeof reference.totalDepositAmount !== "number" ||
      typeof reference.totalSurgeryCost !== "number"
    ) {
      return "bootstrap";
    }

    const currentDisplayKey = `${String(reference.lastReservationDate || "")} ${String(reference.lastReservationTime || "")}`.trim();
    const currentDocId = String(reference.lastReservationDocId || "");
    const currentSortKey = currentDisplayKey
      ? `${currentDisplayKey}\u0000${currentDocId}`
      : "";
    const beforeDisplayKey = beforeActive ? reservationDisplayKey(mutation.before) : "";
    const beforeSortKey = beforeActive
      ? reservationSortKey(mutation.before, mutation.reservationDocId)
      : "";
    const afterSortKey = afterActive
      ? reservationSortKey(mutation.after, mutation.reservationDocId)
      : "";

    const mutationWasCurrent = beforeActive && (
      currentDocId
        ? currentDocId === mutation.reservationDocId
        : beforeDisplayKey === currentDisplayKey
    );
    const movedCurrentBackward = mutationWasCurrent && (
      !afterActive || afterSortKey < beforeSortKey
    );

    let latestPatch: Record<string, unknown> | null = null;
    if (movedCurrentBackward) {
      const latestSnap = await tx.get(
        adminDb.collection("reservations")
          .where("patientId", "==", patientId)
          .where("isDeleted", "==", false)
          .orderBy("reservationDate", "desc")
          .orderBy("reservationTime", "desc")
          .limit(1)
      );
      const latest = latestSnap.docs[0];
      latestPatch = latest
        ? latestReservationPatch(latest.data() as Record<string, unknown>, latest.id)
        : latestReservationPatch(null, "");
    } else if (afterActive && afterSortKey >= currentSortKey) {
      latestPatch = latestReservationPatch(mutation.after, mutation.reservationDocId);
    }

    for (const patientDoc of patientSnap.docs) {
      const data = patientDoc.data() as Record<string, unknown>;
      const currentCount = Number(data.reservationCount || 0);
      const wasCapped = data.reservationCountCapped === true;
      const rawNextCount = Math.max(0, currentCount + countDelta);
      const nextCapped = wasCapped || rawNextCount > RESERVATION_CAP;
      const nextCount = nextCapped ? Math.min(RESERVATION_CAP, rawNextCount || RESERVATION_CAP) : rawNextCount;
      const patch: Record<string, unknown> = {
        reservationCount: nextCount,
        reservationCountCapped: nextCapped,
        depositCount: depositCountSnap.data().count,
        surgeryCostCount: surgeryCountSnap.data().count,
        totalDepositAmount: Math.max(0, Number(data.totalDepositAmount || 0) + depositDelta),
        totalSurgeryCost: Math.max(0, Number(data.totalSurgeryCost || 0) + surgeryDelta),
        summaryUpdatedAt: FieldValue.serverTimestamp(),
      };

      if (latestPatch) Object.assign(patch, latestPatch);
      if (nextCount === 0) Object.assign(patch, latestReservationPatch(null, ""));

      // 300건 초과 레거시 환자는 즉시 전체 스캔하지 않고 reconcile 대상으로 표시한다.
      if (wasCapped && countDelta !== 0) {
        patch.summaryDirty = true;
        patch.summaryDirtyDomains = FieldValue.arrayUnion("reservation");
        patch.summaryDirtyAt = FieldValue.serverTimestamp();
        patch.summaryDirtyVersion = FieldValue.increment(1);
        patch.summaryDirtyLastError = "incremental/capped-reservation";
      }
      tx.update(patientDoc.ref, patch);
    }
    return "ok";
  });

  if (outcome === "bootstrap") {
    await recomputeReservationSummary(patientId);
  }
}
'''
summary = replace_once(
    summary,
    '\n// 인보이스 요약: 뷰어 권한 무관 총 개수(count() 집계 — 문서 안 읽음).\n',
    incremental_code + '\n// 인보이스 요약: 뷰어 권한 무관 총 개수(count() 집계 — 문서 안 읽음).\n',
    "insert incremental summary",
)
write("lib/patientSummary.ts", summary)

# Add the latest-candidate composite index used only on latest delete/date regression.
index_path = ROOT / "firestore.indexes.json"
indexes = json.loads(index_path.read_text())
latest_index = {
    "collectionGroup": "reservations",
    "queryScope": "COLLECTION",
    "fields": [
        {"fieldPath": "patientId", "order": "ASCENDING"},
        {"fieldPath": "isDeleted", "order": "ASCENDING"},
        {"fieldPath": "reservationDate", "order": "DESCENDING"},
        {"fieldPath": "reservationTime", "order": "DESCENDING"},
    ],
}
if latest_index not in indexes["indexes"]:
    indexes["indexes"].append(latest_index)
index_path.write_text(json.dumps(indexes, ensure_ascii=False, indent=2) + "\n")

# ---------------------------------------------------------------------------
# Regression coverage.
# ---------------------------------------------------------------------------
tests = read("tests/api/reservations.test.ts")
append = r'''

test("delete: 존재하지 않는 예약은 404 RESERVATION_NOT_FOUND이고 문서를 만들지 않는다", async () => {
  __resetStaffCacheForTests();
  const id = `missing-delete-${Date.now()}`;
  const res = await POST(makeReq(admin.idToken, "delete", { reservationDocId: id }));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.code, "RESERVATION_NOT_FOUND");
  assert.equal((await adminDb.collection("reservations").doc(id).get()).exists, false);
});

test("toggleSurgery: 존재하지 않는 예약은 404 RESERVATION_NOT_FOUND", async () => {
  __resetStaffCacheForTests();
  const res = await POST(makeReq(staff.idToken, "toggleSurgery", {
    reservationDocId: `missing-toggle-${Date.now()}`,
    surgeryReserved: true,
  }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "RESERVATION_NOT_FOUND");
});

test("create: patient 쪽 patientId만 있어도 예약과 환자에 같은 canonical ID를 저장한다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-ONLY-PATIENT-${Date.now()}`;
  const res = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "환자ID", patientId },
    reservation: { reservationId: `R-ONLY-PATIENT-${Date.now()}`, name: "환자ID", reservationDate: "2026-10-01", doctors: [], isDeleted: false },
  }));
  const body = await res.json();
  assert.equal(body.success, true);
  createdReservationDocIds.push(body.reservationDocId);
  createdPatientDocIds.push(body.patientDocId);
  assert.equal(body.patientId, patientId);
  assert.equal((await adminDb.collection("reservations").doc(body.reservationDocId).get()).data()?.patientId, patientId);
  assert.equal((await adminDb.collection("patients").doc(body.patientDocId).get()).data()?.patientId, patientId);
});

test("create: reservation 쪽 patientId만 있어도 환자와 예약에 같은 canonical ID를 저장한다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-ONLY-RESERVATION-${Date.now()}`;
  const res = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "예약ID" },
    reservation: { reservationId: `R-ONLY-RESERVATION-${Date.now()}`, patientId, name: "예약ID", reservationDate: "2026-10-02", doctors: [], isDeleted: false },
  }));
  const body = await res.json();
  assert.equal(body.success, true);
  createdReservationDocIds.push(body.reservationDocId);
  createdPatientDocIds.push(body.patientDocId);
  assert.equal(body.patientId, patientId);
  assert.equal((await adminDb.collection("reservations").doc(body.reservationDocId).get()).data()?.patientId, patientId);
  assert.equal((await adminDb.collection("patients").doc(body.patientDocId).get()).data()?.patientId, patientId);
});

test("create: 양쪽 patientId가 비어도 서버가 canonical ID를 생성해 고아 예약을 막는다", async () => {
  __resetStaffCacheForTests();
  const name = `서버ID${Date.now()}`;
  const res = await POST(makeReq(staff.idToken, "create", {
    patient: { name },
    reservation: { reservationId: `R-SERVER-ID-${Date.now()}`, name, reservationDate: "2026-10-03", doctors: [], isDeleted: false },
  }));
  const body = await res.json();
  assert.equal(body.success, true);
  assert.match(body.patientId, /^P-\d{8}-[a-f0-9]{10}$/);
  createdReservationDocIds.push(body.reservationDocId);
  createdPatientDocIds.push(body.patientDocId);
  const reservation = (await adminDb.collection("reservations").doc(body.reservationDocId).get()).data()!;
  const patient = (await adminDb.collection("patients").doc(body.patientDocId).get()).data()!;
  assert.equal(reservation.patientId, body.patientId);
  assert.equal(patient.patientId, body.patientId);
});

for (const action of ["read_one", "read_by_date", "not_a_real_action"]) {
  test(`${action}: 제거되거나 알 수 없는 action은 400 UNKNOWN_ACTION`, async () => {
    __resetStaffCacheForTests();
    const res = await POST(makeReq(staff.idToken, action, {}));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "UNKNOWN_ACTION");
  });
}

test("incremental summary: 금액 변경과 최신 예약 날짜 후퇴/삭제를 전체 스캔 없이 반영한다", async () => {
  __resetStaffCacheForTests();
  const patientId = `P-INCREMENTAL-${Date.now()}`;
  const first = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "증분요약", patientId },
    reservation: {
      reservationId: `R-INCREMENTAL-1-${Date.now()}`, patientId, name: "증분요약",
      reservationDate: "2026-11-10", reservationTime: "09:00", depositAmount: "100000",
      surgeryCost: "1000000", hospital: "ARC", consultArea: "눈", doctors: ["김원장"], isDeleted: false,
    },
  }));
  const firstBody = await first.json();
  assert.equal(firstBody.success, true);
  createdReservationDocIds.push(firstBody.reservationDocId);
  createdPatientDocIds.push(firstBody.patientDocId);

  const second = await POST(makeReq(staff.idToken, "create", {
    patient: { name: "증분요약", patientId },
    reservation: {
      reservationId: `R-INCREMENTAL-2-${Date.now()}`, patientId, name: "증분요약",
      reservationDate: "2026-11-20", reservationTime: "10:00", depositAmount: "200000",
      surgeryCost: "2000000", hospital: "ARC", consultArea: "코", doctors: ["김원장"], isDeleted: false,
    },
  }));
  const secondBody = await second.json();
  assert.equal(secondBody.success, true);
  createdReservationDocIds.push(secondBody.reservationDocId);

  let patient = (await adminDb.collection("patients").doc(firstBody.patientDocId).get()).data()!;
  assert.equal(patient.reservationCount, 2);
  assert.equal(patient.totalDepositAmount, 300000);
  assert.equal(patient.totalSurgeryCost, 3000000);
  assert.equal(patient.lastReservationDate, "2026-11-20");
  assert.equal(patient.lastReservationDocId, secondBody.reservationDocId);

  const moved = await POST(makeReq(staff.idToken, "update", {
    reservationDocId: secondBody.reservationDocId,
    reservationPatch: {
      name: "증분요약", reservationDate: "2026-11-01", reservationTime: "10:00",
      depositAmount: "250000", surgeryCost: "2500000",
    },
  }));
  assert.equal(moved.status, 200);

  patient = (await adminDb.collection("patients").doc(firstBody.patientDocId).get()).data()!;
  assert.equal(patient.reservationCount, 2);
  assert.equal(patient.totalDepositAmount, 350000);
  assert.equal(patient.totalSurgeryCost, 3500000);
  assert.equal(patient.lastReservationDate, "2026-11-10");
  assert.equal(patient.lastReservationDocId, firstBody.reservationDocId);

  const deleted = await POST(makeReq(admin.idToken, "delete", { reservationDocId: firstBody.reservationDocId }));
  assert.equal(deleted.status, 200);
  patient = (await adminDb.collection("patients").doc(firstBody.patientDocId).get()).data()!;
  assert.equal(patient.reservationCount, 1);
  assert.equal(patient.totalDepositAmount, 250000);
  assert.equal(patient.totalSurgeryCost, 2500000);
  assert.equal(patient.lastReservationDate, "2026-11-01");
  assert.equal(patient.lastReservationDocId, secondBody.reservationDocId);
});
'''
if 'delete: 존재하지 않는 예약은 404 RESERVATION_NOT_FOUND' not in tests:
    tests += append
write("tests/api/reservations.test.ts", tests)

print("reservation consistency v2 transformations applied")
