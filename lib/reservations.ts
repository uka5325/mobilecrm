import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import type { StaffUser } from "./auth";
import { createLog } from "./logs";
import { parseBirthInfo } from "./reservationUtils";

export type DoctorOption = {
  uid: string;
  displayName: string;
  email: string;
  orderNo: number;
};

export type ReservationStatus =
  | "내원전"
  | "대기"
  | "원상중"
  | "후상중"
  | "귀가"
  | "부도";

export type PatientRecord = {
  patientId: string;
  name: string;
  birth: string;
  birthInput: string;
  gender: string;
  phone: string;
  nationality: string;
};

export type ReservationRecord = {
  id: string;
  reservationId: string;
  patientId: string;

  name: string;
  patientName: string;
  birth: string;
  birthInput: string;
  gender: string;
  phone: string;
  nationality: string;

  reservationDate: string;
  reservationTime: string;

  operationStatus: ReservationStatus;
  surgeryReserved: boolean;
  surgeryReservedAt?: string;

  depositAmount: string;
  consultArea: string;

  doctors: string[];
  coordinators: string[];

  doctorStatusMap: Record<string, ReservationStatus | string>;
  doctorStatusMetaMap: Record<
    string,
    {
      status: string;
      updatedAt: string;
      updatedBy: string;
      updatedRole: string;
    }
  >;

  invoiceUrl: string;
  invoiceId: string;
  invoiceSheetName: string;

  createdAt?: unknown;
  createdBy?: string;
  createdByUid?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByUid?: string;

  isDeleted: boolean;
};

export type CreateReservationParams = {
  name: string;
  birthInput?: string;
  birth?: string;
  gender?: string;
  phone?: string;
  nationality?: string;
  consultArea?: string;
  reservationDate: string;
  reservationTime?: string;
  doctors: string[];
  coordinators?: string[];
  depositAmount?: string;
  reservationId?: string;
  patientId?: string;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanNumber(value: unknown, fallback = 999999) {
  const num = Number(value);

  if (Number.isFinite(num)) {
    return num;
  }

  return fallback;
}

function normalizeReservationStatus(value: unknown): ReservationStatus {
  const v = cleanText(value);

  if (
    v === "내원전" ||
    v === "대기" ||
    v === "원상중" ||
    v === "후상중" ||
    v === "귀가" ||
    v === "부도"
  ) {
    return v;
  }

  return "내원전";
}

function formatLegacyClientId(prefix: string, serial: number) {
  return `${prefix}-${String(serial).padStart(4, "0")}`;
}

function extractLegacySerial(value: unknown, prefix: string) {
  const raw = cleanText(value);
  const match = raw.match(new RegExp(`^${prefix}-(\\d{1,})(?:\\.\\d+)?$`, "i"));

  if (!match) return 0;

  const serial = Number(match[1]);
  return Number.isFinite(serial) ? serial : 0;
}

async function getNextLegacySerial(prefix: "P" | "R") {
  const counterRef = doc(db, "counters", prefix === "P" ? "patients" : "reservations");
  const collectionName = prefix === "P" ? "patients" : "reservations";
  const fieldName = prefix === "P" ? "patientId" : "reservationId";

  return runTransaction(db, async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    let current = counterSnap.exists() ? cleanNumber(counterSnap.data().current, 0) : 0;

    if (!counterSnap.exists()) {
      const existingSnap = await getDocs(collection(db, collectionName));
      current = existingSnap.docs.reduce((max, docSnap) => {
        return Math.max(max, extractLegacySerial(docSnap.data()[fieldName], prefix));
      }, 0);
    }

    const next = current + 1;

    transaction.set(
      counterRef,
      {
        current: next,
        prefix,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return next;
  });
}

async function makeLegacyClientId(prefix: "P" | "R") {
  const serial = await getNextLegacySerial(prefix);
  return formatLegacyClientId(prefix, serial);
}

function normalizeDuplicateKey(params: CreateReservationParams) {
  const doctors = Array.isArray(params.doctors)
    ? params.doctors.map(cleanText).filter(Boolean).sort().join("|")
    : "";

  return [
    cleanText(params.name).toLowerCase(),
    cleanText(params.reservationDate),
    cleanText(params.reservationTime),
    cleanText(params.phone).replace(/[^0-9+]/g, ""),
    doctors,
  ].join("__");
}

async function hasDuplicateReservation(params: CreateReservationParams) {
  const reservationId = cleanText(params.reservationId);

  if (reservationId) {
    const idSnap = await getDocs(
      query(
        collection(db, "reservations"),
        where("reservationId", "==", reservationId),
        where("isDeleted", "==", false)
      )
    );

    if (!idSnap.empty) return true;
  }

  const reservationDate = cleanText(params.reservationDate);
  const reservationTime = cleanText(params.reservationTime);
  const name = cleanText(params.name);

  if (!reservationDate || !name) return false;

  const snap = await getDocs(
    query(
      collection(db, "reservations"),
      where("reservationDate", "==", reservationDate),
      where("isDeleted", "==", false)
    )
  );

  const key = normalizeDuplicateKey({ ...params, reservationTime });

  return snap.docs
    .map((docSnap) => mapReservationDoc(docSnap.id, docSnap.data()))
    .some(
      (item) =>
        normalizeDuplicateKey({
          name: item.name,
          birthInput: item.birthInput,
          birth: item.birth,
          gender: item.gender,
          phone: item.phone,
          nationality: item.nationality,
          consultArea: item.consultArea,
          reservationDate: item.reservationDate,
          reservationTime: item.reservationTime,
          doctors: item.doctors,
          coordinators: item.coordinators,
          depositAmount: item.depositAmount,
        }) === key
    );
}

function mapReservationDoc(id: string, data: any): ReservationRecord {
  const name = cleanText(data.name || data.patientName);

  return {
    id,
    reservationId: cleanText(data.reservationId || id),
    patientId: cleanText(data.patientId),

    name,
    patientName: name,
    birth: cleanText(data.birth),
    birthInput: cleanText(data.birthInput),
    gender: cleanText(data.gender),
    phone: cleanText(data.phone),
    nationality: cleanText(data.nationality),

    reservationDate: cleanText(data.reservationDate),
    reservationTime: cleanText(data.reservationTime),

    operationStatus: normalizeReservationStatus(data.operationStatus),
    surgeryReserved: data.surgeryReserved === true,
    surgeryReservedAt: cleanText(data.surgeryReservedAt),

    depositAmount: cleanText(data.depositAmount),
    consultArea: cleanText(data.consultArea),

    doctors: Array.isArray(data.doctors)
      ? data.doctors.map(cleanText).filter(Boolean)
      : [],
    coordinators: Array.isArray(data.coordinators)
      ? data.coordinators.map(cleanText).filter(Boolean)
      : [],

    doctorStatusMap: data.doctorStatusMap || {},
    doctorStatusMetaMap: data.doctorStatusMetaMap || {},

    invoiceUrl: cleanText(data.invoiceUrl),
    invoiceId: cleanText(data.invoiceId),
    invoiceSheetName: cleanText(data.invoiceSheetName),

    createdAt: data.createdAt,
    createdBy: cleanText(data.createdBy),
    createdByUid: cleanText(data.createdByUid),
    updatedAt: data.updatedAt,
    updatedBy: cleanText(data.updatedBy),
    updatedByUid: cleanText(data.updatedByUid),

    isDeleted: data.isDeleted === true,
  };
}

function sortDoctors(doctors: DoctorOption[]) {
  return [...doctors].sort((a, b) => {
    return (
      cleanNumber(a.orderNo) - cleanNumber(b.orderNo) ||
      a.displayName.localeCompare(b.displayName)
    );
  });
}

export async function getDoctors(): Promise<DoctorOption[]> {
  const q = query(
    collection(db, "staff"),
    where("role", "==", "doctor"),
    where("active", "==", true)
  );

  const snap = await getDocs(q);

  const doctors = snap.docs
    .map((docSnap) => {
      const data = docSnap.data();

      return {
        uid: docSnap.id,
        displayName: cleanText(
          data.displayName || data.display_name || data.name
        ),
        email: cleanText(data.email),
        orderNo: cleanNumber(data.orderNo ?? data.order_no),
      };
    })
    .filter((doctor) => doctor.displayName);

  return sortDoctors(doctors);
}

export async function getAllReservations(): Promise<{
  reservations: ReservationRecord[];
  doctors: DoctorOption[];
}> {
  const [reservationSnap, doctors] = await Promise.all([
    getDocs(
      query(collection(db, "reservations"), orderBy("reservationDate", "desc"))
    ),
    getDoctors(),
  ]);

  const reservations = reservationSnap.docs
    .map((docSnap) => mapReservationDoc(docSnap.id, docSnap.data()))
    .filter((item) => !item.isDeleted)
    .sort((a, b) => {
      const aa = `${a.reservationDate} ${a.reservationTime} ${a.name}`;
      const bb = `${b.reservationDate} ${b.reservationTime} ${b.name}`;
      return aa.localeCompare(bb);
    });

  return {
    reservations,
    doctors,
  };
}

export function subscribeAllReservations(
  callback: (data: {
    reservations: ReservationRecord[];
    doctors: DoctorOption[];
  }) => void,
  onError?: (error: Error) => void
) {
  let currentDoctors: DoctorOption[] = [];
  let currentReservations: ReservationRecord[] = [];

  function emit() {
    callback({ reservations: currentReservations, doctors: currentDoctors });
  }

  getDoctors()
    .then((loadedDoctors) => {
      currentDoctors = loadedDoctors;
      emit();
    })
    .catch((error) => {
      console.error(error);
      onError?.(
        error instanceof Error
          ? error
          : new Error("원장 목록을 불러오지 못했습니다.")
      );
    });

  return onSnapshot(
    query(collection(db, "reservations"), orderBy("reservationDate", "desc")),
    (snap) => {
      currentReservations = snap.docs
        .map((docSnap) => mapReservationDoc(docSnap.id, docSnap.data()))
        .filter((item) => !item.isDeleted)
        .sort((a, b) => {
          const aa = `${a.reservationDate} ${a.reservationTime} ${a.name}`;
          const bb = `${b.reservationDate} ${b.reservationTime} ${b.name}`;
          return aa.localeCompare(bb);
        });

      emit();
    },
    (error) => {
      console.error(error);
      onError?.(error);
    }
  );
}

export function subscribeTimelineReservations(
  date: string,
  callback: (data: {
    reservations: ReservationRecord[];
    doctors: DoctorOption[];
  }) => void,
  onError?: (error: Error) => void
) {
  let currentDoctors: DoctorOption[] = [];
  let currentReservations: ReservationRecord[] = [];

  function emit() {
    callback({ reservations: currentReservations, doctors: currentDoctors });
  }

  getDoctors()
    .then((loadedDoctors) => {
      currentDoctors = loadedDoctors;
      emit();
    })
    .catch((error) => {
      console.error(error);
      onError?.(
        error instanceof Error
          ? error
          : new Error("원장 목록을 불러오지 못했습니다.")
      );
    });

  return onSnapshot(
    query(
      collection(db, "reservations"),
      where("reservationDate", "==", date),
      where("isDeleted", "==", false)
    ),
    (snap) => {
      currentReservations = snap.docs
        .map((docSnap) => mapReservationDoc(docSnap.id, docSnap.data()))
        .sort((a, b) => {
          const aa = `${a.reservationTime} ${a.name}`;
          const bb = `${b.reservationTime} ${b.name}`;
          return aa.localeCompare(bb);
        });

      emit();
    },
    (error) => {
      console.error(error);
      onError?.(error);
    }
  );
}

export async function getTimelineReservations(date: string): Promise<{
  reservations: ReservationRecord[];
  doctors: DoctorOption[];
}> {
  const [reservationSnap, doctors] = await Promise.all([
    getDocs(
      query(
        collection(db, "reservations"),
        where("reservationDate", "==", date),
        where("isDeleted", "==", false)
      )
    ),
    getDoctors(),
  ]);

  const reservations = reservationSnap.docs
    .map((docSnap) => mapReservationDoc(docSnap.id, docSnap.data()))
    .sort((a, b) => {
      const aa = `${a.reservationTime} ${a.name}`;
      const bb = `${b.reservationTime} ${b.name}`;
      return aa.localeCompare(bb);
    });

  return {
    reservations,
    doctors,
  };
}

export async function createReservation(
  params: CreateReservationParams,
  staff: StaffUser
) {
  const name = cleanText(params.name);
  const reservationDate = cleanText(params.reservationDate);
  const doctors = Array.isArray(params.doctors)
    ? params.doctors.map(cleanText).filter(Boolean)
    : [];

  if (!name) {
    return { success: false, message: "이름을 입력하세요." };
  }

  if (!reservationDate) {
    return { success: false, message: "예약날짜를 선택하세요." };
  }

  if (!doctors.length) {
    return { success: false, message: "지정원장을 선택하세요." };
  }

  const isDuplicate = await hasDuplicateReservation(params);

  if (isDuplicate) {
    return {
      success: false,
      message: "이미 등록된 예약으로 보여 저장하지 않았습니다.",
      duplicate: true,
    };
  }

  const patientId = cleanText(params.patientId) || (await makeLegacyClientId("P"));
  const reservationId =
    cleanText(params.reservationId) || (await makeLegacyClientId("R"));

  const parsedBirth = parseBirthInfo(
    params.birthInput || params.birth || "",
    params.gender || ""
  );

  const patientPayload = {
    patientId,
    name,
    birth: parsedBirth.birth,
    birthInput: parsedBirth.birthInput,
    gender: parsedBirth.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const doctorStatusMap: Record<string, ReservationStatus> = {};
  const doctorStatusMetaMap: ReservationRecord["doctorStatusMetaMap"] = {};

  doctors.forEach((doctor) => {
    doctorStatusMap[doctor] = "내원전";
    doctorStatusMetaMap[doctor] = {
      status: "내원전",
      updatedAt: "",
      updatedBy: "",
      updatedRole: "",
    };
  });

  const reservationPayload = {
    reservationId,
    patientId,

    name,
    patientName: name,
    birth: parsedBirth.birth,
    birthInput: parsedBirth.birthInput,
    gender: parsedBirth.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),

    reservationDate,
    reservationTime: cleanText(params.reservationTime),

    operationStatus: "내원전" as ReservationStatus,
    surgeryReserved: false,
    surgeryReservedAt: "",

    depositAmount: cleanText(params.depositAmount),
    consultArea: cleanText(params.consultArea),

    doctors,
    coordinators: Array.isArray(params.coordinators)
      ? params.coordinators.map(cleanText).filter(Boolean)
      : [],

    doctorStatusMap,
    doctorStatusMetaMap,

    invoiceUrl: "",
    invoiceId: "",
    invoiceSheetName: "",

    createdAt: serverTimestamp(),
    createdBy: staff.displayName,
    createdByUid: staff.uid,
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,

    isDeleted: false,
  };

  await addDoc(collection(db, "patients"), patientPayload);
  const reservationRef = await addDoc(
    collection(db, "reservations"),
    reservationPayload
  );

  await createLog({
    action: "reservation_create",
    targetType: "reservation",
    targetId: reservationId,
    patientId,
    reservationId,
    staff,
    message: `${staff.displayName}님이 신규 예약을 등록했습니다.`,
    before: null,
    after: {
      name,
      reservationDate,
      reservationTime: cleanText(params.reservationTime),
      doctors,
    },
  });

  return {
    success: true,
    reservation: mapReservationDoc(reservationRef.id, reservationPayload),
  };
}

export async function createReservationsBatch(
  payloads: CreateReservationParams[],
  staff: StaffUser
) {
  let successCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];

    try {
      const result = await createReservation(payload, staff);

      if (result.success) {
        successCount += 1;
      } else {
        errors.push(`${i + 2}행: ${result.message || "저장 실패"}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "저장 중 오류 발생";
      errors.push(`${i + 2}행: ${message}`);
    }
  }

  return {
    success: successCount > 0,
    count: successCount,
    errors,
  };
}

export async function updateReservationStatus(
  reservationDocId: string,
  reservationId: string,
  newStatus: ReservationStatus,
  staff: StaffUser
) {
  const ref = doc(db, "reservations", reservationDocId);

  await updateDoc(ref, {
    operationStatus: newStatus,
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  await createLog({
    action: "reservation_update",
    targetType: "reservation",
    targetId: reservationId,
    reservationId,
    staff,
    message: `${staff.displayName}님이 예약 상태를 ${newStatus}(으)로 변경했습니다.`,
    before: null,
    after: {
      operationStatus: newStatus,
    },
  });

  return { success: true };
}

export async function toggleSurgeryReserved(
  reservationDocId: string,
  reservationId: string,
  nextValue: boolean,
  staff: StaffUser
) {
  const ref = doc(db, "reservations", reservationDocId);

  await updateDoc(ref, {
    surgeryReserved: nextValue,
    surgeryReservedAt: nextValue ? new Date().toISOString() : "",
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  await createLog({
    action: "reservation_update",
    targetType: "reservation",
    targetId: reservationId,
    reservationId,
    staff,
    message: `${staff.displayName}님이 수술예약 상태를 ${
      nextValue ? "예약" : "미예약"
    }으로 변경했습니다.`,
    before: null,
    after: {
      surgeryReserved: nextValue,
    },
  });

  return { success: true };
}

export type UpdateReservationParams = {
  name: string;
  birthInput?: string;
  birth?: string;
  gender?: string;
  phone?: string;
  nationality?: string;
  consultArea?: string;
  reservationDate: string;
  reservationTime?: string;
  doctors: string[];
  coordinators?: string[];
  depositAmount?: string;
};

async function findPatientDocId(patientId: string) {
  const snap = await getDocs(
    query(collection(db, "patients"), where("patientId", "==", patientId))
  );

  if (snap.empty) return null;

  return snap.docs[0].id;
}

export async function updateReservationFull(
  reservationDocId: string,
  reservationId: string,
  patientId: string,
  params: UpdateReservationParams,
  staff: StaffUser
) {
  const name = cleanText(params.name);
  const reservationDate = cleanText(params.reservationDate);
  const doctors = Array.isArray(params.doctors)
    ? params.doctors.map(cleanText).filter(Boolean)
    : [];

  if (!name) {
    return { success: false, message: "이름을 입력하세요." };
  }

  if (!reservationDate) {
    return { success: false, message: "예약날짜를 선택하세요." };
  }

  if (!doctors.length) {
    return { success: false, message: "지정원장을 선택하세요." };
  }

  const parsedBirth = parseBirthInfo(
    params.birthInput || params.birth || "",
    params.gender || ""
  );

  const currentReservationSnap = await getDoc(
    doc(db, "reservations", reservationDocId)
  );
  const currentReservation = currentReservationSnap.exists()
    ? mapReservationDoc(currentReservationSnap.id, currentReservationSnap.data())
    : null;

  const previousDoctorStatusMap = currentReservation?.doctorStatusMap || {};
  const previousDoctorStatusMetaMap =
    currentReservation?.doctorStatusMetaMap || {};

  const doctorStatusMap: Record<string, ReservationStatus | string> = {};
  const doctorStatusMetaMap: ReservationRecord["doctorStatusMetaMap"] = {};

  doctors.forEach((doctor) => {
    doctorStatusMap[doctor] = previousDoctorStatusMap[doctor] || "내원전";
    doctorStatusMetaMap[doctor] = previousDoctorStatusMetaMap[doctor] || {
      status: String(doctorStatusMap[doctor] || "내원전"),
      updatedAt: "",
      updatedBy: "",
      updatedRole: "",
    };
  });

  const reservationPatch = {
    name,
    patientName: name,

    birth: parsedBirth.birth,
    birthInput: parsedBirth.birthInput,
    gender: parsedBirth.gender,
    phone: cleanText(params.phone),
    nationality: cleanText(params.nationality),

    reservationDate,
    reservationTime: cleanText(params.reservationTime),

    consultArea: cleanText(params.consultArea),
    depositAmount: cleanText(params.depositAmount),

    doctors,
    coordinators: Array.isArray(params.coordinators)
      ? params.coordinators.map(cleanText).filter(Boolean)
      : [],

    doctorStatusMap,
    doctorStatusMetaMap,

    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  };

  await updateDoc(doc(db, "reservations", reservationDocId), reservationPatch);

  const patientDocId = await findPatientDocId(patientId);

  if (patientDocId) {
    await updateDoc(doc(db, "patients", patientDocId), {
      name,
      birth: parsedBirth.birth,
      birthInput: parsedBirth.birthInput,
      gender: parsedBirth.gender,
      phone: cleanText(params.phone),
      nationality: cleanText(params.nationality),
      updatedAt: serverTimestamp(),
    });
  }

  await createLog({
    action: "reservation_update",
    targetType: "reservation",
    targetId: reservationId,
    patientId,
    reservationId,
    staff,
    message: `${staff.displayName}님이 예약 정보를 수정했습니다.`,
    before: null,
    after: {
      name,
      birth: parsedBirth.birth,
      birthInput: parsedBirth.birthInput,
      gender: parsedBirth.gender,
      phone: cleanText(params.phone),
      nationality: cleanText(params.nationality),
      consultArea: cleanText(params.consultArea),
      reservationDate,
      reservationTime: cleanText(params.reservationTime),
      doctors,
      coordinators: params.coordinators || [],
      depositAmount: cleanText(params.depositAmount),
    },
  });

  return { success: true };
}

export async function deleteReservation(
  reservationDocId: string,
  reservationId: string,
  staff: StaffUser
) {
  if (staff.role !== "admin" && staff.role !== "doctor") {
    return { success: false, message: "예약 삭제 권한이 없습니다." };
  }

  const ref = doc(db, "reservations", reservationDocId);

  await updateDoc(ref, {
    isDeleted: true,
    updatedAt: serverTimestamp(),
    updatedBy: staff.displayName,
    updatedByUid: staff.uid,
  });

  await createLog({
    action: "reservation_delete",
    targetType: "reservation",
    targetId: reservationId,
    reservationId,
    staff,
    message: `${staff.displayName}님이 예약을 삭제 처리했습니다.`,
    before: null,
    after: {
      isDeleted: true,
    },
  });

  return { success: true };
}
