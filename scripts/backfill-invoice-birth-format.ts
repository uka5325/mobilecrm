/**
 * 백필 마이그레이션: invoices.birth / birthDisplay 표준 포맷 통일
 *
 * 배경: 인보이스 생성 경로가 예약과 다른 birth 파서를 쓰고 있었다.
 *       - 기존(인보이스): birth "1989-12-10", birthDisplay "891210"
 *       - 표준(예약/신원키): birth "19891210", birthDisplay "1989.12.10"
 *       표준은 lib/patientIdentity.ts 가 명시한다 ("birth(표준 YYYYMMDD)").
 *       중복 파서를 제거해 신규 인보이스는 표준을 따르므로, 기존 문서를 맞춘다.
 *
 * 변환: 기존 birth 값을 정규 파서(lib/birthUtils)에 다시 통과시켜
 *       birth / birthDisplay / gender 를 재생성한다.
 *       ("1989-12-10" → 숫자 8자리 "19891210" → 표준값 산출)
 *       기존 gender 는 폴백 인자로 넘겨 남/여로 정규화한다.
 *
 * 실행 (둘 중 편한 방법):
 *   1) 키 파일 경로 지정 (권장):
 *        npx tsx scripts/backfill-invoice-birth-format.ts --key ./serviceAccount.json --dry-run
 *   2) 환경변수에 JSON 문자열 (CI 등):
 *        FIREBASE_SERVICE_ACCOUNT_KEY='{...}' npx tsx scripts/backfill-invoice-birth-format.ts --dry-run
 *
 * 권장: 반드시 --dry-run 으로 대상 건수/샘플을 먼저 확인한 뒤 실제 실행할 것.
 *       birth 가 이미 8자리(YYYYMMDD)면 건너뛴다(멱등). --force 를 주면 재생성한다.
 */
import * as admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { parseBirthInfo } from "../lib/birthUtils";

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

  const snap = await db.collection("invoices").get();
  let updated = 0;
  let skipped = 0;
  let empty = 0;
  const samples: string[] = [];
  let batch = db.batch();
  let pending = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const birth = String(data.birth ?? "").trim();

    // 원래 파싱에 실패해 값이 비어 있는 문서는 건드리지 않는다.
    // (복구하려면 연결된 예약 문서에서 다시 가져와야 하므로 별도 판단 사항)
    if (!birth) {
      empty++;
      continue;
    }

    // 이미 표준(YYYYMMDD)이면 스킵 (--force 면 재생성)
    if (!FORCE && /^\d{8}$/.test(birth)) {
      skipped++;
      continue;
    }

    const parsed = parseBirthInfo(birth, String(data.gender ?? ""));

    // 파싱 결과가 표준 형태가 아니면(예상 못 한 값) 건드리지 않는다.
    if (!/^\d{8}$/.test(parsed.birth)) {
      empty++;
      continue;
    }

    updated++;
    if (samples.length < 5) {
      samples.push(
        `  ${d.id}: birth ${birth} → ${parsed.birth}, ` +
          `birthDisplay ${String(data.birthDisplay ?? "")} → ${parsed.birthDisplay}`
      );
    }
    if (DRY_RUN) continue;

    batch.update(d.ref, {
      birth: parsed.birth,
      birthDisplay: parsed.birthDisplay,
      gender: parsed.gender,
    });
    if (++pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (!DRY_RUN && pending > 0) await batch.commit();

  if (samples.length) {
    console.log(`[invoices] 변환 샘플 (최대 5건):`);
    samples.forEach((s) => console.log(s));
  }
  console.log(
    `[invoices] ${DRY_RUN ? "백필 대상" : "백필 완료"}: ${updated}건 ` +
      `(이미 표준 ${skipped}건, birth 없음/변환 불가 ${empty}건)`
  );
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
