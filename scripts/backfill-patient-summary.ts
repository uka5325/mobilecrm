/**
 * 백필 마이그레이션: patients 문서에 고객관리 요약(summary) 필드 채우기.
 *
 * 목적: 고객관리 첫 화면을 patients 문서만으로 그리기 위해(Stage 4-1),
 *       각 환자의 예약/인보이스/메모를 집계해 patients에 요약을 저장한다.
 *       신규 쓰기는 서버 라우트에서 자동 유지되며(lib/patientSummary.ts),
 *       이 스크립트는 기존 문서 1회 백필(재실행 안전)용이다.
 *
 * 채우는 필드:
 *   reservationCount, depositCount, surgeryCostCount,
 *   totalDepositAmount, totalSurgeryCost,
 *   lastReservationDate, lastReservationTime, lastReservationAt, reservationCountCapped,
 *   invoiceCount, hasInvoice, memoCount, hasMemo, summaryUpdatedAt
 *
 * 실행:
 *   1) Google Cloud Shell(권장 — 키 파일 불필요, 브라우저에서 자동 인증):
 *        npx tsx scripts/backfill-patient-summary.ts --project mobilecrm-c405e --dry-run
 *   2) 키 파일 경로 지정(로컬):
 *        npx tsx scripts/backfill-patient-summary.ts --key ./serviceAccount.json --dry-run
 *   3) 환경변수에 JSON 문자열(CI 등):
 *        FIREBASE_SERVICE_ACCOUNT_KEY='{...}' npx tsx scripts/backfill-patient-summary.ts --dry-run
 *
 * 안전:
 *   - --dry-run 으로 먼저 대상 건수를 확인하세요.
 *   - 재실행 안전(idempotent) — 항상 최신 집계로 덮어씀.
 *   - 읽기 경로 전환 전에 실행해 두면 전 환자가 정렬/노출된다.
 */
import * as admin from "firebase-admin";
import { readFileSync } from "node:fs";

const DRY_RUN = process.argv.includes("--dry-run");
const RESERVATION_CAP = 300;

// 서비스 계정 키(JSON) 반환. --key 파일 또는 FIREBASE_SERVICE_ACCOUNT_KEY 환경변수.
// 둘 다 없으면 null → Application Default Credentials(ADC)로 폴백(예: Google Cloud Shell).
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
  // 키 미지정 → ADC 사용. Google Cloud Shell/GCP 환경에서 자동 인증되어 키 파일이 불필요.
  // (GOOGLE_CLOUD_PROJECT가 없으면 --project 인자나 env로 프로젝트를 넘겨야 할 수 있음)
  const projIdx = process.argv.indexOf("--project");
  const projectId = projIdx !== -1 ? process.argv[projIdx + 1] : process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  admin.initializeApp(projectId ? { projectId } : undefined);
}

function parseAmount(v: unknown): number {
  const cleaned = String(v ?? "").replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// lib/patientSummary.ts reservationGroupKey와 동일 규칙(병원+부위+원장) — 배지/팝오버 일치.
function reservationGroupKey(r: Record<string, unknown>): string {
  const doctors = Array.isArray(r.doctors) ? (r.doctors as unknown[]) : [];
  return [
    String(r.hospital || "").trim().toLowerCase(),
    String(r.consultArea || "").trim().toLowerCase(),
    doctors.map((d) => String(d).trim().toLowerCase()).sort().join(","),
  ].join("|");
}

async function computeSummary(
  db: admin.firestore.Firestore,
  patientId: string
): Promise<Record<string, unknown>> {
  const resSnap = await db
    .collection("reservations")
    .where("patientId", "==", patientId)
    .where("isDeleted", "==", false)
    .orderBy("reservationDate", "desc")
    .limit(RESERVATION_CAP)
    .get();

  let reservationCount = 0;
  let totalDepositAmount = 0;
  let totalSurgeryCost = 0;
  let lastReservationDate = "";
  let lastReservationTime = "";
  let lastComposite = "";
  const depositGroups = new Set<string>();
  const surgeryGroups = new Set<string>();

  for (const d of resSnap.docs) {
    const r = d.data();
    reservationCount += 1;
    const hasDeposit = String(r.depositAmount ?? "").trim() !== "";
    const hasSurgery = String(r.surgeryCost ?? "").trim() !== "";
    if (hasDeposit) { depositGroups.add(reservationGroupKey(r)); totalDepositAmount += parseAmount(r.depositAmount); }
    if (hasSurgery) { surgeryGroups.add(reservationGroupKey(r)); totalSurgeryCost += parseAmount(r.surgeryCost); }
    const date = String(r.reservationDate || "");
    const time = String(r.reservationTime || "");
    const comp = `${date} ${time}`;
    if (comp > lastComposite) {
      lastComposite = comp;
      lastReservationDate = date;
      lastReservationTime = time;
    }
  }
  const depositCount = depositGroups.size;
  const surgeryCostCount = surgeryGroups.size;

  const [invAgg, memoAgg] = await Promise.all([
    db.collection("invoices").where("patientId", "==", patientId).where("isDeleted", "==", false).count().get(),
    db.collection("reservationNotes").where("patientId", "==", patientId).where("isDeleted", "==", false).count().get(),
  ]);
  const invoiceCount = invAgg.data().count;
  const memoCount = memoAgg.data().count;

  return {
    reservationCount,
    depositCount,
    surgeryCostCount,
    totalDepositAmount,
    totalSurgeryCost,
    lastReservationDate,
    lastReservationTime,
    lastReservationAt: lastReservationDate ? `${lastReservationDate} ${lastReservationTime}`.trim() : "",
    reservationCountCapped: resSnap.docs.length === RESERVATION_CAP,
    invoiceCount,
    hasInvoice: invoiceCount > 0,
    memoCount,
    hasMemo: memoCount > 0,
    summaryUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function main() {
  init();
  const db = admin.firestore();

  const patientsSnap = await db.collection("patients").get();
  console.log(`patients 문서: ${patientsSnap.size}건${DRY_RUN ? " (DRY RUN)" : ""}`);

  // patientId별 집계 캐시(중복 patientId 문서가 여러 개여도 1회만 계산).
  const cache = new Map<string, Record<string, unknown>>();
  let updated = 0;
  let batch = db.batch();
  let pending = 0;

  for (const d of patientsSnap.docs) {
    const patientId = String(d.data().patientId || "");
    if (!patientId) continue;

    let summary = cache.get(patientId);
    if (!summary) {
      summary = await computeSummary(db, patientId);
      cache.set(patientId, summary);
    }

    updated++;
    if (DRY_RUN) continue;
    batch.update(d.ref, summary);
    if (++pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (!DRY_RUN && pending > 0) await batch.commit();

  console.log(`patients 요약 ${DRY_RUN ? "백필 대상" : "백필 완료"}: ${updated}건 (고유 환자 ${cache.size}명)`);
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
