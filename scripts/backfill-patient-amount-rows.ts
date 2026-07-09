/**
 * patientAmountRows materialized 컬렉션 백필 + 예약 파생 필드 채움.
 *
 * 하는 일:
 *  1) reservations 전체 스캔 → patientId + type(deposit/surgery) + groupKey 로 그룹핑
 *  2) 각 그룹의 rep = reservationDate desc (tie-break: docId desc)
 *  3) patientAmountRows 문서 upsert (결정적 문서 ID)
 *  4) 각 예약 문서에 depositGroupKey / surgeryGroupKey 필드 채움 (다를 때만)
 *  5) patients 문서의 depositCount / surgeryCostCount 를 실제 그룹 수로 재설정
 *
 * 실행:
 *   npx tsx scripts/backfill-patient-amount-rows.ts --project mobilecrm-c405e --dry-run
 *   npx tsx scripts/backfill-patient-amount-rows.ts --project mobilecrm-c405e --apply
 *   npx tsx scripts/backfill-patient-amount-rows.ts --key ./serviceAccount.json --apply
 */
import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = process.argv.includes("--dry-run") || !APPLY;
const BATCH_SIZE = 400;
const COLLECTION = "patientAmountRows";

type ReservationRow = {
  docId: string;
  patientId: string;
  reservationId: string;
  reservationDate: string;
  hospital: string;
  consultArea: string;
  doctors: string[];
  depositAmount: string;
  surgeryCost: string;
  depositGroupKey: string;
  surgeryGroupKey: string;
};

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

function cleanTrim(v: unknown): string {
  return String(v ?? "").trim();
}
function normLower(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}
function hasAmountValue(v: unknown): boolean {
  return cleanTrim(v).length > 0;
}
function normalizeDoctors(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((d) => cleanTrim(d)).filter(Boolean);
}
function computeGroupKey(r: { hospital: string; consultArea: string; doctors: string[] }): string {
  return [
    normLower(r.hospital),
    normLower(r.consultArea),
    r.doctors.map(normLower).filter(Boolean).sort().join(","),
  ].join("|");
}
function amountRowDocIdFor(patientId: string, type: "deposit" | "surgery", groupKey: string): string {
  return createHash("sha256").update(`${patientId}|${type}|${groupKey}`).digest("hex").slice(0, 40);
}
// isNewerRep: reservationDate desc, tie-break reservationDocId desc
function isNewerRep(a: { reservationDate: string; docId: string }, b: { reservationDate: string; docId: string }): boolean {
  if (a.reservationDate !== b.reservationDate) return a.reservationDate > b.reservationDate;
  return a.docId > b.docId;
}

type Group = {
  patientId: string;
  type: "deposit" | "surgery";
  groupKey: string;
  rep: ReservationRow;
};

async function main() {
  init();
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  console.log(`[amount-rows] mode=${DRY_RUN ? "dry-run" : "apply"}`);

  // 1) reservations 전체 스캔 (isDeleted=false).
  let last: admin.firestore.QueryDocumentSnapshot | null = null;
  const groups = new Map<string, Group>(); // key = `${patientId}|${type}|${groupKey}`
  const perPatientCounts = new Map<string, { deposit: number; surgery: number }>();
  const reservationPatches: Array<{ ref: admin.firestore.DocumentReference; patch: Record<string, string> }> = [];
  let scannedReservations = 0;

  for (;;) {
    let q = db.collection("reservations")
      .where("isDeleted", "==", false)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(BATCH_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scannedReservations += 1;
      const data = doc.data();
      const row: ReservationRow = {
        docId: doc.id,
        patientId: cleanTrim(data.patientId),
        reservationId: cleanTrim(data.reservationId),
        reservationDate: cleanTrim(data.reservationDate),
        hospital: cleanTrim(data.hospital),
        consultArea: cleanTrim(data.consultArea),
        doctors: normalizeDoctors(data.doctors),
        depositAmount: cleanTrim(data.depositAmount),
        surgeryCost: cleanTrim(data.surgeryCost),
        depositGroupKey: cleanTrim(data.depositGroupKey),
        surgeryGroupKey: cleanTrim(data.surgeryGroupKey),
      };
      if (!row.patientId) continue;

      const gk = computeGroupKey(row);
      const desiredDeposit = hasAmountValue(row.depositAmount) ? gk : "";
      const desiredSurgery = hasAmountValue(row.surgeryCost) ? gk : "";

      // 예약 문서 파생 필드 정정 계획
      const patch: Record<string, string> = {};
      if (row.depositGroupKey !== desiredDeposit) patch.depositGroupKey = desiredDeposit;
      if (row.surgeryGroupKey !== desiredSurgery) patch.surgeryGroupKey = desiredSurgery;
      if (Object.keys(patch).length) reservationPatches.push({ ref: doc.ref, patch });

      // 그룹 rep 선정
      const consider = (type: "deposit" | "surgery") => {
        if (type === "deposit" && !hasAmountValue(row.depositAmount)) return;
        if (type === "surgery" && !hasAmountValue(row.surgeryCost)) return;
        const key = `${row.patientId}|${type}|${gk}`;
        const existing = groups.get(key);
        if (!existing) {
          groups.set(key, { patientId: row.patientId, type, groupKey: gk, rep: row });
          return;
        }
        if (isNewerRep({ reservationDate: row.reservationDate, docId: row.docId }, { reservationDate: existing.rep.reservationDate, docId: existing.rep.docId })) {
          existing.rep = row;
        }
      };
      consider("deposit");
      consider("surgery");
    }

    last = snap.docs[snap.docs.length - 1];
    console.log(`[amount-rows] scanned reservations=${scannedReservations} groups=${groups.size}`);
  }

  // per-patient counts 집계 (materialized 컬렉션 실제 문서 수와 일치시켜야 함)
  for (const g of groups.values()) {
    const c = perPatientCounts.get(g.patientId) || { deposit: 0, surgery: 0 };
    if (g.type === "deposit") c.deposit += 1;
    else c.surgery += 1;
    perPatientCounts.set(g.patientId, c);
  }

  console.log(`[amount-rows] planned rows=${groups.size} planned reservation patches=${reservationPatches.length} planned patient count updates=${perPatientCounts.size}`);

  if (DRY_RUN) {
    console.log("[amount-rows] dry-run done. no writes performed.");
    return;
  }

  // 2) patientAmountRows upsert (chunked batch)
  let rowsCommitted = 0;
  const groupList = [...groups.values()];
  for (let i = 0; i < groupList.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const g of groupList.slice(i, i + BATCH_SIZE)) {
      const docId = amountRowDocIdFor(g.patientId, g.type, g.groupKey);
      const ref = db.collection(COLLECTION).doc(docId);
      const amountField = g.type === "deposit" ? g.rep.depositAmount : g.rep.surgeryCost;
      batch.set(ref, {
        patientId: g.patientId,
        type: g.type,
        groupKey: g.groupKey,
        hospital: g.rep.hospital,
        consultArea: g.rep.consultArea,
        doctors: g.rep.doctors,
        amount: amountField,
        reservationDocId: g.rep.docId,
        reservationId: g.rep.reservationId,
        reservationDate: g.rep.reservationDate,
        createdAt: now,
        updatedAt: now,
        updatedBy: "backfill",
        updatedByUid: "backfill",
      });
    }
    await batch.commit();
    rowsCommitted += Math.min(BATCH_SIZE, groupList.length - i);
    console.log(`[amount-rows] committed rows=${rowsCommitted}/${groupList.length}`);
  }

  // 3) reservation groupKey 필드 정정
  let reservationPatchCommitted = 0;
  for (let i = 0; i < reservationPatches.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const p of reservationPatches.slice(i, i + BATCH_SIZE)) {
      batch.update(p.ref, p.patch);
    }
    await batch.commit();
    reservationPatchCommitted += Math.min(BATCH_SIZE, reservationPatches.length - i);
    console.log(`[amount-rows] committed reservation patches=${reservationPatchCommitted}/${reservationPatches.length}`);
  }

  // 4) patients.depositCount / surgeryCostCount 재기록
  //    patientId -> patients 문서(들) — 같은 patientId 가 여러 문서에 있을 수 있으므로 all merge.
  const patientIds = [...perPatientCounts.keys()];
  let patientsCommitted = 0;
  const P_CHUNK = 100;
  for (let i = 0; i < patientIds.length; i += P_CHUNK) {
    const slice = patientIds.slice(i, i + P_CHUNK);
    for (const pid of slice) {
      const counts = perPatientCounts.get(pid)!;
      const patSnap = await db.collection("patients").where("patientId", "==", pid).get();
      if (patSnap.empty) continue;
      const batch = db.batch();
      for (const d of patSnap.docs) {
        batch.update(d.ref, { depositCount: counts.deposit, surgeryCostCount: counts.surgery });
      }
      await batch.commit();
      patientsCommitted += patSnap.docs.length;
    }
    console.log(`[amount-rows] committed patients=${patientsCommitted}`);
  }

  // 5) patients 문서 중 patientAmountRows 가 없는 (count = 0) 환자의 카운트도 0 으로 정정.
  //    (이번 스캔에는 잡히지 않는 patientId — 예약이 없거나 금액이 없는 환자)
  let zeroedPatients = 0;
  let patLast: admin.firestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let pq = db.collection("patients").orderBy(admin.firestore.FieldPath.documentId()).limit(BATCH_SIZE);
    if (patLast) pq = pq.startAfter(patLast);
    const psnap = await pq.get();
    if (psnap.empty) break;
    const batch = db.batch();
    let batchWrites = 0;
    for (const d of psnap.docs) {
      const data = d.data();
      const pid = cleanTrim(data.patientId);
      if (!pid) continue;
      if (perPatientCounts.has(pid)) continue; // 이미 위에서 반영됨
      const curDeposit = Number(data.depositCount || 0);
      const curSurgery = Number(data.surgeryCostCount || 0);
      if (curDeposit === 0 && curSurgery === 0) continue;
      batch.update(d.ref, { depositCount: 0, surgeryCostCount: 0 });
      batchWrites += 1;
      zeroedPatients += 1;
    }
    if (batchWrites > 0) await batch.commit();
    patLast = psnap.docs[psnap.docs.length - 1];
    if (psnap.docs.length < BATCH_SIZE) break;
  }
  console.log(`[amount-rows] zeroed patients=${zeroedPatients}`);

  console.log(`[amount-rows] done. rows=${rowsCommitted} reservationPatches=${reservationPatchCommitted} patients=${patientsCommitted} zeroed=${zeroedPatients}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
