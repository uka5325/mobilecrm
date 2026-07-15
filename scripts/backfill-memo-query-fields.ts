import * as admin from "firebase-admin";
import { readFileSync, writeFileSync } from "node:fs";

type Mode = "dry-run" | "apply" | "verify";
type Target = "reservation-notes" | "conference-memos" | "all";

type Finding = {
  collection: "reservationNotes" | "conferenceMemos";
  id: string;
  updateFields: string[];
  issues: string[];
  updates: Record<string, unknown>;
};

const MODE: Mode = process.argv.includes("--apply")
  ? "apply"
  : process.argv.includes("--verify")
    ? "verify"
    : "dry-run";

function argValue(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

const rawTarget = argValue("--target") || "all";
if (!["reservation-notes", "conference-memos", "all"].includes(rawTarget)) {
  throw new Error("--target must be reservation-notes, conference-memos, or all");
}
const TARGET = rawTarget as Target;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function hasOwn(data: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, field);
}

function firstText(data: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = clean(data[field]);
    if (value) return value;
  }
  return "";
}

function normalizeDateOnly(value: unknown): string | null {
  const raw = clean(value);
  const match = raw.match(/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function init() {
  if (admin.apps.length) return;

  const projectId =
    argValue("--project") ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    "";
  const keyPath = argValue("--key");
  const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  const credential = keyPath
    ? admin.credential.cert(JSON.parse(readFileSync(keyPath, "utf8")) as admin.ServiceAccount)
    : envKey
      ? admin.credential.cert(JSON.parse(envKey) as admin.ServiceAccount)
      : admin.credential.applicationDefault();

  admin.initializeApp({
    credential,
    ...(projectId ? { projectId } : {}),
  });

  console.log(
    `[memo-query-backfill] auth=${keyPath || envKey ? "service-account" : "application-default"} ` +
      `project=${projectId || "auto"} target=${TARGET} mode=${MODE}`
  );
}

function reportPath(): string {
  const requested = argValue("--report");
  if (requested) return requested;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `memo-query-backfill-${TARGET}-${MODE}-${stamp}.json`;
}

async function reservationLookups(db: admin.firestore.Firestore) {
  const snapshot = await db.collection("reservations").get();
  const byDocId = new Map<string, Record<string, unknown>>();
  const byReservationId = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>();

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    byDocId.set(doc.id, data);
    const reservationId = clean(data.reservationId);
    if (!reservationId) continue;
    const matches = byReservationId.get(reservationId) || [];
    matches.push({ id: doc.id, data });
    byReservationId.set(reservationId, matches);
  }

  return { byDocId, byReservationId };
}

async function analyzeReservationNotes(db: admin.firestore.Firestore): Promise<Finding[]> {
  const [snapshot, reservations] = await Promise.all([
    db.collection("reservationNotes").get(),
    reservationLookups(db),
  ]);
  const findings: Finding[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    const issues: string[] = [];

    if (!hasOwn(data, "isDeleted")) {
      updates.isDeleted = data.deleted === true || data.deletedAt != null;
    }
    if (data.createdAt == null) {
      updates.createdAt = data.updatedAt ?? doc.createTime;
    }

    const memoText = firstText(data, ["memoText", "memo", "note", "content", "text"]);
    if (!clean(data.memoText) && memoText) updates.memoText = memoText;
    if (!memoText) issues.push("memo text is empty");

    let reservationDocId = clean(data.reservationDocId);
    let reservation = reservationDocId ? reservations.byDocId.get(reservationDocId) : undefined;
    if (!reservation) {
      const reservationId = clean(data.reservationId);
      const matches = reservationId ? reservations.byReservationId.get(reservationId) || [] : [];
      if (matches.length === 1) {
        reservationDocId = matches[0].id;
        reservation = matches[0].data;
        if (!clean(data.reservationDocId)) updates.reservationDocId = reservationDocId;
      } else if (!clean(data.patientId)) {
        issues.push(matches.length > 1 ? "ambiguous reservationId" : "reservation not found");
      }
    }

    if (!clean(data.patientId) && reservation) {
      const patientId = clean(reservation.patientId);
      if (patientId) updates.patientId = patientId;
      else issues.push("linked reservation has no patientId");
    }
    if (!clean(data.patientId) && !updates.patientId && !issues.includes("reservation not found")) {
      issues.push("patientId is empty");
    }

    if (Object.keys(updates).length || issues.length) {
      findings.push({
        collection: "reservationNotes",
        id: doc.id,
        updateFields: Object.keys(updates),
        issues,
        updates,
      });
    }
  }

  return findings;
}

async function analyzeConferenceMemos(db: admin.firestore.Firestore): Promise<Finding[]> {
  const snapshot = await db.collection("conferenceMemos").get();
  const findings: Finding[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    const issues: string[] = [];

    if (!hasOwn(data, "deleted")) {
      updates.deleted = data.deletedAt != null;
    }
    if (data.createdAt == null) {
      updates.createdAt = data.updatedAt ?? doc.createTime;
    }

    const normalizedDate = normalizeDateOnly(data.memoDate);
    if (!normalizedDate) {
      issues.push("memoDate is missing or invalid");
    } else if (clean(data.memoDate) !== normalizedDate) {
      updates.memoDate = normalizedDate;
    }

    if (!clean(data.memoText)) issues.push("memoText is empty");

    if (Object.keys(updates).length || issues.length) {
      findings.push({
        collection: "conferenceMemos",
        id: doc.id,
        updateFields: Object.keys(updates),
        issues,
        updates,
      });
    }
  }

  return findings;
}

async function applyFindings(db: admin.firestore.Firestore, findings: Finding[]) {
  const applicable = findings.filter((finding) => finding.updateFields.length > 0);
  let applied = 0;

  for (let index = 0; index < applicable.length; index += 400) {
    const batch = db.batch();
    const chunk = applicable.slice(index, index + 400);
    for (const finding of chunk) {
      batch.update(db.collection(finding.collection).doc(finding.id), finding.updates);
    }
    await batch.commit();
    applied += chunk.length;
    console.log(`[memo-query-backfill] applied ${applied}/${applicable.length}`);
  }

  return applied;
}

function summarize(findings: Finding[]) {
  const result = {
    documents: findings.length,
    autoFixable: findings.filter((finding) => finding.updateFields.length > 0).length,
    manualReview: findings.filter((finding) => finding.issues.length > 0).length,
    fields: {} as Record<string, number>,
  };
  for (const finding of findings) {
    for (const field of finding.updateFields) {
      result.fields[field] = (result.fields[field] || 0) + 1;
    }
  }
  return result;
}

async function analyze(db: admin.firestore.Firestore) {
  const findings: Finding[] = [];
  if (TARGET === "reservation-notes" || TARGET === "all") {
    findings.push(...await analyzeReservationNotes(db));
  }
  if (TARGET === "conference-memos" || TARGET === "all") {
    findings.push(...await analyzeConferenceMemos(db));
  }
  return findings;
}

async function main() {
  init();
  const db = admin.firestore();
  const before = await analyze(db);
  console.log("before:", summarize(before));

  let applied = 0;
  if (MODE === "apply") {
    applied = await applyFindings(db, before);
  }

  const after = MODE === "apply" ? await analyze(db) : before;
  console.log("after:", summarize(after));

  const output = {
    generatedAt: new Date().toISOString(),
    mode: MODE,
    target: TARGET,
    applied,
    before: summarize(before),
    after: summarize(after),
    findings: after.map(({ updates: _updates, ...finding }) => finding),
  };
  const path = reportPath();
  writeFileSync(path, JSON.stringify(output, null, 2), "utf8");
  console.log(`report: ${path}`);

  const remainingUpdates = after.some((finding) => finding.updateFields.length > 0);
  const manualReview = after.some((finding) => finding.issues.length > 0);
  if (MODE === "verify" && (remainingUpdates || manualReview)) process.exitCode = 2;
  if (MODE === "apply" && remainingUpdates) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
