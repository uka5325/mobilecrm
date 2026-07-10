/**
 * 예약 문서 amount boolean flag 백필.
 *
 * 채우는 필드:
 *   hasDepositAmount = depositAmount가 비어있지 않음
 *   hasSurgeryCost   = surgeryCost가 비어있지 않음
 *
 * 실행:
 *   npx tsx scripts/backfill-reservation-amount-flags.ts --project mobilecrm-c405e --dry-run
 *   npx tsx scripts/backfill-reservation-amount-flags.ts --project mobilecrm-c405e --apply
 *   npx tsx scripts/backfill-reservation-amount-flags.ts --key ./serviceAccount.json --dry-run
 */
import * as admin from "firebase-admin";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = process.argv.includes("--dry-run") || !APPLY;
const BATCH_SIZE = 400;

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

function hasAmountValue(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

async function main() {
  init();
  const db = admin.firestore();
  let last: admin.firestore.QueryDocumentSnapshot | null = null;
  let scanned = 0;
  let changed = 0;
  let batches = 0;

  for (;;) {
    let q = db.collection("reservations").orderBy(admin.firestore.FieldPath.documentId()).limit(BATCH_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchChanges = 0;
    for (const doc of snap.docs) {
      scanned += 1;
      const data = doc.data();
      const next = {
        hasDepositAmount: hasAmountValue(data.depositAmount),
        hasSurgeryCost: hasAmountValue(data.surgeryCost),
      };
      if (data.hasDepositAmount !== next.hasDepositAmount || data.hasSurgeryCost !== next.hasSurgeryCost) {
        changed += 1;
        batchChanges += 1;
        if (APPLY) batch.update(doc.ref, next);
      }
    }

    if (APPLY && batchChanges > 0) {
      await batch.commit();
      batches += 1;
    }

    last = snap.docs[snap.docs.length - 1];
    console.log(`[amount-flags] scanned=${scanned} changed=${changed} committedBatches=${batches}`);
  }

  console.log(`[amount-flags] done mode=${DRY_RUN ? "dry-run" : "apply"} scanned=${scanned} changed=${changed} committedBatches=${batches}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
