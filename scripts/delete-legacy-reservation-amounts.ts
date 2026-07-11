/**
 * Delete legacy reservation amount fields after CSV backup.
 *
 * Dry-run:
 *   npx tsx scripts/delete-legacy-reservation-amounts.ts
 *
 * Commit:
 *   npx tsx scripts/delete-legacy-reservation-amounts.ts --commit
 *
 * Scope:
 * - reservations: depositAmount, surgeryCost, hasDepositAmount, hasSurgeryCost,
 *   depositGroupKey, surgeryGroupKey
 * - patients: depositCount, surgeryCostCount, totalDepositAmount, totalSurgeryCost
 * - patientAmountRows: all documents
 */
import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { FieldPath } from "firebase-admin/firestore";

const COMMIT = process.argv.includes("--commit");
const BATCH_LIMIT = 450;

async function deleteFieldsFromCollection(
  collectionName: string,
  fields: string[]
): Promise<number> {
  let total = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (;;) {
    let query = adminDb.collection(collectionName).orderBy(FieldPath.documentId()).limit(BATCH_LIMIT);
    if (cursor) query = query.startAfter(cursor) as typeof query;
    const snap = await query.get();
    if (snap.empty) break;

    const batch = adminDb.batch();
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(data, field)) {
          patch[field] = FieldValue.delete();
        }
      }
      if (Object.keys(patch).length) {
        total += 1;
        if (COMMIT) batch.update(doc.ref, patch);
      }
    }

    if (COMMIT) await batch.commit();
    if (snap.size < BATCH_LIMIT) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  return total;
}

async function deleteCollection(collectionName: string): Promise<number> {
  let total = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (;;) {
    let query = adminDb.collection(collectionName).orderBy(FieldPath.documentId()).limit(BATCH_LIMIT);
    if (cursor) query = query.startAfter(cursor) as typeof query;
    const snap = await query.get();
    if (snap.empty) break;

    const batch = adminDb.batch();
    for (const doc of snap.docs) {
      total += 1;
      if (COMMIT) batch.delete(doc.ref);
    }

    if (COMMIT) await batch.commit();
    if (snap.size < BATCH_LIMIT) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  return total;
}

async function main() {
  const reservationDocs = await deleteFieldsFromCollection("reservations", [
    "depositAmount",
    "surgeryCost",
    "hasDepositAmount",
    "hasSurgeryCost",
    "depositGroupKey",
    "surgeryGroupKey",
  ]);
  const patientDocs = await deleteFieldsFromCollection("patients", [
    "depositCount",
    "surgeryCostCount",
    "totalDepositAmount",
    "totalSurgeryCost",
  ]);
  const amountRows = await deleteCollection("patientAmountRows");

  console.log(JSON.stringify({
    mode: COMMIT ? "commit" : "dry-run",
    reservationsWithLegacyFields: reservationDocs,
    patientsWithLegacyFields: patientDocs,
    patientAmountRows: amountRows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
