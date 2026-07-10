from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, got {count}")
    return text.replace(old, new, 1)


# Generated patient IDs must keep the legacy name/phone duplicate identity so
# concurrent creates without a supplied patientId still contend on one lock.
locks = read("lib/reservationLocks.ts")
locks = replace_once(
    locks,
    '''function computeIdentityKey(r: Record<string, unknown>): string {
  const patientId = normalizeText(r.patientId);
  if (patientId) return `pid:${patientId}`;
  const name = normalizeText(r.name ?? r.patientName);
''',
    '''function computeIdentityKey(r: Record<string, unknown>): string {
  // 서버가 빈 patientId를 보완해 생성한 환자는 원 요청의 name+phone identity를 유지한다.
  // 그렇지 않으면 동시에 들어온 동일 예약이 서로 다른 무작위 patientId lock을 사용하게 된다.
  if (r.patientIdGenerated !== true) {
    const patientId = normalizeText(r.patientId);
    if (patientId) return `pid:${patientId}`;
  }
  const name = normalizeText(r.name ?? r.patientName);
''',
    "generated patient lock identity",
)
write("lib/reservationLocks.ts", locks)


create = read("lib/server/reservations/commands/createReservation.ts")
create = replace_once(
    create,
    '''  const canonicalPatientId = patientPatientId || reservationPatientId || makeGeneratedPatientId();
  safePatient.patientId = canonicalPatientId;
  safeReservation.patientId = canonicalPatientId;
''',
    '''  const patientIdGenerated = !patientPatientId && !reservationPatientId;
  const canonicalPatientId = patientPatientId || reservationPatientId || makeGeneratedPatientId();
  safePatient.patientId = canonicalPatientId;
  safePatient.patientIdGenerated = patientIdGenerated;
  safeReservation.patientId = canonicalPatientId;
  safeReservation.patientIdGenerated = patientIdGenerated;
''',
    "create generated patient marker",
)
create = replace_once(
    create,
    '''  const reservationId = String(safeReservation.reservationId || "");
  const lockId = lockIdForReservation(safeReservation);
  const lockRef = lockId
    ? adminDb.collection(RESERVATION_LOCKS).doc(lockId)
    : null;
  const now = FieldValue.serverTimestamp();
''',
    '''  const reservationId = String(safeReservation.reservationId || "");
  const now = FieldValue.serverTimestamp();
''',
    "defer create lock calculation",
)
create = replace_once(
    create,
    '''  let linkedExistingPatient = false;
  let staleLockRepaired = false;
''',
    '''  let linkedExistingPatient = false;
  let staleLockRepaired = false;
  let resultLockId = "";
''',
    "create result lock id",
)
create = replace_once(
    create,
    '''      if (lockRef) {
        const lockSnap = await tx.get(lockRef);
        if (lockSnap.exists) {
          const targetDocId = String(lockSnap.data()?.reservationDocId || "");
          let targetData: Record<string, unknown> | null = null;
          if (targetDocId) {
            const targetSnap = await tx.get(
              adminDb.collection("reservations").doc(targetDocId)
            );
            targetData = targetSnap.exists
              ? (targetSnap.data() as Record<string, unknown>)
              : null;
          }
          if (!isLockStale(lockId, targetData)) {
            throw new DuplicateReservationError();
          }
          staleLockRepaired = true;
        }
      }

''',
    '''''',
    "remove early create lock read",
)
create = replace_once(
    create,
    '''        if (!patientSnap.empty) {
          if (patientSnap.docs[0].data().isDeleted === true) {
            throw new PatientDeletedError();
          }
          existingPatientDocId = patientSnap.docs[0].id;
          linkedPatientId = String(
            patientSnap.docs[0].data().patientId || incomingPatientId
          );
        }
''',
    '''        if (!patientSnap.empty) {
          const existingPatientData = patientSnap.docs[0].data() as Record<string, unknown>;
          if (existingPatientData.isDeleted === true) {
            throw new PatientDeletedError();
          }
          existingPatientDocId = patientSnap.docs[0].id;
          linkedPatientId = String(existingPatientData.patientId || incomingPatientId);
          if (existingPatientData.patientIdGenerated === true) {
            safePatient.patientIdGenerated = true;
            safeReservation.patientIdGenerated = true;
          }
        }
''',
    "existing generated patient marker",
)
create = replace_once(
    create,
    '''          if (!linkedPatient.empty) {
            existingPatientDocId = linkedPatient.docs[0].id;
            linkedPatientId = linkToPatientId;
          }
''',
    '''          if (!linkedPatient.empty) {
            const linkedPatientData = linkedPatient.docs[0].data() as Record<string, unknown>;
            existingPatientDocId = linkedPatient.docs[0].id;
            linkedPatientId = linkToPatientId;
            if (linkedPatientData.patientIdGenerated === true) {
              safePatient.patientIdGenerated = true;
              safeReservation.patientIdGenerated = true;
            }
          }
''',
    "linked generated patient marker",
)
create = replace_once(
    create,
    '''      if (linkedPatientId) {
        safeReservation.patientId = linkedPatientId;
        resultPatientId = linkedPatientId;
      }

      const afterReservation = {
''',
    '''      if (linkedPatientId) {
        safePatient.patientId = linkedPatientId;
        safeReservation.patientId = linkedPatientId;
        resultPatientId = linkedPatientId;
      }

      // canonical 환자 연결과 generated-ID 정책이 결정된 뒤 중복 lock을 계산한다.
      const lockId = lockIdForReservation(safeReservation);
      resultLockId = lockId;
      const lockRef = lockId
        ? adminDb.collection(RESERVATION_LOCKS).doc(lockId)
        : null;
      if (lockRef) {
        const lockSnap = await tx.get(lockRef);
        if (lockSnap.exists) {
          const targetDocId = String(lockSnap.data()?.reservationDocId || "");
          let targetData: Record<string, unknown> | null = null;
          if (targetDocId) {
            const targetSnap = await tx.get(
              adminDb.collection("reservations").doc(targetDocId)
            );
            targetData = targetSnap.exists
              ? (targetSnap.data() as Record<string, unknown>)
              : null;
          }
          if (!isLockStale(lockId, targetData)) {
            throw new DuplicateReservationError();
          }
          staleLockRepaired = true;
        }
      }

      const afterReservation = {
''',
    "canonical create lock calculation",
)
create = replace_once(
    create,
    '''            patientId: incomingPatientId,
            lockId,
''',
    '''            patientId: resultPatientId,
            lockId,
''',
    "canonical lock document patient id",
)
create = create.replace("after: { lockId, reservationDocId: reservationRef.id },", "after: { lockId: resultLockId, reservationDocId: reservationRef.id },")
write("lib/server/reservations/commands/createReservation.ts", create)


update = read("lib/server/reservations/commands/updateReservation.ts")
update = replace_once(
    update,
    '''  return NextResponse.json({ success: true });
''',
    '''  return NextResponse.json({ success: true, patientId: outcome.canonicalPatientId });
''',
    "update canonical patient response",
)
write("lib/server/reservations/commands/updateReservation.ts", update)


base = read("lib/reservationsBase.ts")
base = replace_once(
    base,
    '''  invalidateReservationDerivedCaches(patientId);
  return { success: true };
}

export async function createPatientOnly''',
    '''  const canonicalPatientId = cleanText(apiResult.patientId) || cleanText(patientId);
  invalidateReservationDerivedCaches(canonicalPatientId);
  return { success: true };
}

export async function createPatientOnly''',
    "amount canonical cache invalidation",
)
base = replace_once(
    base,
    '''  // 감사로그는 서버(/api/reservations toggleSurgery)에서 권위 있게 기록됨 → 클라 createLog 제거.

  return { success: true };
}
''',
    '''  // 감사로그는 서버(/api/reservations toggleSurgery)에서 권위 있게 기록됨 → 클라 createLog 제거.
  const canonicalPatientId = cleanText(apiResult.patientId);
  if (canonicalPatientId) invalidateReservationDerivedCaches(canonicalPatientId);

  return { success: true };
}
''',
    "toggle cache invalidation",
)
base = replace_once(
    base,
    '''  invalidateReservationDerivedCaches(patientId);
  return { success: true };
}

export async function searchReservationsByDateRange''',
    '''  const canonicalPatientId = cleanText(apiResult.patientId) || cleanText(patientId);
  invalidateReservationDerivedCaches(canonicalPatientId);
  return { success: true };
}

export async function searchReservationsByDateRange''',
    "update canonical cache invalidation",
)
base = base.replace(
    "// Alias kept for existing callsites in this file and reservationsSafe.ts",
    "// Backward-compatible export name retained for existing callsites.",
)
write("lib/reservationsBase.ts", base)


summary = read("lib/patientSummary.ts")
summary = replace_once(
    summary,
    '''      const rawNextCount = Math.max(0, currentCount + countDelta);
      const nextCapped = wasCapped || rawNextCount > RESERVATION_CAP;
      const nextCount = nextCapped ? Math.min(RESERVATION_CAP, rawNextCount || RESERVATION_CAP) : rawNextCount;
''',
    '''      const rawNextCount = Math.max(0, currentCount + countDelta);
      const nextCapped = wasCapped || rawNextCount > RESERVATION_CAP;
      // 이미 capped인 환자는 정확한 실제 건수를 모르므로 reconcile 전까지 표시값 300을 유지한다.
      const nextCount = wasCapped
        ? RESERVATION_CAP
        : Math.min(RESERVATION_CAP, rawNextCount);
''',
    "capped incremental count",
)
write("lib/patientSummary.ts", summary)

print("reservation consistency v2 final fixes applied")
