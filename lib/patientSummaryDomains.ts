import { adminDb } from "@/lib/firebaseAdmin";
import { mergeIntoPatients } from "@/lib/patientSummaryCore";

// 인보이스 요약: 뷰어 권한 무관 총 개수(count() 집계 — 문서 안 읽음).
export async function recomputeInvoiceSummary(patientId: string): Promise<void> {
  if (!patientId) return;
  const agg = await adminDb
    .collection("invoices")
    .where("patientId", "==", patientId)
    .where("isDeleted", "==", false)
    .count()
    .get();
  const invoiceCount = agg.data().count;
  await mergeIntoPatients(patientId, { invoiceCount, hasInvoice: invoiceCount > 0 });
}

// 메모 요약: 개수(count() 집계).
export async function recomputeMemoSummary(patientId: string): Promise<void> {
  if (!patientId) return;
  const agg = await adminDb
    .collection("reservationNotes")
    .where("patientId", "==", patientId)
    .where("isDeleted", "==", false)
    .count()
    .get();
  const memoCount = agg.data().count;
  await mergeIntoPatients(patientId, { memoCount, hasMemo: memoCount > 0 });
}
