import { adminDb, FieldValue } from "@/lib/firebaseAdmin";
import { mergeIntoPatients } from "@/lib/patientSummaryCore";

const RESERVATION_CAP = 300;

// 예약 파생 요약: 건수/최근예약.
export async function recomputeReservationSummary(patientId: string): Promise<void> {
  if (!patientId) return;
  // CAP+1을 읽어 정확히 300건인 경우와 301건 이상인 경우를 구분한다.
  const snap = await adminDb
    .collection("reservations")
    .where("patientId", "==", patientId)
    .where("isDeleted", "==", false)
    .orderBy("reservationDate", "desc")
    .limit(RESERVATION_CAP + 1)
    .get();
  const docs = snap.docs.slice(0, RESERVATION_CAP);

  let reservationCount = 0;
  let lastReservationDate = "";
  let lastReservationTime = "";
  let lastReservationDocId = "";
  let lastComposite = "";

  for (const d of docs) {
    const r = d.data() as Record<string, unknown>;
    reservationCount += 1;
    const date = String(r.reservationDate || "");
    const time = String(r.reservationTime || "");
    const composite = `${date} ${time}\u0000${d.id}`;
    if (composite > lastComposite) {
      lastComposite = composite;
      lastReservationDate = date;
      lastReservationTime = time;
      lastReservationDocId = d.id;
    }
  }

  await mergeIntoPatients(patientId, {
    reservationCount,
    lastReservationDate,
    lastReservationTime,
    lastReservationAt: lastReservationDate ? `${lastReservationDate} ${lastReservationTime}`.trim() : "",
    lastReservationDocId,
    reservationCountCapped: snap.docs.length > RESERVATION_CAP,
  });
}


type ReservationSummaryMutation = {
  patientId: string;
  reservationDocId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

function isActiveReservation(record: Record<string, unknown> | null): record is Record<string, unknown> {
  return Boolean(record) && record?.isDeleted !== true;
}

function reservationDisplayKey(record: Record<string, unknown> | null): string {
  if (!record) return "";
  return `${String(record.reservationDate || "")} ${String(record.reservationTime || "")}`.trim();
}

function reservationSortKey(record: Record<string, unknown> | null, docId: string): string {
  const display = reservationDisplayKey(record);
  return display ? `${display}\u0000${docId}` : "";
}

function latestReservationPatch(
  record: Record<string, unknown> | null,
  reservationDocId: string
): Record<string, unknown> {
  if (!record) {
    return {
      lastReservationDate: "",
      lastReservationTime: "",
      lastReservationAt: "",
      lastReservationDocId: "",
    };
  }
  const date = String(record.reservationDate || "");
  const time = String(record.reservationTime || "");
  return {
    lastReservationDate: date,
    lastReservationTime: time,
    lastReservationAt: date ? `${date} ${time}`.trim() : "",
    lastReservationDocId: reservationDocId,
  };
}

/**
 * 정상 create/update/delete 경로의 예약 요약을 before/after 차이로 갱신한다.
 * 최신 예약이 삭제되거나 과거로 이동한 경우에만 최신 후보 1건을 조회한다.
 * 301건 전체 재조회는 초기 요약이 없는 레거시 환자와 repair/reconcile에서만 사용한다.
 */
export async function updateReservationSummaryIncrementally(
  mutation: ReservationSummaryMutation
): Promise<void> {
  const patientId = String(mutation.patientId || "").trim();
  if (!patientId) return;

  const beforeActive = isActiveReservation(mutation.before);
  const afterActive = isActiveReservation(mutation.after);
  const countDelta = Number(afterActive) - Number(beforeActive);
  const patientQuery = adminDb.collection("patients").where("patientId", "==", patientId);
  const outcome = await adminDb.runTransaction<"ok" | "missing" | "bootstrap">(async (tx) => {
    const patientSnap = await tx.get(patientQuery);
    if (patientSnap.empty) return "missing";

    const reference = patientSnap.docs[0].data() as Record<string, unknown>;
    if (
      typeof reference.reservationCount !== "number"
    ) {
      return "bootstrap";
    }

    const currentDisplayKey = `${String(reference.lastReservationDate || "")} ${String(reference.lastReservationTime || "")}`.trim();
    const currentDocId = String(reference.lastReservationDocId || "");
    const currentSortKey = currentDisplayKey
      ? `${currentDisplayKey}\u0000${currentDocId}`
      : "";
    const beforeDisplayKey = beforeActive ? reservationDisplayKey(mutation.before) : "";
    const beforeSortKey = beforeActive
      ? reservationSortKey(mutation.before, mutation.reservationDocId)
      : "";
    const afterSortKey = afterActive
      ? reservationSortKey(mutation.after, mutation.reservationDocId)
      : "";

    const mutationWasCurrent = beforeActive && (
      currentDocId
        ? currentDocId === mutation.reservationDocId
        : beforeDisplayKey === currentDisplayKey
    );
    const movedCurrentBackward = mutationWasCurrent && (
      !afterActive || afterSortKey < beforeSortKey
    );

    let latestPatch: Record<string, unknown> | null = null;
    if (movedCurrentBackward) {
      const latestSnap = await tx.get(
        adminDb.collection("reservations")
          .where("patientId", "==", patientId)
          .where("isDeleted", "==", false)
          .orderBy("reservationDate", "desc")
          .orderBy("reservationTime", "desc")
          .limit(1)
      );
      const latest = latestSnap.docs[0];
      latestPatch = latest
        ? latestReservationPatch(latest.data() as Record<string, unknown>, latest.id)
        : latestReservationPatch(null, "");
    } else if (afterActive && afterSortKey >= currentSortKey) {
      latestPatch = latestReservationPatch(mutation.after, mutation.reservationDocId);
    }

    for (const patientDoc of patientSnap.docs) {
      const data = patientDoc.data() as Record<string, unknown>;
      const currentCount = Number(data.reservationCount || 0);
      const wasCapped = data.reservationCountCapped === true;
      const rawNextCount = Math.max(0, currentCount + countDelta);
      const nextCapped = wasCapped || rawNextCount > RESERVATION_CAP;
      // 이미 capped인 환자는 정확한 실제 건수를 모르므로 reconcile 전까지 표시값 300을 유지한다.
      const nextCount = wasCapped
        ? RESERVATION_CAP
        : Math.min(RESERVATION_CAP, rawNextCount);
      const patch: Record<string, unknown> = {
        reservationCount: nextCount,
        reservationCountCapped: nextCapped,
        summaryUpdatedAt: FieldValue.serverTimestamp(),
      };

      if (latestPatch) Object.assign(patch, latestPatch);
      if (nextCount === 0) Object.assign(patch, latestReservationPatch(null, ""));

      // 300건 초과 레거시 환자는 즉시 전체 스캔하지 않고 reconcile 대상으로 표시한다.
      if (wasCapped && countDelta !== 0) {
        patch.summaryDirty = true;
        patch.summaryDirtyDomains = FieldValue.arrayUnion("reservation");
        patch.summaryDirtyAt = FieldValue.serverTimestamp();
        patch.summaryDirtyVersion = FieldValue.increment(1);
        patch.summaryDirtyLastError = "incremental/capped-reservation";
      }
      tx.update(patientDoc.ref, patch);
    }
    return "ok";
  });

  if (outcome === "bootstrap") {
    await recomputeReservationSummary(patientId);
  }
}
