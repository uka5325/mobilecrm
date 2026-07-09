/**
 * 예약금·수술비용 묶음 materialized 컬렉션(`patientAmountRows`) 공통 helper — 서버 전용.
 *
 * 팝오버 조회를 예약 원본 스캔에서 분리해 "묶음 문서 N건"만 읽도록 만드는 저장소.
 * - 묶음 기준: patientId + type + normalized(hospital) + normalized(consultArea) + sorted normalized doctors
 * - Rep 예약: reservationDate desc, tie-break reservationDocId desc — write 액션이 트랜잭션 안에서 유지
 * - 배지 카운트(patients.depositCount/surgeryCostCount)는 이 컬렉션의 문서 수와 항상 일치
 */
import { createHash } from "node:crypto";
import type {
  FieldValue as FirestoreFieldValue,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import { hasAmountValue, type AmountRow } from "./reservationAmountRows";

export const PATIENT_AMOUNT_ROWS = "patientAmountRows";

export type PatientAmountRowType = "deposit" | "surgery";

// 원본 문자열 필드 정규화 — 공백/대소문자 무시. reservationGroupKey 및 lockKey 규칙과 정합.
function normalizeAmountKeyText(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

// 묶음 키 원문 — 병원|부위|정렬된원장 (모두 정규화). 예약 write 액션에서 파생 필드로 저장.
export function computeAmountGroupKey(r: Record<string, unknown>): string {
  const doctors = Array.isArray(r.doctors)
    ? [...(r.doctors as unknown[])].map(normalizeAmountKeyText).filter(Boolean).sort().join(",")
    : "";
  return [
    normalizeAmountKeyText(r.hospital),
    normalizeAmountKeyText(r.consultArea),
    doctors,
  ].join("|");
}

// patientAmountRows 문서 ID — 결정적 sha256. 같은 (환자, 타입, 묶음키) 는 항상 같은 문서를 가리킨다.
export function amountRowDocIdFor(
  patientId: string,
  type: PatientAmountRowType,
  groupKey: string
): string {
  return createHash("sha256")
    .update(`${patientId}|${type}|${groupKey}`)
    .digest("hex")
    .slice(0, 40);
}

// 예약 write patch(create/update) 에서 depositGroupKey/surgeryGroupKey 를 파생한다.
// - 금액이 비어있으면 groupKey 도 빈 문자열로 명시 저장(문서에 필드가 남지 않는 상태 방지).
// - patch 에 관련 키가 없으면 base 값을 그대로 사용해 계산.
export function deriveGroupKeysPatch(
  patch: Record<string, unknown>,
  base: Record<string, unknown> = {}
): { depositGroupKey: string; surgeryGroupKey: string } {
  const effective = { ...base, ...patch };
  const groupKey = computeAmountGroupKey(effective);
  return {
    depositGroupKey: hasAmountValue(effective.depositAmount) ? groupKey : "",
    surgeryGroupKey: hasAmountValue(effective.surgeryCost) ? groupKey : "",
  };
}

// Rep 예약 비교 — 새 후보가 기존 rep 보다 "더 대표적" 이면 true.
// reservationDate desc, tie-break reservationDocId desc.
export function isNewerRep(
  candidate: { reservationDate: string; reservationDocId: string },
  current: { reservationDate: string; reservationDocId: string }
): boolean {
  if (candidate.reservationDate !== current.reservationDate) {
    return candidate.reservationDate > current.reservationDate;
  }
  return candidate.reservationDocId > current.reservationDocId;
}

export type AmountRowDoc = {
  patientId: string;
  type: PatientAmountRowType;
  groupKey: string;
  hospital: string;
  consultArea: string;
  doctors: string[];
  amount: string;
  reservationDocId: string;
  reservationId: string;
  reservationDate: string;
  createdAt: FirestoreFieldValue;
  updatedAt: FirestoreFieldValue;
  updatedBy: string;
  updatedByUid: string;
};

// 예약 문서에서 patientAmountRows 문서 본문을 생성한다.
// 호출부가 patientId/type/groupKey 를 이미 정한 뒤 rep 예약의 원본 필드를 읽어 넘긴다.
export function buildAmountRowDoc(params: {
  patientId: string;
  type: PatientAmountRowType;
  groupKey: string;
  reservation: Record<string, unknown>;
  reservationDocId: string;
  ctx: { name: string; uid: string };
  now: FirestoreFieldValue;
  createdAt?: FirestoreFieldValue | unknown;
}): AmountRowDoc {
  const r = params.reservation;
  const amountField = params.type === "deposit" ? "depositAmount" : "surgeryCost";
  const doctors = Array.isArray(r.doctors)
    ? (r.doctors as unknown[]).map((d) => String(d ?? "").trim()).filter(Boolean)
    : [];
  return {
    patientId: params.patientId,
    type: params.type,
    groupKey: params.groupKey,
    hospital: String(r.hospital ?? "").trim(),
    consultArea: String(r.consultArea ?? "").trim(),
    doctors,
    amount: String(r[amountField] ?? "").trim(),
    reservationDocId: params.reservationDocId,
    reservationId: String(r.reservationId ?? "").trim(),
    reservationDate: String(r.reservationDate ?? "").trim(),
    createdAt: (params.createdAt ?? params.now) as FirestoreFieldValue,
    updatedAt: params.now,
    updatedBy: params.ctx.name,
    updatedByUid: params.ctx.uid,
  };
}

type WriteAction =
  | { kind: "delete"; ref: FirebaseFirestore.DocumentReference }
  | { kind: "set"; ref: FirebaseFirestore.DocumentReference; data: AmountRowDoc };

// 예약 하나에 대한 patientAmountRows 동기화. 트랜잭션 안에서만 호출한다.
// 계약: 호출부의 모든 기존 read 가 끝난 뒤 · 모든 write 전에 호출해야 한다
// (Firestore 트랜잭션의 "read-before-write" 규칙 위반 방지).
// - before: 변경 전 예약 데이터. create 시 null.
// - after:  변경 후 예약 데이터. delete(또는 삭제 등가) 시 null.
// 내부는 반드시 (모든 read → 모든 write) 순으로 실행된다 —
// 여러 타입(deposit/surgery)의 read/write 가 절대 섞이지 않도록 두 단계로 분리한다.
export async function syncReservationAmountRowsInTx(
  tx: Transaction,
  db: Firestore,
  ctx: { name: string; uid: string },
  params: {
    patientId: string;
    reservationDocId: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    now: FirestoreFieldValue;
  }
): Promise<void> {
  const { patientId, reservationDocId, before, after, now } = params;
  if (!patientId) return;

  const planType = async (type: PatientAmountRowType): Promise<WriteAction[]> => {
    const groupKeyField = type === "deposit" ? "depositGroupKey" : "surgeryGroupKey";
    const amountField = type === "deposit" ? "depositAmount" : "surgeryCost";

    const oldHas = !!(before && hasAmountValue(before[amountField]));
    const newHas = !!(after && hasAmountValue(after[amountField]));
    if (!oldHas && !newHas) return [];

    const oldGroupKey = oldHas ? computeAmountGroupKey(before as Record<string, unknown>) : "";
    const newGroupKey = newHas ? computeAmountGroupKey(after as Record<string, unknown>) : "";
    const writes: WriteAction[] = [];

    if (oldHas && newHas && oldGroupKey === newGroupKey) {
      const docId = amountRowDocIdFor(patientId, type, newGroupKey);
      const ref = db.collection(PATIENT_AMOUNT_ROWS).doc(docId);
      const snap = await tx.get(ref);
      const afterRec = after as Record<string, unknown>;
      if (!snap.exists) {
        writes.push({ kind: "set", ref, data: buildAmountRowDoc({
          patientId, type, groupKey: newGroupKey,
          reservation: afterRec, reservationDocId,
          ctx, now,
        }) });
        return writes;
      }
      const data = snap.data() as Record<string, unknown>;
      const currentRepId = String(data.reservationDocId ?? "");
      const ourAfter = {
        reservationDate: String(afterRec.reservationDate ?? "").trim(),
        reservationDocId,
      };

      if (currentRepId === reservationDocId) {
        // 우리가 현재 rep. 새 상태가 여전히 그룹 최신인지 후보와 비교.
        const candidatesSnap = await tx.get(
          db.collection("reservations")
            .where("patientId", "==", patientId)
            .where(groupKeyField, "==", newGroupKey)
            .where("isDeleted", "==", false)
            .orderBy("reservationDate", "desc")
            .limit(2)
        );
        const others = candidatesSnap.docs.filter((d) => d.id !== reservationDocId);
        const otherRep = others.length > 0
          ? {
              reservationDate: String(others[0].data().reservationDate ?? "").trim(),
              reservationDocId: others[0].id,
            }
          : null;
        if (!otherRep || isNewerRep(ourAfter, otherRep)) {
          writes.push({ kind: "set", ref, data: buildAmountRowDoc({
            patientId, type, groupKey: newGroupKey,
            reservation: afterRec, reservationDocId,
            ctx, now,
            createdAt: data.createdAt,
          }) });
        } else {
          const rep = others[0];
          writes.push({ kind: "set", ref, data: buildAmountRowDoc({
            patientId, type, groupKey: newGroupKey,
            reservation: rep.data() as Record<string, unknown>,
            reservationDocId: rep.id,
            ctx, now,
            createdAt: data.createdAt,
          }) });
        }
        return writes;
      }

      const current = {
        reservationDate: String(data.reservationDate ?? ""),
        reservationDocId: currentRepId,
      };
      if (isNewerRep(ourAfter, current)) {
        writes.push({ kind: "set", ref, data: buildAmountRowDoc({
          patientId, type, groupKey: newGroupKey,
          reservation: afterRec, reservationDocId,
          ctx, now,
          createdAt: data.createdAt,
        }) });
      }
      return writes;
    }

    if (oldHas) {
      const oldDocId = amountRowDocIdFor(patientId, type, oldGroupKey);
      const oldRef = db.collection(PATIENT_AMOUNT_ROWS).doc(oldDocId);
      const oldSnap = await tx.get(oldRef);
      if (oldSnap.exists) {
        const data = oldSnap.data() as Record<string, unknown>;
        if (String(data.reservationDocId ?? "") === reservationDocId) {
          const candidatesSnap = await tx.get(
            db.collection("reservations")
              .where("patientId", "==", patientId)
              .where(groupKeyField, "==", oldGroupKey)
              .where("isDeleted", "==", false)
              .orderBy("reservationDate", "desc")
              .limit(2)
          );
          const others = candidatesSnap.docs.filter((d) => d.id !== reservationDocId);
          if (others.length === 0) {
            writes.push({ kind: "delete", ref: oldRef });
          } else {
            const rep = others[0];
            writes.push({ kind: "set", ref: oldRef, data: buildAmountRowDoc({
              patientId, type, groupKey: oldGroupKey,
              reservation: rep.data() as Record<string, unknown>,
              reservationDocId: rep.id,
              ctx, now,
              createdAt: data.createdAt,
            }) });
          }
        }
      }
    }

    if (newHas) {
      const newDocId = amountRowDocIdFor(patientId, type, newGroupKey);
      const newRef = db.collection(PATIENT_AMOUNT_ROWS).doc(newDocId);
      const newSnap = await tx.get(newRef);
      if (!newSnap.exists) {
        writes.push({ kind: "set", ref: newRef, data: buildAmountRowDoc({
          patientId, type, groupKey: newGroupKey,
          reservation: after as Record<string, unknown>, reservationDocId,
          ctx, now,
        }) });
        return writes;
      }
      const data = newSnap.data() as Record<string, unknown>;
      const candidate = {
        reservationDate: String((after as Record<string, unknown>).reservationDate ?? "").trim(),
        reservationDocId,
      };
      const current = {
        reservationDate: String(data.reservationDate ?? ""),
        reservationDocId: String(data.reservationDocId ?? ""),
      };
      if (isNewerRep(candidate, current)) {
        writes.push({ kind: "set", ref: newRef, data: buildAmountRowDoc({
          patientId, type, groupKey: newGroupKey,
          reservation: after as Record<string, unknown>, reservationDocId,
          ctx, now,
          createdAt: data.createdAt,
        }) });
      }
    }
    return writes;
  };

  // Phase 1: 모든 read 를 두 타입 모두 완료.
  const depositWrites = await planType("deposit");
  const surgeryWrites = await planType("surgery");

  // Phase 2: 모든 write 를 순차 적용.
  for (const w of [...depositWrites, ...surgeryWrites]) {
    if (w.kind === "delete") tx.delete(w.ref);
    else tx.set(w.ref, w.data);
  }
}

// 환자 전체를 지울 때(delete_patient) 해당 환자의 patientAmountRows 를 일괄 삭제한다.
// 트랜잭션 밖 batch 로 호출 — 문서 수가 수십 개를 넘지 않으므로 CHUNK 로 나누기만 하면 안전.
export async function deleteAllAmountRowsForPatient(
  db: Firestore,
  patientId: string
): Promise<number> {
  if (!patientId) return 0;
  const snap = await db.collection(PATIENT_AMOUNT_ROWS)
    .where("patientId", "==", patientId)
    .get();
  if (snap.empty) return 0;
  const CHUNK = 500;
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + CHUNK)) batch.delete(d.ref);
    await batch.commit();
  }
  return snap.docs.length;
}

// 팝오버 조회 공통 구현 — patient_amount_rows 액션을 처리하는 모든 호출부(레거시
// /api/reservations, /api/reservations-consistent 위임 헬퍼)가 이 함수 하나만 호출하도록
// 강제해, 조회 로직이 두 곳에서 따로 구현되어 갈라지는 것을 막는다.
export async function queryPatientAmountRows(
  db: Firestore,
  patientId: string,
  type: PatientAmountRowType
): Promise<AmountRow[]> {
  const snap = await db.collection(PATIENT_AMOUNT_ROWS)
    .where("patientId", "==", patientId)
    .where("type", "==", type)
    .orderBy("reservationDate", "desc")
    .get();

  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: String(data.reservationDocId || d.id),
      reservationId: String(data.reservationId || ""),
      patientId: String(data.patientId || ""),
      date: String(data.reservationDate || ""),
      hospital: String(data.hospital || ""),
      amount: String(data.amount || ""),
    };
  });
}
