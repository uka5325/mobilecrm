/**
 * 백필 마이그레이션: coordinators[](displayName) → coordinatorUids[](UID)
 *
 * 목적: invoices/reservations의 담당자 권한 판정을 displayName 문자열에서
 *       안정적인 staff UID 기반으로 전환하기 위한 1회성 백필.
 *
 * 동작:
 *   - active staff의 displayName→uid 맵을 만든다.
 *   - 각 문서의 coordinators[] 이름을 맵으로 변환해 coordinatorUids[]를 채운다.
 *   - displayName이 유일하게 매칭되는 경우만 채운다(동명이인/미등록 이름은 스킵 → 이름 폴백 유지).
 *
 * 실행 (둘 중 편한 방법):
 *   1) 키 파일 경로 지정 (권장 — 셸 따옴표 불필요):
 *        npx tsx scripts/backfill-coordinator-uids.ts --key ./serviceAccount.json --dry-run
 *   2) 환경변수에 JSON 문자열 (CI 등):
 *        FIREBASE_SERVICE_ACCOUNT_KEY='{...}' npx tsx scripts/backfill-coordinator-uids.ts --dry-run
 *
 * 안전:
 *   - --dry-run 으로 먼저 변경 건수를 확인하세요.
 *   - 코드(uid 우선, 이름 폴백)는 백필 전후 모두 동작하므로 무중단 배포 가능.
 */
import * as admin from "firebase-admin";
import { readFileSync } from "node:fs";

const DRY_RUN = process.argv.includes("--dry-run");

// 서비스 계정 키를 가져온다. --key <경로>(파일) 우선, 없으면 환경변수(JSON 문자열).
function getServiceAccountJson(): string {
  const idx = process.argv.indexOf("--key");
  if (idx !== -1) {
    const path = process.argv[idx + 1];
    if (!path) throw new Error("--key 다음에 serviceAccount.json 파일 경로를 지정하세요.");
    return readFileSync(path, "utf8");
  }
  const env = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (env) return env;
  throw new Error(
    "서비스 계정 키가 필요합니다. '--key <serviceAccount.json 경로>' 또는 " +
      "FIREBASE_SERVICE_ACCOUNT_KEY 환경변수를 지정하세요."
  );
}

function init() {
  if (admin.apps.length) return;
  const key = getServiceAccountJson();
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key) as admin.ServiceAccount) });
}

async function buildNameToUid(db: admin.firestore.Firestore): Promise<Map<string, string | null>> {
  const snap = await db.collection("staff").where("active", "==", true).get();
  const map = new Map<string, string | null>();
  for (const d of snap.docs) {
    const name = String(d.data().displayName || "").trim();
    if (!name) continue;
    // 이미 본 이름이면 동명이인 → null로 표시(애매하므로 매핑 안 함)
    map.set(name, map.has(name) ? null : (d.data().uid || d.id));
  }
  return map;
}

function resolveUids(names: unknown, nameToUid: Map<string, string | null>): string[] | null {
  if (!Array.isArray(names) || !names.length) return null;
  const uids: string[] = [];
  for (const raw of names) {
    const name = String(raw || "").trim();
    const uid = nameToUid.get(name);
    if (uid) uids.push(uid);
  }
  return uids.length ? Array.from(new Set(uids)) : null;
}

async function backfillCollection(
  db: admin.firestore.Firestore,
  collection: string,
  nameToUid: Map<string, string | null>
) {
  const snap = await db.collection(collection).get();
  let updated = 0;
  let batch = db.batch();
  let pending = 0;

  for (const d of snap.docs) {
    const data = d.data();
    if (Array.isArray(data.coordinatorUids) && data.coordinatorUids.length) continue; // 이미 백필됨
    const uids = resolveUids(data.coordinators, nameToUid);
    if (!uids) continue;

    updated++;
    if (DRY_RUN) continue;
    batch.update(d.ref, { coordinatorUids: uids });
    if (++pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (!DRY_RUN && pending > 0) await batch.commit();
  console.log(`[${collection}] ${DRY_RUN ? "백필 대상" : "백필 완료"}: ${updated}건`);
}

async function main() {
  init();
  const db = admin.firestore();
  const nameToUid = await buildNameToUid(db);
  console.log(`active staff 이름 매핑: ${nameToUid.size}건${DRY_RUN ? " (DRY RUN)" : ""}`);
  await backfillCollection(db, "reservations", nameToUid);
  await backfillCollection(db, "invoices", nameToUid);
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
