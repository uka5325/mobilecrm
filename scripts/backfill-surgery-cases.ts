/**
 * reservations/settlements/invoices를 surgeryCases 기준으로 백필한다.
 *
 * 기본은 dry-run이며 --apply를 명시해야만 쓴다.
 * 자동 병합은 같은 환자 + 같은 병원 + 같은 항목이고, 상담 뒤 365일 안의 수술 후보가
 * 정확히 하나인 경우에만 수행한다. 다중 활성 인보이스가 생기는 그룹은 건너뛴다.
 *
 * 예:
 *   npm run backfill:surgery-cases -- --project <project-id> --key ./serviceAccount.json
 *   npm run backfill:surgery-cases -- --project <project-id> --key ./serviceAccount.json --apply
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as admin from "firebase-admin";
import { aggregateSettlementRows } from "../lib/settlementMath";
import { surgeryCaseAggregatePatch } from "../lib/surgeryCaseAggregates";
import { calcCommission } from "../lib/commissionUtils";

type Item = {
  id: string;
  ref: admin.firestore.DocumentReference;
  data: Record<string, unknown>;
};

const APPLY = process.argv.includes("--apply");
const MAX_DAYS = 365;

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalized(value: unknown) {
  return clean(value).toLowerCase().replace(/[\s,./|·()\-_]+/g, "");
}

function dayValue(value: unknown) {
  const time = Date.parse(`${clean(value)}T00:00:00Z`);
  return Number.isFinite(time) ? time : Number.NaN;
}

function init() {
  if (admin.apps.length) return;
  const projectId = argValue("--project") || process.env.GOOGLE_CLOUD_PROJECT || "";
  const keyPath = argValue("--key");
  const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const credential = keyPath
    ? admin.credential.cert(JSON.parse(readFileSync(keyPath, "utf8")) as admin.ServiceAccount)
    : envKey
      ? admin.credential.cert(JSON.parse(envKey) as admin.ServiceAccount)
      : admin.credential.applicationDefault();
  admin.initializeApp({ credential, ...(projectId ? { projectId } : {}) });
  console.log(`[surgery-case-backfill] mode=${APPLY ? "APPLY" : "DRY-RUN"} project=${projectId || "auto"}`);
}

function items(snapshot: admin.firestore.QuerySnapshot): Item[] {
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    data: doc.data() as Record<string, unknown>,
  }));
}

class DisjointSet {
  private parent = new Map<string, string>();

  add(id: string) {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    const parent = this.parent.get(id) || id;
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

function generatedCaseId(reservationIds: string[]) {
  const digest = createHash("sha256").update([...reservationIds].sort().join("|")).digest("hex").slice(0, 24);
  return `SC-${digest}`;
}

async function commitOperations(
  db: admin.firestore.Firestore,
  operations: Array<{ ref: admin.firestore.DocumentReference; data: Record<string, unknown>; merge: boolean }>
) {
  if (!APPLY) return;
  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = db.batch();
    for (const operation of operations.slice(offset, offset + 400)) {
      batch.set(operation.ref, operation.data, { merge: operation.merge });
    }
    await batch.commit();
  }
}

async function main() {
  init();
  const db = admin.firestore();
  const [reservationSnap, settlementSnap, invoiceSnap] = await Promise.all([
    db.collection("reservations").get(),
    db.collection("settlements").get(),
    db.collection("invoices").get(),
  ]);
  const reservations = items(reservationSnap).filter((item) => item.data.isDeleted !== true);
  const settlements = items(settlementSnap);
  const invoices = items(invoiceSnap).filter((item) => item.data.isDeleted !== true);
  const reservationById = new Map(reservations.map((item) => [item.id, item]));
  const dsu = new DisjointSet();
  reservations.forEach((item) => dsu.add(item.id));

  const byExistingCase = new Map<string, string[]>();
  for (const reservation of reservations) {
    const caseId = clean(reservation.data.surgeryCaseId);
    if (!caseId) continue;
    const list = byExistingCase.get(caseId) || [];
    list.push(reservation.id);
    byExistingCase.set(caseId, list);
  }
  for (const ids of byExistingCase.values()) {
    ids.slice(1).forEach((id) => dsu.union(ids[0], id));
  }

  for (const invoice of invoices) {
    const linkedIds = Array.isArray(invoice.data.reservationDocIds)
      ? invoice.data.reservationDocIds.map(clean).filter((id) => reservationById.has(id))
      : [clean(invoice.data.reservationDocId)].filter((id) => reservationById.has(id));
    linkedIds.slice(1).forEach((id) => dsu.union(linkedIds[0], id));
  }

  const candidateBuckets = new Map<string, { consultations: Item[]; surgeries: Item[] }>();
  for (const reservation of reservations) {
    const patientId = clean(reservation.data.patientId);
    const hospital = normalized(reservation.data.hospital);
    const area = normalized(reservation.data.consultArea);
    const appointmentType = clean(reservation.data.appointmentType);
    if (!patientId || !hospital || !area || (appointmentType !== "상담" && appointmentType !== "수술")) continue;
    const key = `${patientId}|${hospital}|${area}`;
    const bucket = candidateBuckets.get(key) || { consultations: [], surgeries: [] };
    (appointmentType === "상담" ? bucket.consultations : bucket.surgeries).push(reservation);
    candidateBuckets.set(key, bucket);
  }

  let autoLinkedPairs = 0;
  let ambiguousCandidates = 0;
  const ambiguousSamples: Array<{ surgeryReservationDocId: string; consultationReservationDocIds: string[] }> = [];
  for (const bucket of candidateBuckets.values()) {
    const usedConsultations = new Set<string>();
    const surgeries = [...bucket.surgeries].sort((a, b) => dayValue(a.data.reservationDate) - dayValue(b.data.reservationDate));
    for (const surgery of surgeries) {
      const surgeryDay = dayValue(surgery.data.reservationDate);
      const candidates = bucket.consultations.filter((consultation) => {
        if (usedConsultations.has(consultation.id)) return false;
        const consultationDay = dayValue(consultation.data.reservationDate);
        const difference = surgeryDay - consultationDay;
        return Number.isFinite(difference) && difference >= 0 && difference <= MAX_DAYS * 86400000;
      });
      if (candidates.length === 1) {
        dsu.union(candidates[0].id, surgery.id);
        usedConsultations.add(candidates[0].id);
        autoLinkedPairs += 1;
      } else if (candidates.length > 1) {
        ambiguousCandidates += 1;
        if (ambiguousSamples.length < 20) {
          ambiguousSamples.push({
            surgeryReservationDocId: surgery.id,
            consultationReservationDocIds: candidates.map((item) => item.id),
          });
        }
      }
    }
  }

  const groups = new Map<string, Item[]>();
  for (const reservation of reservations) {
    const root = dsu.find(reservation.id);
    const list = groups.get(root) || [];
    list.push(reservation);
    groups.set(root, list);
  }

  const invoiceByReservation = new Map<string, Item[]>();
  for (const invoice of invoices) {
    const ids = Array.isArray(invoice.data.reservationDocIds)
      ? invoice.data.reservationDocIds.map(clean).filter(Boolean)
      : [clean(invoice.data.reservationDocId)].filter(Boolean);
    for (const id of ids) {
      const list = invoiceByReservation.get(id) || [];
      list.push(invoice);
      invoiceByReservation.set(id, list);
    }
  }

  const operations: Array<{ ref: admin.firestore.DocumentReference; data: Record<string, unknown>; merge: boolean }> = [];
  const skippedGroups: Array<{ reservationIds: string[]; reason: string }> = [];
  let caseCount = 0;
  let reservationWrites = 0;
  let settlementWrites = 0;
  let invoiceWrites = 0;
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const group of groups.values()) {
    const reservationIds = group.map((item) => item.id).sort();
    const groupInvoices = new Map<string, Item>();
    reservationIds.forEach((id) => (invoiceByReservation.get(id) || []).forEach((invoice) => groupInvoices.set(invoice.id, invoice)));
    if (groupInvoices.size > 1) {
      skippedGroups.push({ reservationIds, reason: `${groupInvoices.size} active invoices` });
      continue;
    }
    const patients = new Set(group.map((item) => clean(item.data.patientId)).filter(Boolean));
    if (patients.size !== 1) {
      skippedGroups.push({ reservationIds, reason: `${patients.size} patientIds` });
      continue;
    }
    const existingCaseIds = [...new Set(group.map((item) => clean(item.data.surgeryCaseId)).filter(Boolean))];
    if (existingCaseIds.length > 1) {
      skippedGroups.push({ reservationIds, reason: `${existingCaseIds.length} existing surgeryCaseIds` });
      continue;
    }
    const surgeryCaseId = existingCaseIds[0] || generatedCaseId(reservationIds);
    const patientId = [...patients][0];
    const groupSettlementRows = settlements.filter((settlement) => reservationIds.includes(clean(settlement.data.reservationDocId)));
    const aggregate = aggregateSettlementRows(groupSettlementRows.map((item) => item.data));
    const invoice = [...groupInvoices.values()][0];

    operations.push({
      ref: db.collection("surgeryCases").doc(surgeryCaseId),
      merge: true,
      data: {
        patientId,
        reservationDocIds: reservationIds,
        primaryReservationDocId: clean(invoice?.data.reservationDocId) || reservationIds[0],
        invoiceDocId: invoice?.id || "",
        invoiceId: clean(invoice?.data.invoiceId),
        isDeleted: false,
        ...surgeryCaseAggregatePatch(aggregate),
        backfilledAt: now,
        updatedAt: now,
        updatedBy: "surgery-case-backfill",
      },
    });
    caseCount += 1;

    for (const reservation of group) {
      if (clean(reservation.data.surgeryCaseId) === surgeryCaseId) continue;
      operations.push({
        ref: reservation.ref,
        merge: true,
        data: { surgeryCaseId, updatedAt: now, updatedBy: "surgery-case-backfill" },
      });
      reservationWrites += 1;
    }
    for (const settlement of groupSettlementRows) {
      if (clean(settlement.data.surgeryCaseId) === surgeryCaseId) continue;
      operations.push({
        ref: settlement.ref,
        merge: true,
        data: { surgeryCaseId, updatedAt: now, updatedBy: "surgery-case-backfill" },
      });
      settlementWrites += 1;
    }
    if (invoice) {
      const rate = invoice.data.commissionRate === null || invoice.data.commissionRate === undefined
        ? null
        : Number(invoice.data.commissionRate);
      operations.push({
        ref: invoice.ref,
        merge: true,
        data: {
          surgeryCaseId,
          reservationDocIds: reservationIds,
          totalAmount: aggregate.netAmount,
          paymentMethod: aggregate.paymentMethod ?? null,
          cardAmount: aggregate.cardAmount,
          cashAmount: aggregate.cashAmount,
          bankTransferAmount: aggregate.methodTotals.bank_transfer,
          foreignCardAmount: aggregate.methodTotals.foreign_card,
          otherAmount: aggregate.methodTotals.other,
          settlementPaidAmount: aggregate.totalPaid,
          settlementRefundAmount: aggregate.totalRefunded,
          settlementCount: aggregate.count,
          commissionBase: aggregate.commissionBase,
          commissionAmount: rate !== null && Number.isFinite(rate)
            ? calcCommission(aggregate.commissionBase, rate)
            : null,
          backfilledAt: now,
          updatedAt: now,
          updatedBy: "surgery-case-backfill",
        },
      });
      invoiceWrites += 1;
    }
  }

  console.log(JSON.stringify({
    mode: APPLY ? "apply" : "dry-run",
    reservations: reservations.length,
    settlements: settlements.length,
    activeInvoices: invoices.length,
    autoLinkedPairs,
    ambiguousCandidates,
    ambiguousSamples,
    surgeryCases: caseCount,
    reservationWrites,
    settlementWrites,
    invoiceWrites,
    skippedGroups: skippedGroups.length,
    skippedSamples: skippedGroups.slice(0, 20),
  }, null, 2));

  await commitOperations(db, operations);
  if (!APPLY) console.log("DRY-RUN 완료: 실제 변경 없음. 검토 후 --apply를 추가하세요.");
  else console.log(`APPLY 완료: ${operations.length} writes`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
