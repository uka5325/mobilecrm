/**
 * 예약(reservations) 문서에서 기존 금액 필드(legacy amounts)를 read-only로 백업 export.
 *
 * 목적: depositAmount / surgeryCost 필드를 제거·마이그레이션하기 전에
 *       CSV(전체 + 비어있지 않은 것) + JSON 원본을 안전하게 내려받는다.
 *       DB에 쓰기(write)는 하지 않는다 — 순수 read-only.
 *
 * 산출물 (기본 ./exports/):
 *   reservations_legacy_amounts_all.csv
 *     - 모든 예약(활성) — depositAmount/surgeryCost 필드가 빈 값이어도 포함
 *   reservations_legacy_amounts_non_empty.csv
 *     - depositAmount 또는 surgeryCost가 있는 예약만
 *   reservations_legacy_amounts_backup.json
 *     - 각 대상 예약의 원본 필드(전체) + 첨부된 memo 배열
 *
 * CSV 컬럼:
 *   reservationId, patientId, patientName,
 *   date, time, department, category,
 *   type, depositAmount, surgeryCost,
 *   hasDepositAmount, hasSurgeryCost,
 *   memo, createdAt, updatedAt
 *
 *     date       = reservationDate
 *     time       = reservationTime
 *     department = hospital (병원)
 *     category   = consultArea (시술/부위)
 *     type       = appointmentType (상담/수술/시술/…)
 *     memo       = reservationNotes 컬렉션의 memoText들을 " | " 로 join
 *
 * 실행:
 *   1) Google Cloud Shell (ADC — 키 불필요):
 *        npx tsx scripts/export-reservations-legacy-amounts.ts --project mobilecrm-c405e
 *   2) 로컬 (서비스 계정 키):
 *        npx tsx scripts/export-reservations-legacy-amounts.ts --key ./serviceAccount.json
 *   3) 환경변수:
 *        FIREBASE_SERVICE_ACCOUNT_KEY='{...}' npx tsx scripts/export-reservations-legacy-amounts.ts
 *
 * 옵션:
 *   --out-dir <path>     산출물 저장 경로 (기본: ./exports)
 *   --include-deleted    isDeleted=true 문서도 포함 (기본: 제외)
 *   --skip-memos         reservationNotes 조인 skip (속도용, memo 컬럼은 빈 값)
 */
import * as admin from "firebase-admin";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCsvContent } from "../lib/csv";

const OUT_DIR_IDX = process.argv.indexOf("--out-dir");
const OUT_DIR = OUT_DIR_IDX !== -1 ? process.argv[OUT_DIR_IDX + 1] : "./exports";
const INCLUDE_DELETED = process.argv.includes("--include-deleted");
const SKIP_MEMOS = process.argv.includes("--skip-memos");
const READ_BATCH_SIZE = 500;

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

function s(v: unknown): string {
  return String(v ?? "").trim();
}

// Firestore Timestamp / Date / string 을 ISO 문자열로 정규화 (표시 안정성).
function normalizeTimestamp(v: unknown): string {
  if (!v) return "";
  if (v instanceof admin.firestore.Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate?: unknown }).toDate === "function") {
    try {
      return ((v as { toDate: () => Date }).toDate()).toISOString();
    } catch {
      return String(v);
    }
  }
  return String(v);
}

type MemoRow = { reservationId: string; reservationDocId: string; memoText: string; createdAt: unknown };

async function readAllMemos(db: admin.firestore.Firestore): Promise<Map<string, string[]>> {
  // reservationId 기준으로 join 하기 위해 전체 memo를 한 번에 스캔.
  // 크기가 크면 페이지네이션이 필요할 수 있으나, 여기서는 orderBy(documentId)로 안전하게 순회.
  const byResId = new Map<string, MemoRow[]>();
  const byResDocId = new Map<string, MemoRow[]>();

  let last: admin.firestore.QueryDocumentSnapshot | null = null;
  let scanned = 0;

  for (;;) {
    let q = db
      .collection("reservationNotes")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(READ_BATCH_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.isDeleted === true) continue;
      const memoText = s(d.memoText || d.memo || d.note || d.content || d.text);
      if (!memoText) continue;

      const reservationId = s(d.reservationId);
      const reservationDocId = s(d.reservationDocId);
      const row: MemoRow = { reservationId, reservationDocId, memoText, createdAt: d.createdAt };

      if (reservationId) {
        const arr = byResId.get(reservationId) || [];
        arr.push(row);
        byResId.set(reservationId, arr);
      }
      if (reservationDocId) {
        const arr = byResDocId.get(reservationDocId) || [];
        arr.push(row);
        byResDocId.set(reservationDocId, arr);
      }
    }

    scanned += snap.size;
    last = snap.docs[snap.docs.length - 1];
    console.log(`[memos] scanned=${scanned}`);
  }

  // 예약 문서 조회 시 reservationId 또는 docId 로 매칭할 수 있도록 통합 맵을 반환.
  // key 는 "id:" + reservationId 또는 "doc:" + reservationDocId.
  const joined = new Map<string, string[]>();
  for (const [key, rows] of byResId) {
    joined.set(
      `id:${key}`,
      rows
        .sort((a, b) => normalizeTimestamp(a.createdAt).localeCompare(normalizeTimestamp(b.createdAt)))
        .map((r) => r.memoText)
    );
  }
  for (const [key, rows] of byResDocId) {
    joined.set(
      `doc:${key}`,
      rows
        .sort((a, b) => normalizeTimestamp(a.createdAt).localeCompare(normalizeTimestamp(b.createdAt)))
        .map((r) => r.memoText)
    );
  }
  return joined;
}

function hasAmountValue(v: unknown): boolean {
  return s(v).length > 0;
}

type Row = {
  reservationId: string;
  patientId: string;
  patientName: string;
  date: string;
  time: string;
  department: string;
  category: string;
  type: string;
  depositAmount: string;
  surgeryCost: string;
  hasDepositAmount: boolean;
  hasSurgeryCost: boolean;
  memo: string;
  createdAt: string;
  updatedAt: string;
};

const CSV_HEADER = [
  "reservationId",
  "patientId",
  "patientName",
  "date",
  "time",
  "department",
  "category",
  "type",
  "depositAmount",
  "surgeryCost",
  "hasDepositAmount",
  "hasSurgeryCost",
  "memo",
  "createdAt",
  "updatedAt",
];

function toCsvRows(rows: Row[]): unknown[][] {
  return [
    CSV_HEADER,
    ...rows.map((r) => [
      r.reservationId,
      r.patientId,
      r.patientName,
      r.date,
      r.time,
      r.department,
      r.category,
      r.type,
      r.depositAmount,
      r.surgeryCost,
      r.hasDepositAmount ? "true" : "false",
      r.hasSurgeryCost ? "true" : "false",
      r.memo,
      r.createdAt,
      r.updatedAt,
    ]),
  ];
}

async function main() {
  init();
  const db = admin.firestore();
  const outDir = resolve(process.cwd(), OUT_DIR);
  mkdirSync(outDir, { recursive: true });

  const memoMap = SKIP_MEMOS ? new Map<string, string[]>() : await readAllMemos(db);
  if (SKIP_MEMOS) console.log("[memos] skipped (--skip-memos)");

  const allRows: Row[] = [];
  const backupDocs: Array<Record<string, unknown> & { _memos: string[] }> = [];

  let last: admin.firestore.QueryDocumentSnapshot | null = null;
  let scanned = 0;
  let included = 0;

  for (;;) {
    let q = db
      .collection("reservations")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(READ_BATCH_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      const data = doc.data();
      if (!INCLUDE_DELETED && data.isDeleted === true) continue;

      const reservationId = s(data.reservationId) || doc.id;
      const memos = memoMap.get(`id:${reservationId}`) || memoMap.get(`doc:${doc.id}`) || [];

      const row: Row = {
        reservationId,
        patientId: s(data.patientId),
        patientName: s(data.patientName || data.name),
        date: s(data.reservationDate),
        time: s(data.reservationTime),
        department: s(data.hospital),
        category: s(data.consultArea),
        type: s(data.appointmentType),
        depositAmount: s(data.depositAmount),
        surgeryCost: s(data.surgeryCost),
        hasDepositAmount: hasAmountValue(data.depositAmount),
        hasSurgeryCost: hasAmountValue(data.surgeryCost),
        memo: memos.join(" | "),
        createdAt: normalizeTimestamp(data.createdAt),
        updatedAt: normalizeTimestamp(data.updatedAt),
      };
      allRows.push(row);
      included += 1;

      backupDocs.push({
        _docId: doc.id,
        _memos: memos,
        ...data,
        createdAt: normalizeTimestamp(data.createdAt),
        updatedAt: normalizeTimestamp(data.updatedAt),
      });
    }

    last = snap.docs[snap.docs.length - 1];
    console.log(`[reservations] scanned=${scanned} included=${included}`);
  }

  const nonEmptyRows = allRows.filter((r) => r.hasDepositAmount || r.hasSurgeryCost);

  const allCsvPath = resolve(outDir, "reservations_legacy_amounts_all.csv");
  const nonEmptyCsvPath = resolve(outDir, "reservations_legacy_amounts_non_empty.csv");
  const jsonPath = resolve(outDir, "reservations_legacy_amounts_backup.json");

  writeFileSync(allCsvPath, buildCsvContent(toCsvRows(allRows)));
  writeFileSync(nonEmptyCsvPath, buildCsvContent(toCsvRows(nonEmptyRows)));
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        includeDeleted: INCLUDE_DELETED,
        skipMemos: SKIP_MEMOS,
        totalScanned: scanned,
        totalIncluded: included,
        totalNonEmpty: nonEmptyRows.length,
        reservations: backupDocs,
      },
      null,
      2
    )
  );

  console.log("");
  console.log(`[done] scanned=${scanned} included=${included} nonEmpty=${nonEmptyRows.length}`);
  console.log(`  ${allCsvPath}`);
  console.log(`  ${nonEmptyCsvPath}`);
  console.log(`  ${jsonPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
