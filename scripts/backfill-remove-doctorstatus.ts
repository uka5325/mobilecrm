/**
 * 정리 백필: 기존 reservations 문서에서 원상(원장 상태) 관련 레거시 필드 제거.
 *
 * 대상 필드: doctorStatusMap, doctorStatusMetaMap
 *   - 원장별 "원상중" 상태를 담던 필드로, UI에서 더 이상 사용하지 않으며(죽은 코드였음)
 *     신규 생성/수정 경로에서도 쓰기를 중단했다(Stage 4-3). 이 스크립트는 이미 저장된
 *     기존 문서에서 두 필드를 삭제해 문서 크기/payload를 줄인다.
 *   - 다른 필드(operationStatus 등)는 건드리지 않는다. operationStatus의 "원상중" 값은
 *     별개 기능이므로 그대로 둔다.
 *
 * 안전:
 *   - 재실행 안전(idempotent): 필드가 없으면 스킵.
 *   - FieldValue.delete()로 해당 필드만 제거(문서 자체/다른 필드는 불변).
 *   - --dry-run 으로 먼저 대상 건수를 확인하세요.
 *
 * 실행:
 *   1) Google Cloud Shell(권장 — 키 파일 불필요, 자동 인증):
 *        npx tsx scripts/backfill-remove-doctorstatus.ts --project mobilecrm-c405e --dry-run
 *        npx tsx scripts/backfill-remove-doctorstatus.ts --project mobilecrm-c405e
 *   2) 키 파일 경로 지정(로컬):
 *        npx tsx scripts/backfill-remove-doctorstatus.ts --key ./serviceAccount.json --dry-run
 *   3) 환경변수에 JSON 문자열(CI 등):
 *        FIREBASE_SERVICE_ACCOUNT_KEY='{...}' npx tsx scripts/backfill-remove-doctorstatus.ts --dry-run
 */
import * as admin from "firebase-admin";
import { readFileSync } from "node:fs";

const DRY_RUN = process.argv.includes("--dry-run");

// 제거 대상 레거시 필드.
const LEGACY_FIELDS = ["doctorStatusMap", "doctorStatusMetaMap"] as const;

// 서비스 계정 키(JSON) 반환. 없으면 null → ADC 폴백(Cloud Shell 등).
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

async function main() {
  init();
  const db = admin.firestore();

  // 전체 reservations를 순회하며 대상 필드가 있는 문서만 정리.
  // (Firestore는 "필드 존재" 쿼리가 없으므로 전수 스캔 후 메모리 판별)
  const snap = await db.collection("reservations").get();
  console.log(`reservations 문서: ${snap.size}건${DRY_RUN ? " (DRY RUN)" : ""}`);

  let matched = 0;
  let batch = db.batch();
  let pending = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const hasLegacy = LEGACY_FIELDS.some((f) => data[f] !== undefined);
    if (!hasLegacy) continue;

    matched++;
    if (DRY_RUN) continue;

    const patch: Record<string, admin.firestore.FieldValue> = {};
    for (const f of LEGACY_FIELDS) {
      if (data[f] !== undefined) patch[f] = admin.firestore.FieldValue.delete();
    }
    batch.update(d.ref, patch);
    if (++pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (!DRY_RUN && pending > 0) await batch.commit();

  console.log(
    `원상(doctorStatusMap/doctorStatusMetaMap) 필드 ${DRY_RUN ? "제거 대상" : "제거 완료"}: ${matched}건`
  );
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
