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
 *   1) 키 파일 경로 지정(권장):
 *        npx tsx scripts/backfill-patient-summary.ts --key ./serviceAccount.json --dry-run
 *   2) 환경변수에 JSON 문자열(CI 등):
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

function parseAmount(v: unknown): number {
  const cleaned = String(v ?? "").replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
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
  let depositCount = 0;
  let surgeryCostCount = 0;
  let totalDepositAmount = 0;
  let totalSurgeryCost = 0;
  let lastReservationDate = "";
  let lastReservationTime = "";
  let lastComposite = "";

  for (const d of resSnap.docs) {
    const r = d.data();
    reservationCount += 1;
    const dep = parseAmount(r.depositAmount);
    const sur = parseAmount(r.surgeryCost);
    if (dep > 0) { depositCount += 1; totalDepositAmount += dep; }
    if (sur > 0) { surgeryCostCount += 1; totalSurgeryCost += sur; }
    const date = String(r.reservationDate || "");
    const time = String(r.reservationTime || "");
    const comp = `${date} ${time}`;
    if (comp > lastComposite) {
      lastComposite = comp;
      lastReservationDate = date;
      lastReservationTime = time;
    }
  }

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
