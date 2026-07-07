/**
 * 영구 삭제: reconcile-duplicate-patients.ts가 soft-delete한 중복 환자 문서를
 * Firestore에서 완전히 제거한다.
 *
 * 대상: patients 문서 중 mergedIntoPatientId 필드가 있는 문서(= reconcile 스크립트가
 *       병합 처리한 비대표 문서). 예약/인보이스/메모/사진은 이미 reconcile 단계에서
 *       대표 patientId로 재지정되었으므로, 이 문서를 지워도 데이터 유실이 없다.
 *
 * 안전:
 *   - --dry-run(기본) 대상 목록만 출력, 실제 삭제 없음.
 *   - --apply 로만 실제 삭제 수행.
 *   - mergedIntoPatientId가 없는 문서(수동 삭제 등)는 건드리지 않는다.
 *   - 되돌릴 수 없다(하드 삭제) — 실행 전 reconcile 로그/백업 확인 권장.
 *
 * 실행:
 *   1) Google Cloud Shell(권장 — 키 파일 불필요, 자동 인증):
 *        npx tsx scripts/purge-merged-duplicate-patients.ts --project mobilecrm-c405e --dry-run
 *        npx tsx scripts/purge-merged-duplicate-patients.ts --project mobilecrm-c405e --apply
 *   2) 키 파일 경로 지정(로컬):
 *        npx tsx scripts/purge-merged-duplicate-patients.ts --key ./serviceAccount.json --dry-run
 */
import * as admin from "firebase-admin";
import { readFileSync } from "node:fs";

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

async function main() {
  init();
  const db = admin.firestore();

  // mergedIntoPatientId가 존재하는 문서만 조회(= reconcile이 soft-delete한 비대표 문서).
  const snap = await db.collection("patients").where("mergedIntoPatientId", ">", "").get();

  if (snap.empty) {
    console.log("[purge] 대상 없음(mergedIntoPatientId 있는 문서 0건).");
    return;
  }

  console.log(`[purge] ${DRY_RUN ? "DRY-RUN" : "APPLY"} — 대상 ${snap.size}건:`);
  for (const d of snap.docs) {
    const data = d.data();
    console.log(
      `  - ${d.id} (patientId=${data.patientId || ""}, name=${data.name || ""}) → mergedInto=${data.mergedIntoPatientId}`
    );
  }

  if (!DRY_RUN) {
    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) batch.delete(d.ref);
      await batch.commit();
    }
    console.log(`[purge] ${snap.size}건 영구 삭제 완료.`);
  } else {
    console.log("[purge] dry-run — 실제 삭제 없음. --apply로 재실행하면 위 문서들이 영구 삭제됩니다.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
