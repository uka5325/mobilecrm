/**
 * 백필 마이그레이션: isDeleted 필드 정규화
 *
 * 배경: invoices 목록이 서버에서 where("isDeleted","==",false)로 필터링되도록 복원되었다.
 *       그러나 isDeleted 필드가 없는 레거시 문서는 이 쿼리에서 누락된다.
 *       또한 reservations onSnapshot도 where("isDeleted","==",false)를 사용한다.
 *       → isDeleted가 없는 문서에 false를 채워 누락을 방지한다.
 *
 * 실행:
 *   FIREBASE_SERVICE_ACCOUNT_KEY='{...}' npx tsx scripts/backfill-isdeleted.ts [--dry-run]
 *
 * 권장: invoices isDeleted+createdAt 복합 인덱스 배포 및 서버 필터 복원 배포 "전에" 실행.
 */
import * as admin from "firebase-admin";

const DRY_RUN = process.argv.includes("--dry-run");
const COLLECTIONS = ["invoices", "reservations", "reservationNotes", "reservationPhotos"];

function init() {
  if (admin.apps.length) return;
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!key) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 필요합니다.");
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key) as admin.ServiceAccount) });
}

async function backfill(db: admin.firestore.Firestore, collection: string) {
  const snap = await db.collection(collection).get();
  let updated = 0;
  let batch = db.batch();
  let pending = 0;

  for (const d of snap.docs) {
    const data = d.data();
    if (typeof data.isDeleted === "boolean") continue; // 이미 존재
    // 레거시 deleted(boolean)가 있으면 그 값을, 없으면 false로 정규화
    const value = typeof data.deleted === "boolean" ? data.deleted : false;

    updated++;
    if (DRY_RUN) continue;
    batch.update(d.ref, { isDeleted: value });
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
  if (DRY_RUN) console.log("=== DRY RUN ===");
  for (const c of COLLECTIONS) await backfill(db, c);
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
