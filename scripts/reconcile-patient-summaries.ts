/**
 * 정합성 점검/보정: patients 문서의 고객관리 요약(summary)이 실제 예약/인보이스/메모/정산
 * 집계와 일치하는지 검사하고, 드리프트가 있으면 최신 값으로 보정한다.
 *
 * 이 스크립트는 실제 원본 컬렉션과 patients 요약의 차이를 검출하고 선택적으로 보정한다.
 * 요약 계산 규칙은 lib/patientSummary.ts(recompute*)와 동일하게 맞춘다.
 *
 * 옵션:
 *   --dry-run  (기본) DB를 수정하지 않고 불일치 건수만 출력
 *   --apply    실제로 드리프트가 있는 문서만 batch 보정
 *   --project <id> / --key <serviceAccount.json 경로>  (인증)
 *
 * 실행 예:
 *   npx tsx scripts/reconcile-patient-summaries.ts --project mobilecrm-c405e --dry-run
 *   npx tsx scripts/reconcile-patient-summaries.ts --project mobilecrm-c405e --apply
 *
 * 안전:
 *   - 기본이 dry-run. --apply를 명시해야만 쓰기.
 *   - 재실행 안전(idempotent).
 *   - PII 로그 금지: conflict/예외 시 환자 이름·전화·생년을 남기지 않는다(patientId만).
 */
import * as admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { aggregateSettlementRows, type SettlementMathRow } from "../lib/settlementMath";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY; // 기본 dry-run
// 런타임 recompute(lib/patientSummary.ts)는 비용 때문에 300건 cap을 유지하지만,
// reconciliation은 정합성 검증이 목적이므로 cursor pagination으로 전체를 정확히 읽는다.
const RESERVATION_PAGE_SIZE = 500;
const BATCH_LIMIT = 400; // 400~450 단위 batch

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

type Summary = {
  reservationCount: number;
  lastReservationDate: string;
  lastReservationTime: string;
  lastReservationAt: string;
  reservationCountCapped: boolean;
  invoiceCount: number;
  hasInvoice: boolean;
  memoCount: number;
  hasMemo: boolean;
  settlementCount: number;
  totalSettlementPaid: number;
  totalSettlementRefunded: number;
  netSettlementAmount: number;
  lastSettlementAt: string;
};

type ReservationAggregate = {
  reservationCount: number;
  lastReservationDate: string;
  lastReservationTime: string;
};

// Firestore 의존 없는 순수 함수 — 여러 "페이지"(배치)에 걸쳐 도착한 예약 문서를 하나의
// 누적 집계로 합친다. cursor pagination이 300건 cap 없이 전체를 정확히 더하는지
// (여러 페이지에 걸쳐도 합계가 깨지지 않는지) emulator 없이 검증할 수 있도록 분리했다.
export function aggregateReservationPages(pages: Record<string, unknown>[][]): ReservationAggregate {
  let reservationCount = 0;
  let lastReservationDate = "";
  let lastReservationTime = "";
  let lastComposite = "";
  for (const page of pages) {
    for (const r of page) {
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
  }

  return {
    reservationCount,
    lastReservationDate,
    lastReservationTime,
  };
}

async function computeSummary(db: admin.firestore.Firestore, patientId: string): Promise<Summary> {
  // cursor pagination으로 해당 환자의 예약을 전부 읽는다(300건 cap 없음 — reconciliation은 정확해야 함).
  const pages: Record<string, unknown>[][] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db
      .collection("reservations")
      .where("patientId", "==", patientId)
      .where("isDeleted", "==", false)
      .orderBy("reservationDate", "desc")
      .limit(RESERVATION_PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor) as typeof q;
    const snap = await q.get();
    if (snap.empty) break;
    pages.push(snap.docs.map((d) => d.data()));
    if (snap.docs.length < RESERVATION_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  const agg = aggregateReservationPages(pages);

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
    ...agg,
    lastReservationAt: agg.lastReservationDate ? `${agg.lastReservationDate} ${agg.lastReservationTime}`.trim() : "",
    // 페이지네이션으로 전체를 읽으므로 reconciliation의 계산값은 항상 정확(cap 없음).
    reservationCountCapped: false,
    invoiceCount,
    hasInvoice: invoiceCount > 0,
    memoCount,
    hasMemo: memoCount > 0,
    settlementCount: settlementAggregate.count,
    totalSettlementPaid: settlementAggregate.totalPaid,
    totalSettlementRefunded: settlementAggregate.totalRefunded,
    netSettlementAmount: settlementAggregate.netAmount,
    lastSettlementAt: settlementAggregate.lastPaidAt,
  };
}

// stored 요약과 computed 요약의 차이를 검출한다. 차이 나는 필드명 배열 반환.
function diffFields(stored: Record<string, unknown>, computed: Summary): string[] {
  const drift: string[] = [];
  for (const [k, v] of Object.entries(computed)) {
    if (typeof v === "boolean") {
      if (stored[k] !== v) drift.push(k);
    } else if (typeof v === "number") {
      if (Number(stored[k] ?? NaN) !== v) drift.push(k);
    } else {
      if (String(stored[k] ?? "") !== String(v)) drift.push(k);
    }
  }
  return drift;
}

async function main() {
  init();
  const db = admin.firestore();

  const patientsSnap = await db.collection("patients").get();

  const stats = {
    checkedPatients: 0,
    wouldUpdatePatients: 0,
    updatedPatients: 0,
    missingLastReservationDate: 0,
    reservationCountMismatch: 0,
    invoiceMismatch: 0,
    settlementMismatch: 0,
    memoMismatch: 0,
    skippedDeletedPatients: 0,
  };

  // patientId별 computed 캐시(중복 patientId 문서 재계산 방지).
  const cache = new Map<string, Summary>();
  let batch = db.batch();
  let pending = 0;

  for (const d of patientsSnap.docs) {
    const data = d.data();
    if (data.isDeleted === true) { stats.skippedDeletedPatients += 1; continue; }
    const patientId = String(data.patientId || "");
    if (!patientId) continue;

    stats.checkedPatients += 1;

    let computed = cache.get(patientId);
    if (!computed) {
      try {
        computed = await computeSummary(db, patientId);
      } catch (e) {
        // PII 미기록 — patientId만.
        console.error(`[reconcile] compute 실패 patientId=${patientId}:`, e instanceof Error ? e.message : String(e));
        continue;
      }
      cache.set(patientId, computed);
    }

    const drift = diffFields(data, computed);
    if (!drift.length) continue;

    // 카테고리별 카운트.
    if (String(data.lastReservationDate ?? "") === "" && computed.lastReservationDate !== "") stats.missingLastReservationDate += 1;
    if (drift.includes("reservationCount")) stats.reservationCountMismatch += 1;
    if (drift.includes("invoiceCount") || drift.includes("hasInvoice")) stats.invoiceMismatch += 1;
    if (drift.includes("memoCount") || drift.includes("hasMemo")) stats.memoMismatch += 1;
    if (
      drift.includes("settlementCount") ||
      drift.includes("totalSettlementPaid") ||
      drift.includes("totalSettlementRefunded") ||
      drift.includes("netSettlementAmount") ||
      drift.includes("lastSettlementAt")
    ) stats.settlementMismatch += 1;

    stats.wouldUpdatePatients += 1;

    if (DRY_RUN) continue;

    batch.update(d.ref, { ...computed, summaryUpdatedAt: admin.firestore.FieldValue.serverTimestamp() });
    stats.updatedPatients += 1;
    if (++pending >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (!DRY_RUN && pending > 0) await batch.commit();

  console.log(`모드: ${DRY_RUN ? "DRY RUN (수정 없음)" : "APPLY (보정 실행)"}`);
  console.log(JSON.stringify(stats, null, 2));
  console.log("done.");
}

// CLI로 직접 실행될 때만 main()을 돌린다 — 순수 함수(aggregateReservationPages) 단위 테스트가
// 이 모듈을 import할 때 Firestore 접속을 시도하며 즉시 실행되는 것을 막는다.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
