/**
 * 백필 마이그레이션: patients.searchTokens 생성
 *
 * 배경: 고객관리 검색을 서버 검색토큰(array-contains)으로 전환한다.
 *       searchTokens가 없는 기존 환자는 검색에 잡히지 않으므로, 전체 환자에
 *       이름 기반 토큰을 채운다. (이름 "오양가(NYAMJAV UYANGA)" → ["오양가","nyamjav","uyanga"])
 *
 * 실행 (둘 중 편한 방법):
 *   1) 키 파일 경로 지정 (권장):
 *        npx tsx scripts/backfill-patient-search-tokens.ts --key ./serviceAccount.json --dry-run
 *   2) 환경변수에 JSON 문자열 (CI 등):
 *        FIREBASE_SERVICE_ACCOUNT_KEY='{...}' npx tsx scripts/backfill-patient-search-tokens.ts --dry-run
 *
 * 권장: 검색 전환(search_patients 액션 사용) 배포 "전에" 실행.
 *       --force를 주면 기존 searchTokens도 재생성(이름 규칙 변경 시).
 */
import * as admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { makePatientSearchTokens } from "../lib/searchTokens";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

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

async function main() {
  init();
  const db = admin.firestore();
  if (DRY_RUN) console.log("=== DRY RUN ===");

  const snap = await db.collection("patients").get();
  let updated = 0;
  let skipped = 0;
  let batch = db.batch();
  let pending = 0;

  for (const d of snap.docs) {
    const data = d.data();
    if (!FORCE && Array.isArray(data.searchTokens) && data.searchTokens.length) {
      skipped++;
      continue; // 이미 존재 (--force면 재생성)
    }
    const tokens = makePatientSearchTokens(String(data.name || ""));

    updated++;
    if (DRY_RUN) continue;
    batch.update(d.ref, { searchTokens: tokens });
    if (++pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (!DRY_RUN && pending > 0) await batch.commit();

  console.log(`[patients] ${DRY_RUN ? "백필 대상" : "백필 완료"}: ${updated}건 (스킵 ${skipped}건)`);
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
