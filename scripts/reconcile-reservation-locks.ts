/**
 * 정합성 점검/보정: reservationLocks가 실제 예약 상태와 일치하는지 검사하고,
 * 안전한 경우에만 보정한다. dupKey·lockId 규칙은 lib/reservationLocks.ts와 동일하게 공유한다.
 *
 * 옵션:
 *   --dry-run  (기본) DB 수정 없이 검출만
 *   --apply    stale lock 삭제 + 누락 lock 생성만 적용(충돌/소유권 불일치는 보고만)
 *   --project <id> / --key <serviceAccount.json 경로>
 *
 * 검사:
 *   - 존재하지 않는/삭제된/취소된 예약을 가리키는 lock  → stale(삭제 후보)
 *   - 활성 예약인데 lock 없음                          → missing(생성 후보)
 *   - 같은 dupKey의 활성 예약이 2건 이상                → conflict(자동수정 금지, 보고만)
 *   - lock 소유권 불일치                               → ownership mismatch(자동수정 금지, 보고만)
 *
 * 안전: 기본 dry-run. conflict/ownership mismatch는 절대 자동 수정하지 않는다.
 */
import * as admin from "firebase-admin";
import { readFileSync } from "node:fs";
import {
  RESERVATION_LOCKS,
  computeDupKey,
  lockIdForDupKey,
  hasDupKeyComponents,
  isReservationActive,
} from "../lib/reservationLocks";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;
const BATCH_LIMIT = 400;

function getServiceAccountJsonOrNull(): string | null {
  const idx = process.argv.indexOf("--key");
  if (idx !== -1) {
    const path = process.argv[idx + 1];
    if (!path) throw new Error("--key 다음에 serviceAccount.json 파일 경로를 지정하세요.");
    return readFileSync(path, "utf8");
  }
  return process.env.FIREBASE_SERVICE_ACCOUNT_KEY || null;
}

function init() {
  if (admin.apps.length) return;
  const key = getServiceAccountJsonOrNull();
  if (key) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key) as admin.ServiceAccount) });
    return;
  }
  const projIdx = process.argv.indexOf("--project");
  const projectId = projIdx !== -1 ? process.argv[projIdx + 1] : process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  admin.initializeApp(projectId ? { projectId } : undefined);
}

type DeleteCandidate = { lockDocId: string };
type CreateCandidate = { lockDocId: string; reservationDocId: string; reservationId: string; patientId: string };

async function main() {
  init();
  const db = admin.firestore();

  const [locksSnap, resSnap] = await Promise.all([
    db.collection(RESERVATION_LOCKS).get(),
    db.collection("reservations").get(),
  ]);

  // 예약 인덱스(삭제/취소 포함 — lock target 조회에 필요).
  const resById = new Map<string, admin.firestore.DocumentData>();
  for (const d of resSnap.docs) resById.set(d.id, d.data());

  const stats = {
    checkedLocks: locksSnap.size,
    staleLocks: 0,
    missingLocks: 0,
    ownershipMismatches: 0,
    conflicts: 0,
    wouldDeleteLocks: 0,
    wouldCreateLocks: 0,
    appliedDeletes: 0,
    appliedCreates: 0,
  };

  const locksById = new Map<string, admin.firestore.DocumentData>();
  for (const d of locksSnap.docs) locksById.set(d.id, d.data());

  const deleteCandidates: DeleteCandidate[] = [];
  const createCandidates: CreateCandidate[] = [];

  // ── stale lock 검출 ──────────────────────────────────────────────
  for (const d of locksSnap.docs) {
    const lock = d.data();
    const target = resById.get(String(lock.reservationDocId || ""));
    if (!isReservationActive(target)) {
      stats.staleLocks += 1;
      deleteCandidates.push({ lockDocId: d.id });
    }
  }

  // ── 활성 예약별 기대 lock 및 충돌 검출 ─────────────────────────────
  const activeByLockId = new Map<string, string[]>(); // lockId -> [reservationDocId]
  for (const d of resSnap.docs) {
    const r = d.data();
    if (!isReservationActive(r) || !hasDupKeyComponents(r)) continue;
    const lockId = lockIdForDupKey(computeDupKey(r));
    const arr = activeByLockId.get(lockId) || [];
    arr.push(d.id);
    activeByLockId.set(lockId, arr);
  }

  // stale 삭제 후보는 위에서 이미 잡혔으므로, 생성 후보 판정 시 "stale이라 곧 삭제될 lock"은 없는 것으로 본다.
  const staleLockIds = new Set(deleteCandidates.map((c) => c.lockDocId));

  for (const [lockId, docIds] of activeByLockId) {
    if (docIds.length >= 2) {
      // 같은 조합의 활성 예약 2건 이상 — 실제 중복 데이터. 자동 수정하지 않는다.
      stats.conflicts += 1;
      continue;
    }
    const reservationDocId = docIds[0];
    const lock = locksById.get(lockId);
    const lockIsStale = staleLockIds.has(lockId);
    if (!lock || lockIsStale) {
      // lock 없음(또는 stale이라 삭제 예정) → 이 활성 예약을 가리키는 새 lock 필요.
      stats.missingLocks += 1;
      const r = resById.get(reservationDocId)!;
      createCandidates.push({
        lockDocId: lockId,
        reservationDocId,
        reservationId: String(r.reservationId || ""),
        patientId: String(r.patientId || ""),
      });
    } else if (String(lock.reservationDocId || "") !== reservationDocId) {
      // lock은 있으나 다른 예약을 가리킴 → 소유권 불일치. 보고만.
      stats.ownershipMismatches += 1;
    }
  }

  stats.wouldDeleteLocks = deleteCandidates.length;
  stats.wouldCreateLocks = createCandidates.length;

  if (APPLY) {
    const now = admin.firestore.FieldValue.serverTimestamp();
    // 삭제 적용
    for (let i = 0; i < deleteCandidates.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const c of deleteCandidates.slice(i, i + BATCH_LIMIT)) {
        batch.delete(db.collection(RESERVATION_LOCKS).doc(c.lockDocId));
        stats.appliedDeletes += 1;
      }
      await batch.commit();
    }
    // 생성 적용(stale 삭제와 같은 lockId를 재생성할 수 있으므로 삭제 이후에 수행)
    for (let i = 0; i < createCandidates.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const c of createCandidates.slice(i, i + BATCH_LIMIT)) {
        batch.set(db.collection(RESERVATION_LOCKS).doc(c.lockDocId), {
          reservationDocId: c.reservationDocId,
          reservationId: c.reservationId,
          patientId: c.patientId,
          dupKeyHash: c.lockDocId,
          createdAt: now,
          updatedAt: now,
        });
        stats.appliedCreates += 1;
      }
      await batch.commit();
    }
  }

  console.log(`모드: ${DRY_RUN ? "DRY RUN (수정 없음)" : "APPLY (stale 삭제 + 누락 생성)"}`);
  console.log(JSON.stringify(stats, null, 2));
  if (stats.conflicts > 0 || stats.ownershipMismatches > 0) {
    console.log("주의: conflict/ownership mismatch는 자동 수정하지 않았습니다. 수동 확인이 필요합니다.");
  }
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
