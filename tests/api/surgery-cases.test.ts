/**
 * 상담 예약금 + 수술 잔금이 하나의 surgeryCase/invoice로 즉시 합산되는 통합 계약.
 * 실행: npm run test:api (Firestore + Auth 에뮬레이터 필요)
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { __resetStaffCacheForTests } from "@/lib/apiAuth";
import { createTestUser, type TestUser } from "../helpers/testAuth";
import { POST as reservationPOST } from "@/app/api/reservations/route";
import { POST as settlementPOST } from "@/app/api/settlements/route";
import { POST as invoicePOST } from "@/app/api/invoices/route";

function makeReq(path: string, idToken: string, action: string, payload: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, action, payload }),
  });
}

let coordinator: TestUser;
const patientId = `P-CASE-${Date.now()}`;
let consultationId = "";
let surgeryId = "";
let surgeryCaseId = "";
let invoiceDocId = "";

before(async () => {
  coordinator = await createTestUser(`case-coordinator-${Date.now()}`);
  await adminDb.collection("staff").doc(coordinator.uid).set({
    role: "coordinator",
    active: true,
    displayName: "케이스코디",
  });
});

after(async () => {
  const collections = ["reservations", "settlements", "invoices", "surgeryCases", "logs", "patients"];
  for (const collection of collections) {
    const snap = await adminDb.collection(collection).where("patientId", "==", patientId).get();
    const batch = adminDb.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  await adminDb.collection("staff").doc(coordinator.uid).delete().catch(() => {});
});

test("상담과 수술 추가 예약은 같은 surgeryCaseId를 상속한다", async () => {
  __resetStaffCacheForTests();
  const consultation = await reservationPOST(makeReq("/api/reservations", coordinator.idToken, "create", {
    patient: { patientId, name: "케이스환자", nationality: "몽골" },
    reservation: {
      patientId,
      reservationId: `R-CONSULT-${Date.now()}`,
      name: "케이스환자",
      reservationDate: "2097-08-01",
      appointmentType: "상담",
      consultArea: "코",
      hospital: "ARC",
      coordinators: ["케이스코디"],
    },
  }));
  assert.equal(consultation.status, 200);
  const consultationBody = await consultation.json();
  consultationId = consultationBody.reservationDocId;
  surgeryCaseId = consultationBody.surgeryCaseId;
  assert.ok(surgeryCaseId);

  const surgery = await reservationPOST(makeReq("/api/reservations", coordinator.idToken, "create", {
    patient: { patientId, name: "케이스환자", nationality: "몽골" },
    reservation: {
      patientId,
      reservationId: `R-SURGERY-${Date.now()}`,
      name: "케이스환자",
      reservationDate: "2097-08-15",
      appointmentType: "수술",
      consultArea: "코",
      hospital: "ARC",
      coordinators: ["케이스코디"],
    },
    sourceReservationDocId: consultationId,
  }));
  assert.equal(surgery.status, 200);
  const surgeryBody = await surgery.json();
  surgeryId = surgeryBody.reservationDocId;
  assert.equal(surgeryBody.surgeryCaseId, surgeryCaseId);

  const [consultationSnap, surgerySnap, caseSnap] = await Promise.all([
    adminDb.collection("reservations").doc(consultationId).get(),
    adminDb.collection("reservations").doc(surgeryId).get(),
    adminDb.collection("surgeryCases").doc(surgeryCaseId).get(),
  ]);
  assert.equal(consultationSnap.data()?.surgeryCaseId, surgeryCaseId);
  assert.equal(surgerySnap.data()?.surgeryCaseId, surgeryCaseId);
  assert.deepEqual(
    new Set(caseSnap.data()?.reservationDocIds || []),
    new Set([consultationId, surgeryId])
  );
});

test("서로 다른 예약의 정산이 케이스 인보이스 하나로 합산되고 즉시 재동기화된다", async () => {
  const createSettlement = async (
    reservationDocId: string,
    category: "deposit" | "surgery_fee",
    amount: number,
    paidAt: string
  ) => {
    const response = await settlementPOST(makeReq("/api/settlements", coordinator.idToken, "create", {
      patientId,
      reservationDocId,
      direction: "payment",
      category,
      amount,
      paymentMethod: "cash",
      paidAt,
      memo: category === "deposit" ? "상담 예약금" : "수술 잔금",
    }));
    assert.equal(response.status, 200);
  };

  await createSettlement(consultationId, "deposit", 500000, "2097-08-01");
  await createSettlement(surgeryId, "surgery_fee", 3000000, "2097-08-15");

  const created = await invoicePOST(makeReq("/api/invoices", coordinator.idToken, "create", {
    reservationDocId: surgeryId,
  }));
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  invoiceDocId = createdBody.invoice.id;
  assert.equal(createdBody.invoice.surgeryCaseId, surgeryCaseId);
  assert.equal(createdBody.invoice.totalAmount, 3500000);
  assert.deepEqual(
    new Set(createdBody.invoice.reservationDocIds),
    new Set([consultationId, surgeryId])
  );

  await createSettlement(consultationId, "deposit", 100000, "2097-08-02");
  const [invoiceSnap, caseSnap] = await Promise.all([
    adminDb.collection("invoices").doc(invoiceDocId).get(),
    adminDb.collection("surgeryCases").doc(surgeryCaseId).get(),
  ]);
  assert.equal(invoiceSnap.data()?.totalAmount, 3600000);
  assert.equal(invoiceSnap.data()?.settlementCount, 3);
  assert.equal(caseSnap.data()?.netAmount, 3600000);
  assert.equal(caseSnap.data()?.settlementCount, 3);

  const byConsultation = await invoicePOST(makeReq("/api/invoices", coordinator.idToken, "get_by_reservation", {
    reservationDocId: consultationId,
  }));
  assert.equal((await byConsultation.json()).invoice.id, invoiceDocId);
});
