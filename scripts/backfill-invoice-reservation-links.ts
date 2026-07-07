import * as admin from "firebase-admin";
import { readFileSync, writeFileSync } from "node:fs";

type Mode = "dry-run" | "apply" | "verify";
type FindingStatus =
  | "HEALTHY"
  | "AUTO_FIXABLE"
  | "DELETED_SKIPPED"
  | "RESERVATION_NOT_FOUND"
  | "AMBIGUOUS_RESERVATION_ID"
  | "PATIENT_MISMATCH"
  | "RESERVATION_ID_MISMATCH"
  | "DUPLICATE_ACTIVE_INVOICE"
  | "RESERVATION_ALREADY_LINKED";

type DocItem = {
  id: string;
  ref: admin.firestore.DocumentReference;
  data: Record<string, unknown>;
};

type Finding = {
  status: FindingStatus;
  invoiceDocId: string;
  invoiceId: string;
  patientId: string;
  reservationId: string;
  currentReservationDocId: string;
  matchedReservationDocId: string;
  reasons: string[];
};

type ApplyResult = {
  invoiceDocId: string;
  reservationDocId: string;
  success: boolean;
  error?: string;
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

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function getServiceAccountJson(): string {
  const keyPath = argValue("--key");
  if (keyPath) return readFileSync(keyPath, "utf8");
  const env = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (env) return env;
  throw new Error(
    "서비스 계정 키가 필요합니다. '--key <serviceAccount.json>' 또는 " +
      "FIREBASE_SERVICE_ACCOUNT_KEY 환경변수를 지정하세요."
  );
}

function init() {
  if (admin.apps.length) return;
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(getServiceAccountJson()) as admin.ServiceAccount),
  });
}

function toItems(snapshot: admin.firestore.QuerySnapshot): DocItem[] {
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    data: doc.data() as Record<string, unknown>,
  }));
}

function summarize(findings: Finding[]) {
  const counts: Record<string, number> = {};
  for (const finding of findings) counts[finding.status] = (counts[finding.status] || 0) + 1;
  return counts;
}

function isManualStatus(status: FindingStatus): boolean {
  return status !== "HEALTHY" && status !== "AUTO_FIXABLE" && status !== "DELETED_SKIPPED";
}

function analyze(invoiceItems: DocItem[], reservationItems: DocItem[]): Finding[] {
  const reservationByDocId = new Map(reservationItems.map((item) => [item.id, item]));
  const reservationsByReservationId = new Map<string, DocItem[]>();
  for (const reservation of reservationItems) {
    const reservationId = clean(reservation.data.reservationId);
    if (!reservationId) continue;
    const list = reservationsByReservationId.get(reservationId) || [];
    list.push(reservation);
    reservationsByReservationId.set(reservationId, list);
  }

  const invoiceByDocId = new Map(invoiceItems.map((item) => [item.id, item]));
  const activeInvoiceByInvoiceId = new Map<string, DocItem[]>();
  for (const invoice of invoiceItems) {
    if (invoice.data.isDeleted === true) continue;
    const invoiceId = clean(invoice.data.invoiceId);
    if (!invoiceId) continue;
    const list = activeInvoiceByInvoiceId.get(invoiceId) || [];
    list.push(invoice);
    activeInvoiceByInvoiceId.set(invoiceId, list);
  }

  const provisional = new Map<string, { reservation?: DocItem; status?: FindingStatus; reasons: string[] }>();

  for (const invoice of invoiceItems) {
    const data = invoice.data;
    if (data.isDeleted === true) {
      provisional.set(invoice.id, { status: "DELETED_SKIPPED", reasons: ["soft-deleted invoice"] });
      continue;
    }

    const currentReservationDocId = clean(data.reservationDocId);
    if (currentReservationDocId) {
      const linked = reservationByDocId.get(currentReservationDocId);
      if (linked) {
        provisional.set(invoice.id, { reservation: linked, reasons: [] });
        continue;
      }
    }

    const reservationId = clean(data.reservationId);
    if (!reservationId) {
      provisional.set(invoice.id, {
        status: "RESERVATION_NOT_FOUND",
        reasons: ["reservationDocId is empty or dangling and reservationId is empty"],
      });
      continue;
    }

    const matches = reservationsByReservationId.get(reservationId) || [];
    if (matches.length === 0) {
      provisional.set(invoice.id, {
        status: "RESERVATION_NOT_FOUND",
        reasons: ["no reservation matches reservationId"],
      });
      continue;
    }
    if (matches.length > 1) {
      provisional.set(invoice.id, {
        status: "AMBIGUOUS_RESERVATION_ID",
        reasons: [`reservationId matches ${matches.length} reservations`],
      });
      continue;
    }
    provisional.set(invoice.id, { reservation: matches[0], reasons: [] });
  }

  const invoiceIdsByCandidate = new Map<string, string[]>();
  for (const invoice of invoiceItems) {
    if (invoice.data.isDeleted === true) continue;
    const candidate = provisional.get(invoice.id)?.reservation;
    if (!candidate) continue;
    const list = invoiceIdsByCandidate.get(candidate.id) || [];
    list.push(invoice.id);
    invoiceIdsByCandidate.set(candidate.id, list);
  }

  const findings: Finding[] = [];
  for (const invoice of invoiceItems) {
    const data = invoice.data;
    const base: Omit<Finding, "status" | "reasons"> = {
      invoiceDocId: invoice.id,
      invoiceId: clean(data.invoiceId),
      patientId: clean(data.patientId),
      reservationId: clean(data.reservationId),
      currentReservationDocId: clean(data.reservationDocId),
      matchedReservationDocId: "",
    };

    const pre = provisional.get(invoice.id) || { reasons: [] };
    if (pre.status) {
      findings.push({ ...base, status: pre.status, reasons: pre.reasons });
      continue;
    }

    const reservation = pre.reservation;
    if (!reservation) {
      findings.push({
        ...base,
        status: "RESERVATION_NOT_FOUND",
        reasons: ["no deterministic reservation candidate"],
      });
      continue;
    }

    base.matchedReservationDocId = reservation.id;
    const reservationData = reservation.data;
    const reservationPatientId = clean(reservationData.patientId);
    const reservationId = clean(reservationData.reservationId);

    if (base.patientId && reservationPatientId && base.patientId !== reservationPatientId) {
      findings.push({
        ...base,
        status: "PATIENT_MISMATCH",
        reasons: [`invoice patientId=${base.patientId}, reservation patientId=${reservationPatientId}`],
      });
      continue;
    }

    if (base.reservationId && reservationId && base.reservationId !== reservationId) {
      findings.push({
        ...base,
        status: "RESERVATION_ID_MISMATCH",
        reasons: [`invoice reservationId=${base.reservationId}, reservation reservationId=${reservationId}`],
      });
      continue;
    }

    const duplicateInvoices = invoiceIdsByCandidate.get(reservation.id) || [];
    if (duplicateInvoices.length > 1) {
      findings.push({
        ...base,
        status: "DUPLICATE_ACTIVE_INVOICE",
        reasons: [`reservation candidate is claimed by ${duplicateInvoices.length} active invoices`],
      });
      continue;
    }

    const reverseInvoiceDocId = clean(reservationData.invoiceDocId);
    if (reverseInvoiceDocId && reverseInvoiceDocId !== invoice.id) {
      const linkedInvoice = invoiceByDocId.get(reverseInvoiceDocId);
      if (linkedInvoice && linkedInvoice.data.isDeleted !== true) {
        findings.push({
          ...base,
          status: "RESERVATION_ALREADY_LINKED",
          reasons: [`reservation invoiceDocId points to active invoice ${reverseInvoiceDocId}`],
        });
        continue;
      }
    }

    const reverseInvoiceId = clean(reservationData.invoiceId);
    if (reverseInvoiceId && base.invoiceId && reverseInvoiceId !== base.invoiceId) {
      const linkedByInvoiceId = activeInvoiceByInvoiceId.get(reverseInvoiceId) || [];
      if (linkedByInvoiceId.some((item) => item.id !== invoice.id)) {
        findings.push({
          ...base,
          status: "RESERVATION_ALREADY_LINKED",
          reasons: [`reservation invoiceId points to another active invoiceId ${reverseInvoiceId}`],
        });
        continue;
      }
    }

    const needsInvoiceBackfill =
      base.currentReservationDocId !== reservation.id ||
      !base.reservationId ||
      !base.patientId;
    const needsReservationBackfill =
      reverseInvoiceDocId !== invoice.id ||
      reverseInvoiceId !== base.invoiceId ||
      clean(reservationData.invoiceStatus) !== clean(data.status || "draft");

    findings.push({
      ...base,
      status: needsInvoiceBackfill || needsReservationBackfill ? "AUTO_FIXABLE" : "HEALTHY",
      reasons: [
        ...(needsInvoiceBackfill ? ["invoice link fields need backfill"] : []),
        ...(needsReservationBackfill ? ["reservation reverse link fields need backfill"] : []),
      ],
    });
  }

  return findings;
}

async function loadData(db: admin.firestore.Firestore) {
  const [invoiceSnap, reservationSnap] = await Promise.all([
    db.collection("invoices").get(),
    db.collection("reservations").get(),
  ]);
  return {
    invoices: toItems(invoiceSnap),
    reservations: toItems(reservationSnap),
  };
}

async function applyFinding(
  db: admin.firestore.Firestore,
  finding: Finding
): Promise<ApplyResult> {
  const invoiceRef = db.collection("invoices").doc(finding.invoiceDocId);
  const reservationRef = db.collection("reservations").doc(finding.matchedReservationDocId);

  try {
    await db.runTransaction(async (tx) => {
      const invoiceSnap = await tx.get(invoiceRef);
      const reservationSnap = await tx.get(reservationRef);
      if (!invoiceSnap.exists || !reservationSnap.exists) {
        throw new Error("invoice or reservation disappeared after dry-run analysis");
      }

      const invoice = invoiceSnap.data() as Record<string, unknown>;
      const reservation = reservationSnap.data() as Record<string, unknown>;
      if (invoice.isDeleted === true) throw new Error("invoice became deleted");

      const currentReservationDocId = clean(invoice.reservationDocId);
      if (currentReservationDocId && currentReservationDocId !== reservationRef.id) {
        const currentReservationSnap = await tx.get(db.collection("reservations").doc(currentReservationDocId));
        if (currentReservationSnap.exists) {
          throw new Error("invoice now points to another existing reservation");
        }
      }

      const invoiceReservationId = clean(invoice.reservationId);
      const reservationReservationId = clean(reservation.reservationId);
      const invoicePatientId = clean(invoice.patientId);
      const reservationPatientId = clean(reservation.patientId);
      if (invoiceReservationId && reservationReservationId && invoiceReservationId !== reservationReservationId) {
        throw new Error("reservationId mismatch during apply");
      }
      if (invoicePatientId && reservationPatientId && invoicePatientId !== reservationPatientId) {
        throw new Error("patientId mismatch during apply");
      }

      const duplicateSnap = await tx.get(
        db.collection("invoices").where("reservationDocId", "==", reservationRef.id).limit(3)
      );
      const duplicateActive = duplicateSnap.docs.filter(
        (doc) => doc.id !== invoiceRef.id && doc.data().isDeleted !== true
      );
      if (duplicateActive.length) throw new Error("another active invoice claims this reservation");

      const reverseInvoiceDocId = clean(reservation.invoiceDocId);
      if (reverseInvoiceDocId && reverseInvoiceDocId !== invoiceRef.id) {
        const otherInvoiceSnap = await tx.get(db.collection("invoices").doc(reverseInvoiceDocId));
        if (otherInvoiceSnap.exists && otherInvoiceSnap.data()?.isDeleted !== true) {
          throw new Error("reservation is linked to another active invoice");
        }
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      tx.update(invoiceRef, {
        reservationDocId: reservationRef.id,
        reservationId: reservationReservationId || invoiceReservationId,
        patientId: reservationPatientId || invoicePatientId,
        reservationLinkBackfilledAt: now,
        reservationLinkBackfillVersion: "v1",
      });
      tx.update(reservationRef, {
        invoiceDocId: invoiceRef.id,
        invoiceId: clean(invoice.invoiceId),
        invoiceStatus: clean(invoice.status || "draft"),
        invoiceUpdatedAt: now,
        invoiceLinkBackfilledAt: now,
        invoiceLinkBackfillVersion: "v1",
      });
    });

    return {
      invoiceDocId: finding.invoiceDocId,
      reservationDocId: finding.matchedReservationDocId,
      success: true,
    };
  } catch (error) {
    return {
      invoiceDocId: finding.invoiceDocId,
      reservationDocId: finding.matchedReservationDocId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function reportPath(): string {
  const requested = argValue("--report");
  if (requested) return requested;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `invoice-link-report-${MODE}-${stamp}.json`;
}

async function main() {
  init();
  const db = admin.firestore();
  const beforeData = await loadData(db);
  const before = analyze(beforeData.invoices, beforeData.reservations);
  const applyResults: ApplyResult[] = [];

  console.log(`[invoice-link-backfill] mode=${MODE}`);
  console.log("before:", summarize(before));

  if (MODE === "apply") {
    for (const finding of before.filter((item) => item.status === "AUTO_FIXABLE")) {
      const result = await applyFinding(db, finding);
      applyResults.push(result);
      console.log(
        `${result.success ? "APPLIED" : "FAILED"}: invoice=${result.invoiceDocId} reservation=${result.reservationDocId}` +
          (result.error ? ` (${result.error})` : "")
      );
    }
  }

  const afterData = MODE === "apply" ? await loadData(db) : beforeData;
  const after = analyze(afterData.invoices, afterData.reservations);
  const unresolved = after.filter((item) => isManualStatus(item.status));
  const remainingAutoFixable = after.filter((item) => item.status === "AUTO_FIXABLE");

  const output = {
    generatedAt: new Date().toISOString(),
    mode: MODE,
    beforeCounts: summarize(before),
    afterCounts: summarize(after),
    applyResults,
    manualReviewCount: unresolved.length,
    remainingAutoFixableCount: remainingAutoFixable.length,
    findings: after,
  };

  const path = reportPath();
  writeFileSync(path, JSON.stringify(output, null, 2), "utf8");
  console.log(`report: ${path}`);

  if (unresolved.length) {
    console.log("manual review required:");
    for (const item of unresolved) {
      console.log(`- ${item.status}: invoice=${item.invoiceDocId} reasons=${item.reasons.join("; ")}`);
    }
  }

  if (MODE === "verify" && (unresolved.length || remainingAutoFixable.length)) {
    process.exitCode = 2;
  }
  if (MODE === "apply" && applyResults.some((item) => !item.success)) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
