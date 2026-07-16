/**
 * 정합성 점검/보정: 같은 사람(이름+생년월일+국적+성별)이 서로 다른 랜덤 patientId로 여러
 * 문서로 저장된 "중복 환자"를 감지하고, 안전한 경우에만 대표(canonical) 문서로 통합한다.
 * 신원 키 규칙은 lib/patientIdentity.ts와 동일하게 공유한다(규칙이 갈라지면 dedup이 깨진다).
 *
 * 수행 내용:
 *   1) 활성 환자 전수 조회 → 신원 키로 그룹핑.
 *   2) 모든 환자 문서에 identityKey 필드 backfill(향후 create-dedup이 동작하도록).
 *   3) 신원 키가 같은 문서가 2개 이상인 그룹:
 *        - 대표 = createdAt 최솟값(가장 먼저 등록). 동률이면 문서 ID 사전순.
 *        - 비대표 문서의 예약/인보이스/정산/메모/사진 patientId를 대표 patientId로 재지정.
 *        - 비대표 patients 문서 soft-delete(isDeleted=true, mergedIntoPatientId, reconcileMergedAt).
 *        - 대표 patientId 기준으로 요약(summary) 재계산.
 *
 * 옵션:
 *   --dry-run  (기본) DB 수정 없이 검출/집계만
 *   --apply    실제 적용(identityKey backfill + 재지정 + soft-delete + 요약 재계산)
 *   --project <id> / --key <serviceAccount.json 경로>
 *
 * 실행 예:
 *   npx tsx scripts/reconcile-duplicate-patients.ts --project mobilecrm-c405e --dry-run
 *   npx tsx scripts/reconcile-duplicate-patients.ts --project mobilecrm-c405e --apply
 *
 * 안전: 기본 dry-run. soft-delete + mergedIntoPatientId 보존이라 필요 시 복구 가능.
 *       재지정된 예약의 원래 patientId는 실행 로그(stdout)로 남긴다.
 */
import * as admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { identityKeyForPatient } from "../lib/patientIdentity";
import { aggregateSettlementRows, type SettlementMathRow } from "../lib/settlementMath";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;
const BATCH_LIMIT = 400;
const RESERVATION_CAP = 300;

// ─── 초기화(ADC / --key / --project) — 기존 backfill 스크립트와 동일 패턴 ───────────────
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

// createdAt(Timestamp/number/string) → 비교용 밀리초. 없으면 +Infinity(대표로 뽑히지 않게).
function createdAtMillis(data: admin.firestore.DocumentData): number {
  const v = data.createdAt;
  if (v && typeof (v as admin.firestore.Timestamp).toMillis === "function") return (v as admin.firestore.Timestamp).toMillis();
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return Number.POSITIVE_INFINITY;
}

// 대표 patientId 기준 요약 재계산(재지정 후 배지/최근예약/정산이 정확하도록).
async function recomputeSummary(db: admin.firestore.Firestore, patientId: string): Promise<Record<string, unknown>> {
  const resSnap = await db
    .collection("reservations")
    .where("patientId", "==", patientId)
    .where("isDeleted", "==", false)
    .orderBy("reservationDate", "desc")
    .limit(RESERVATION_CAP)
    .get();

  let reservationCount = 0;
  let lastReservationDate = "";
  let lastReservationTime = "";
  let lastComposite = "";

  for (const d of resSnap.docs) {
    const r = d.data();
    reservationCount += 1;
    const date = String(r.reservationDate || "");
    const time = String(r.reservationTime || "");
    const comp = `${date} ${time}`;
    if (comp > lastComposite) {
      lastComposite = comp;
      lastReservationDate = date;
      lastReservationTime = time;
    }
  }

  const [invAgg, memoAgg, settlementSnap] = await Promise.all([
    db.collection("invoices").where("patientId", "==", patientId).where("isDeleted", "==", false).count().get(),
    db.collection("reservationNotes").where("patientId", "==", patientId).where("isDeleted", "==", false).count().get(),
    db.collection("settlements").where("patientId", "==", patientId).get(),
  ]);
  const invoiceCount = invAgg.data().count;
  const memoCount = memoAgg.data().count;
  const settlementAggregate = aggregateSettlementRows(
    settlementSnap.docs.map((doc) => doc.data() as SettlementMathRow)
  );

  return {
    reservationCount,
    lastReservationDate,
    lastReservationTime,
    lastReservationAt: lastReservationDate ? `${lastReservationDate} ${lastReservationTime}`.trim() : "",
    reservationCountCapped: resSnap.docs.length === RESERVATION_CAP,
    invoiceCount,
    hasInvoice: invoiceCount > 0,
    settlementCount: settlementAggregate.count,
    totalSettlementPaid: settlementAggregate.totalPaid,
    totalSettlementRefunded: settlementAggregate.totalRefunded,
    netSettlementAmount: settlementAggregate.netAmount,
    lastSettlementAt: settlementAggregate.lastPaidAt,
    memoCount,
    hasMemo: memoCount > 0,
    summaryUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

// 한 컬렉션에서 patientId == from 인 문서를 to 로 재지정. 적용 건수 반환.
async function repointCollection(
  db: admin.firestore.Firestore,
  collection: string,
  from: string,
  to: string
): Promise<number> {
  const snap = await db.collection(collection).where("patientId", "==", from).get();
  if (snap.empty) return 0;
  if (!DRY_RUN) {
    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) batch.update(d.ref, { patientId: to });
      await batch.commit();
    }
  }
  return snap.size;
}

async function main() {
  init();
  const db = admin.firestore();

  const patientsSnap = await db.collection("patients").get();

  // 신원 키로 그룹핑(활성 문서만 대상). 신원 키가 없으면(이름/생년월일 없음) 그룹핑에서 제외.
  const groups = new Map<string, admin.firestore.QueryDocumentSnapshot[]>();
  const identityBackfill: { ref: admin.firestore.DocumentReference; key: string }[] = [];

  for (const d of patientsSnap.docs) {
    const data = d.data();
    if (data.isDeleted === true) continue;
    const key = identityKeyForPatient(data);
    if (!key) continue;
    // identityKey 미저장/불일치 → backfill 대상.
    if (String(data.identityKey || "") !== key) identityBackfill.push({ ref: d.ref, key });
    const arr = groups.get(key) || [];
    arr.push(d);
    groups.set(key, arr);
  }

  const stats = {
    checkedPatients: patientsSnap.size,
    identityBackfilled: identityBackfill.length,
    duplicateGroups: 0,
    duplicateDocs: 0,
    softDeletedPatients: 0,
    repointedReservations: 0,
    repointedInvoices: 0,
    repointedSettlements: 0,
    repointedNotes: 0,
    repointedPhotos: 0,
    summariesRecomputed: 0,
  };

  // 1) identityKey backfill(중복 아님 포함 — 향후 create-dedup 동작에 필요).
  if (!DRY_RUN) {
    for (let i = 0; i < identityBackfill.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const b of identityBackfill.slice(i, i + BATCH_LIMIT)) batch.update(b.ref, { identityKey: b.key });
      await batch.commit();
    }
  }

  // 2) 중복 그룹 병합.
  for (const [key, docs] of groups) {
    if (docs.length < 2) continue;
    stats.duplicateGroups += 1;
    stats.duplicateDocs += docs.length - 1;

    // 대표 선택: createdAt 최소 → 동률이면 문서 ID 사전순.
    const sorted = [...docs].sort((a, b) => {
      const am = createdAtMillis(a.data());
      const bm = createdAtMillis(b.data());
      if (am !== bm) return am - bm;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const canonical = sorted[0];
    const canonicalPatientId = String(canonical.data().patientId || "");
    if (!canonicalPatientId) {
      console.warn(`[reconcile] 대표 patientId 없음 — 그룹 건너뜀 (identityKey=${key.slice(0, 12)}…)`);
      continue;
    }

    for (const dup of sorted.slice(1)) {
      const dupPatientId = String(dup.data().patientId || "");
      if (dupPatientId && dupPatientId !== canonicalPatientId) {
        const [r, inv, settlement, memo, photo] = await Promise.all([
          repointCollection(db, "reservations", dupPatientId, canonicalPatientId),
          repointCollection(db, "invoices", dupPatientId, canonicalPatientId),
          repointCollection(db, "settlements", dupPatientId, canonicalPatientId),
          repointCollection(db, "reservationNotes", dupPatientId, canonicalPatientId),
          repointCollection(db, "reservationPhotos", dupPatientId, canonicalPatientId),
        ]);
        stats.repointedReservations += r;
        stats.repointedInvoices += inv;
        stats.repointedSettlements += settlement;
        stats.repointedNotes += memo;
        stats.repointedPhotos += photo;
        console.log(
          `[reconcile]${DRY_RUN ? " [DRY]" : ""} 재지정 ${dupPatientId} → ${canonicalPatientId} ` +
          `(예약 ${r}, 인보이스 ${inv}, 정산 ${settlement}, 메모 ${memo}, 사진 ${photo})`
        );
      }

      // 비대표 patients 문서 soft-delete(+ identityKey 스탬프).
      if (!DRY_RUN) {
        await dup.ref.update({
          isDeleted: true,
          identityKey: key,
          mergedIntoPatientId: canonicalPatientId,
          reconcileMergedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      stats.softDeletedPatients += 1;
    }

    // 대표 patientId 기준 요약 재계산(재지정 반영).
    if (!DRY_RUN) {
      const summary = await recomputeSummary(db, canonicalPatientId);
      await canonical.ref.update(summary);
    }
    stats.summariesRecomputed += 1;
  }

  console.log(`\n[reconcile] ${DRY_RUN ? "DRY-RUN (변경 없음)" : "APPLIED"}`);
  console.table(stats);
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
