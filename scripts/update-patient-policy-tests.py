from pathlib import Path
import re

path = Path("tests/api/reservations.test.ts")
text = path.read_text()

text = text.replace(
    'import { POST } from "@/app/api/reservations/route";',
    'import { POST } from "@/app/api/reservations/route";\nimport { POST as CONSISTENT_POST } from "@/app/api/reservations-consistent/route";',
    1,
)

reservation_test = '''test("create: 동일 신원은 자동 병합하지 않고 후보 확인 후 명시적으로 연결한다", async () => {
  __resetStaffCacheForTests();
  const name = `신원중복${Date.now()}`;
  const identity = { name, birth: "19910531", nationality: "몽골", gender: "여" };
  const pidA = `P-IDENT-A-${Date.now()}`;

  const first = await POST(makeReq(staff.idToken, "create", {
    patient: { ...identity, patientId: pidA },
    reservation: {
      ...identity,
      patientId: pidA,
      reservationId: `R-IDENT1-${Date.now()}`,
      reservationDate: "2026-08-01",
      doctors: [],
      isDeleted: false,
    },
  }));
  const firstBody = await first.json();
  assert.equal(firstBody.success, true);
  createdReservationDocIds.push(firstBody.reservationDocId);
  createdPatientDocIds.push(firstBody.patientDocId);

  const pidB = `P-IDENT-B-${Date.now()}`;
  const secondPayload = {
    patient: { ...identity, patientId: pidB },
    reservation: {
      ...identity,
      patientId: pidB,
      reservationId: `R-IDENT2-${Date.now()}`,
      reservationDate: "2026-08-02",
      doctors: [],
      isDeleted: false,
    },
  };

  const candidateResponse = await POST(makeReq(staff.idToken, "create", secondPayload));
  assert.equal(candidateResponse.status, 409);
  const candidateBody = await candidateResponse.json();
  assert.equal(candidateBody.success, false);
  assert.equal(candidateBody.code, "PATIENT_CANDIDATES");
  assert.ok(candidateBody.candidates.some((candidate: Record<string, unknown>) => candidate.patientId === pidA));

  const linkedResponse = await POST(makeReq(staff.idToken, "create", {
    patient: { ...identity, patientId: pidA },
    reservation: {
      ...secondPayload.reservation,
      patientId: pidA,
    },
    confirmNewPatient: true,
    linkToPatientId: pidA,
  }));
  const linkedBody = await linkedResponse.json();
  assert.equal(linkedBody.success, true);
  assert.equal(linkedBody.linkedExistingPatient, true);
  createdReservationDocIds.push(linkedBody.reservationDocId);

  const secondReservation = await adminDb.collection("reservations").doc(linkedBody.reservationDocId).get();
  assert.equal(secondReservation.data()?.patientId, pidA);
  const canonicalLockId = lockIdForReservation(secondReservation.data() as Record<string, unknown>);
  const canonicalLock = await adminDb.collection(RESERVATION_LOCKS).doc(canonicalLockId).get();
  assert.equal(canonicalLock.data()?.reservationDocId, linkedBody.reservationDocId);

  const key = identityKeyForPatient(identity);
  const active = await adminDb.collection("patients")
    .where("identityKey", "==", key)
    .where("isDeleted", "==", false)
    .get();
  assert.equal(active.size, 1);
});

test("create: 성별이 다르면'''

text, count = re.subn(
    r'test\("create: patientId가 달라도 이름\+생년월일\+국적\+성별이 같으면 같은 환자로 연결된다".*?\n\}\);\n\ntest\("create: 성별이 다르면',
    reservation_test,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError(f"reservation identity test replacement count={count}")

patient_only_test = '''test("create_patient: 동일 신원은 후보 반환 후 명시적으로 연결하거나 새 환자로 등록한다", async () => {
  __resetStaffCacheForTests();
  const name = `단독신원${Date.now()}`;
  const identity = { name, birth: "20000829", nationality: "몽골", gender: "여" };
  const pidA = `P-CP-A-${Date.now()}`;

  const first = await CONSISTENT_POST(makeReq(staff.idToken, "create_patient", {
    patient: { ...identity, patientId: pidA },
  }));
  const firstBody = await first.json();
  assert.equal(firstBody.success, true);
  createdPatientDocIds.push(firstBody.patientDocId);

  const candidate = await CONSISTENT_POST(makeReq(staff.idToken, "create_patient", {
    patient: { ...identity, patientId: `P-CP-B-${Date.now()}` },
  }));
  assert.equal(candidate.status, 409);
  const candidateBody = await candidate.json();
  assert.equal(candidateBody.code, "PATIENT_CANDIDATES");

  const linked = await CONSISTENT_POST(makeReq(staff.idToken, "create_patient", {
    patient: { ...identity, patientId: `P-CP-C-${Date.now()}` },
    linkToPatientId: pidA,
  }));
  const linkedBody = await linked.json();
  assert.equal(linkedBody.success, true);
  assert.equal(linkedBody.linkedExistingPatient, true);
  assert.equal(linkedBody.patientId, pidA);

  const newPatientId = `P-CP-NEW-${Date.now()}`;
  const newPatient = await CONSISTENT_POST(makeReq(staff.idToken, "create_patient", {
    patient: { ...identity, patientId: newPatientId },
    confirmNewPatient: true,
  }));
  const newPatientBody = await newPatient.json();
  assert.equal(newPatientBody.success, true);
  assert.equal(newPatientBody.patientId, newPatientId);
  createdPatientDocIds.push(newPatientBody.patientDocId);

  const all = await adminDb.collection("patients").where("name", "==", name).get();
  assert.equal(all.size, 2);
});

test("update 필드 보존'''

text, count = re.subn(
    r'test\("create_patient: 이름\+생년월일\+국적\+성별이 같으면 기존 환자로 연결된다".*?\n\}\);\n\ntest\("update 필드 보존',
    patient_only_test,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError(f"patient-only identity test replacement count={count}")

path.write_text(text)
