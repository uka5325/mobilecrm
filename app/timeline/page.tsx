"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  createReservation,
  type DoctorOption,
  getAllReservations,
  subscribeTimelineReservations,
  type ReservationRecord,
  type ReservationStatus,
  toggleSurgeryReserved,
  updateReservationFull,
  updateReservationStatus,
} from "@/lib/reservations";
import { getStaffByUid, listenCurrentUser } from "@/lib/auth";
import type { StaffUser } from "@/lib/auth";
import {
  getReservationBirthInfo,
  parseBirthInfo,
} from "@/lib/reservationUtils";
import {
  createLog,
  getLatestLogsByReservationIds,
  getLogsByReservationId,
  type LogRecord,
} from "@/lib/logs";
import { db } from "@/lib/firebase";
import {
  DEFAULT_VISIT_STATUS_COLORS,
  getConferenceMemos,
  getVisitStatusColors,
  VISIT_STATUS_LIST,
  type VisitStatus,
  type VisitStatusColorMap,
} from "@/lib/settings";
import {
  addReservationNote,
  deleteReservationNote,
  getReservationNotes,
  updateReservationNote,
  type ReservationNote,
} from "@/lib/reservationNotes";

const START_H = 9;
const END_H = 21;
const SLOT_H = 80;
const CARD_H = 66;
const CARD_GAP = 6;
const CARD_SIDE_GAP = 8;
const DOCTOR_COL_W = 320;
const SLOT_PADDING_Y = 9;

const DETAIL_STATUS_LIST: ReservationStatus[] = [
  "대기",
  "원상중",
  "후상중",
  "귀가",
  "부도",
];

const STATUS_LABELS: Record<string, string> = {
  내원전: "내원전",
  대기: "대기",
  원상중: "원상중",
  후상중: "후상중",
  귀가: "귀가",
  부도: "부도",
};

type DetailTab = "info" | "notes" | "logs" | "invoice";

type SlotLayout = {
  slot: number;
  label: string;
  top: number;
  height: number;
};

function todayString() {
  const d = new Date();

  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function normalizeTime(value: string) {
  const raw = String(value || "").trim();
  const m = raw.match(/(\d{1,2}):(\d{2})/);

  if (!m) return "";

  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

function getMinutes(value: string) {
  const time = normalizeTime(value);
  if (!time) return START_H * 60;

  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function getSlotIndex(value: string) {
  const minutes = getMinutes(value);
  const start = START_H * 60;
  const diff = Math.max(minutes - start, 0);

  return Math.floor(diff / 60);
}

function getReservationDoctors(item: ReservationRecord) {
  return Array.isArray(item.doctors) ? item.doctors : [];
}

function getCardStatus(item: ReservationRecord) {
  return item.operationStatus || "내원전";
}

function getBirthGenderText(item: ReservationRecord) {
  const info = getReservationBirthInfo(item);
  return [info.birthDisplay, info.gender].filter(Boolean).join(" · ");
}

function getBirthGenderNationalityText(item: ReservationRecord) {
  const info = getReservationBirthInfo(item);
  return [info.birthDisplay, info.gender, item.nationality]
    .filter(Boolean)
    .join(" · ");
}

function buildSlotLayouts(
  doctors: DoctorOption[],
  dayReservations: ReservationRecord[]
): SlotLayout[] {
  const maxCountsBySlot = new Map<number, number>();

  for (let slot = 0; slot <= END_H - START_H; slot += 1) {
    maxCountsBySlot.set(slot, 0);
  }

  doctors.forEach((doctor) => {
    const counts = new Map<number, number>();

    dayReservations
      .filter((item) =>
        getReservationDoctors(item).includes(doctor.displayName)
      )
      .forEach((item) => {
        const slot = getSlotIndex(item.reservationTime || "");
        counts.set(slot, (counts.get(slot) || 0) + 1);
      });

    counts.forEach((count, slot) => {
      const prev = maxCountsBySlot.get(slot) || 0;
      maxCountsBySlot.set(slot, Math.max(prev, count));
    });
  });

  let top = 0;

  return Array.from({ length: END_H - START_H + 1 }, (_, slot) => {
    const hour = START_H + slot;
    const count = maxCountsBySlot.get(slot) || 0;

    const requiredHeight =
      count <= 1
        ? SLOT_H
        : SLOT_PADDING_Y * 2 + count * CARD_H + (count - 1) * CARD_GAP;

    const height = Math.max(SLOT_H, requiredHeight);

    const layout = {
      slot,
      label: `${String(hour).padStart(2, "0")}:00`,
      top,
      height,
    };

    top += height;

    return layout;
  });
}

function getTimelineHeight(slotLayouts: SlotLayout[]) {
  if (!slotLayouts.length) return SLOT_H * (END_H - START_H + 1);

  const last = slotLayouts[slotLayouts.length - 1];
  return last.top + last.height;
}

function layoutTimelineCards(
  items: ReservationRecord[],
  slotLayouts: SlotLayout[]
) {
  const sorted = [...items].sort((a, b) => {
    const timeDiff =
      getMinutes(a.reservationTime || "") -
      getMinutes(b.reservationTime || "");

    if (timeDiff !== 0) return timeDiff;

    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  const groups = new Map<number, ReservationRecord[]>();

  sorted.forEach((item) => {
    const slot = getSlotIndex(item.reservationTime || "");
    const list = groups.get(slot) || [];
    list.push(item);
    groups.set(slot, list);
  });

  const result: {
    item: ReservationRecord;
    top: number;
    left: number;
    width: number;
    height: number;
  }[] = [];

  groups.forEach((groupItems, slot) => {
    const slotLayout = slotLayouts.find((item) => item.slot === slot);
    const slotTop = slotLayout?.top || 0;
    const slotHeight = slotLayout?.height || SLOT_H;

    const totalCardsHeight =
      groupItems.length * CARD_H + Math.max(groupItems.length - 1, 0) * CARD_GAP;

    const startTop =
      groupItems.length === 1
        ? slotTop + Math.max((slotHeight - CARD_H) / 2, 0)
        : slotTop +
          Math.max((slotHeight - totalCardsHeight) / 2, SLOT_PADDING_Y);

    groupItems.forEach((item, index) => {
      result.push({
        item,
        top: startTop + index * (CARD_H + CARD_GAP),
        left: CARD_SIDE_GAP,
        width: DOCTOR_COL_W - CARD_SIDE_GAP * 2,
        height: CARD_H,
      });
    });
  });

  return result.sort((a, b) => a.top - b.top);
}

function toDate(value: any) {
  try {
    const date =
      value && typeof value.toDate === "function"
        ? value.toDate()
        : value instanceof Date
          ? value
          : new Date(value);

    if (Number.isNaN(date.getTime())) return null;

    return date;
  } catch {
    return null;
  }
}

function formatLogDate(value: any) {
  const date = toDate(value);
  if (!date) return "";

  return (
    date.getFullYear() +
    "." +
    String(date.getMonth() + 1).padStart(2, "0") +
    "." +
    String(date.getDate()).padStart(2, "0") +
    " " +
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0") +
    ":" +
    String(date.getSeconds()).padStart(2, "0")
  );
}

function formatCardLogDate(value: any) {
  const date = toDate(value);
  if (!date) return "";

  return (
    String(date.getMonth() + 1).padStart(2, "0") +
    "." +
    String(date.getDate()).padStart(2, "0") +
    " " +
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0") +
    ":" +
    String(date.getSeconds()).padStart(2, "0")
  );
}

function getLogBadgeClass(action: string) {
  if (action.includes("delete")) return "bg-red-50 text-red-700";
  if (action.includes("invoice")) return "bg-orange-50 text-orange-700";
  if (action.includes("memo")) return "bg-green-50 text-green-700";
  if (action.includes("update")) return "bg-yellow-50 text-yellow-700";
  if (action.includes("reservation")) return "bg-blue-50 text-blue-700";

  return "bg-gray-100 text-gray-600";
}


function splitComma(value: string) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getReadableTextColor(hex: string) {
  const clean = String(hex || "").replace("#", "");

  if (clean.length !== 6) return "#ffffff";

  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  return brightness > 150 ? "#111827" : "#ffffff";
}

function getStatusColor(status: string, colors: VisitStatusColorMap) {
  if (VISIT_STATUS_LIST.includes(status as VisitStatus)) {
    return colors[status as VisitStatus] || DEFAULT_VISIT_STATUS_COLORS.내원전;
  }

  return DEFAULT_VISIT_STATUS_COLORS.내원전;
}

function getSoftStatusColor(hex: string) {
  const color = String(hex || "").trim();

  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}2E`;
  }

  return "#f3f4f6";
}

export default function TimelinePage() {
  const router = useRouter();

  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const timeScaleRef = useRef<HTMLDivElement | null>(null);

  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayString());

  const [statusColors, setStatusColors] = useState<VisitStatusColorMap>(
    DEFAULT_VISIT_STATUS_COLORS
  );
  const [todayMemos, setTodayMemos] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<DetailTab>("info");

  const [selectedReservation, setSelectedReservation] =
    useState<ReservationRecord | null>(null);

  const [detailDoctors, setDetailDoctors] = useState<string[]>([]);
  const [detailError, setDetailError] = useState("");
  const [detailMessage, setDetailMessage] = useState("");

  const [detailForm, setDetailForm] = useState({
    name: "",
    birthInput: "",
    phone: "",
    nationality: "",
    consultArea: "",
    reservationDate: todayString(),
    reservationTime: "",
    coordinators: "",
    depositAmount: "",
  });

  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [latestLogMap, setLatestLogMap] = useState<Record<string, LogRecord>>(
    {}
  );
  const [memoText, setMemoText] = useState("");
  const [notes, setNotes] = useState<ReservationNote[]>([]);
  const [editingNoteId, setEditingNoteId] = useState("");
  const [editingMemoText, setEditingMemoText] = useState("");

  const [newDoctors, setNewDoctors] = useState<string[]>([]);
  const [newError, setNewError] = useState("");

  const [newForm, setNewForm] = useState({
    name: "",
    birthInput: "",
    phone: "",
    nationality: "",
    consultArea: "",
    reservationDate: todayString(),
    reservationTime: "",
    coordinators: "",
    depositAmount: "",
  });

  const birthPreview = useMemo(() => {
    return parseBirthInfo(newForm.birthInput);
  }, [newForm.birthInput]);

  const detailBirthPreview = useMemo(() => {
    return parseBirthInfo(detailForm.birthInput);
  }, [detailForm.birthInput]);

  useEffect(() => {
    const unsubscribe = listenCurrentUser(async (user: User | null) => {
      if (!user) return;

      const staff = await getStaffByUid(user.uid);
      if (staff) setCurrentUser(staff);
    });

    return () => unsubscribe();
  }, []);

  async function loadData() {
    setLoading(true);

    try {
      const data = await getAllReservations();
      setReservations(data.reservations || []);
      setDoctors(data.doctors || []);
    } catch (error) {
      console.error(error);
      alert("타임라인 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function loadTimelineSettings(date = selectedDate) {
    try {
      const [loadedColors, loadedMemos] = await Promise.all([
        getVisitStatusColors(),
        getConferenceMemos(date, 10),
      ]);

      setStatusColors(loadedColors);
      setTodayMemos(loadedMemos.map((memo) => memo.memoText).filter(Boolean));
    } catch (error) {
      console.error("Timeline settings load error:", error);
    }
  }

  async function loadReservationLogs(item: ReservationRecord) {
    setLogsLoading(true);
    setLogsError("");
    setLogs([]);

    try {
      const list = await getLogsByReservationId(item.reservationId, item.id);
      setLogs(list);
    } catch (error) {
      console.error(error);
      setLogs([]);
      setLogsError("로그를 불러오지 못했습니다.");
    } finally {
      setLogsLoading(false);
    }
  }

async function loadReservationNotes(item: ReservationRecord) {
  try {
    const list = await getReservationNotes(
      item.reservationId,
      item.id,
      item.patientId
    );
    setNotes(list);
  } catch (error) {
    console.error(error);
    setNotes([]);
  }
}

  async function refreshLatestLog(item: ReservationRecord) {
    const ids = [item.reservationId, item.id].filter(Boolean);

    if (!ids.length) return;

    try {
      const map = await getLatestLogsByReservationIds(ids);
      setLatestLogMap((prev) => ({
        ...prev,
        ...map,
      }));
    } catch (error) {
      console.error(error);
    }
  }

  function handleTimelineScroll() {
    const scrollTop = timelineScrollRef.current?.scrollTop || 0;

    if (timeScaleRef.current) {
      timeScaleRef.current.style.transform = `translateY(-${scrollTop}px)`;
    }
  }

  useEffect(() => {
    setLoading(true);

    const unsubscribe = subscribeTimelineReservations(
      selectedDate,
      (data) => {
        setReservations(data.reservations || []);
        setDoctors(data.doctors || []);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        setLoading(false);
        alert("타임라인 실시간 데이터를 불러오지 못했습니다.");
      }
    );

    return () => unsubscribe();
  }, [selectedDate]);

  useEffect(() => {
    loadTimelineSettings(selectedDate);
  }, [selectedDate]);

  const dayReservations = useMemo(() => {
    return reservations.filter((item) => item.reservationDate === selectedDate);
  }, [reservations, selectedDate]);

  const slotLayouts = useMemo(() => {
    return buildSlotLayouts(doctors, dayReservations);
  }, [doctors, dayReservations]);

  const timelineHeight = useMemo(() => {
    return getTimelineHeight(slotLayouts);
  }, [slotLayouts]);

  useEffect(() => {
    async function loadLatestLogs() {
      const reservationIds = dayReservations
        .flatMap((item) => [item.reservationId, item.id])
        .filter(Boolean);

      if (!reservationIds.length) {
        setLatestLogMap({});
        return;
      }

      try {
        const map = await getLatestLogsByReservationIds(reservationIds);
        setLatestLogMap(map);
      } catch (error) {
        console.error(error);
        setLatestLogMap({});
      }
    }

    loadLatestLogs();
  }, [dayReservations]);

  const kpi = useMemo(() => {
    const base = {
      total: dayReservations.length,
      before: 0,
      wait: 0,
      cons: 0,
      post: 0,
      left: 0,
      no: 0,
      surg: 0,
    };

    dayReservations.forEach((item) => {
      if (item.operationStatus === "내원전") base.before += 1;
      if (item.operationStatus === "대기") base.wait += 1;
      if (item.operationStatus === "원상중") base.cons += 1;
      if (item.operationStatus === "후상중") base.post += 1;
      if (item.operationStatus === "귀가") base.left += 1;
      if (item.operationStatus === "부도") base.no += 1;
      if (item.surgeryReserved) base.surg += 1;
    });

    return base;
  }, [dayReservations]);

  function openNewDrawer() {
    setNewError("");
    setNewDoctors([]);
    setNewForm({
      name: "",
      birthInput: "",
      phone: "",
      nationality: "",
      consultArea: "",
      reservationDate: selectedDate || todayString(),
      reservationTime: "",
      coordinators: "",
      depositAmount: "",
    });
    setNewOpen(true);
  }

  function closeNewDrawer() {
    setNewOpen(false);
    setNewError("");
    setNewDoctors([]);
  }

  function fillDetailForm(item: ReservationRecord) {
    setDetailForm({
      name: item.name || "",
      birthInput: item.birthInput || item.birth || "",
      phone: item.phone || "",
      nationality: item.nationality || "",
      consultArea: item.consultArea || "",
      reservationDate: item.reservationDate || todayString(),
      reservationTime: item.reservationTime || "",
      coordinators: item.coordinators.join(", "),
      depositAmount: item.depositAmount || "",
    });

    setDetailDoctors(item.doctors || []);
  }

 function openDetail(item: ReservationRecord) {
  setSelectedReservation(item);
  setActiveTab("info");
  setDetailError("");
  setDetailMessage("");
  setMemoText("");
  setNotes([]);
  setEditingNoteId("");
  setEditingMemoText("");
  fillDetailForm(item);
  setDetailOpen(true);
  loadReservationLogs(item);
  loadReservationNotes(item);
}

  function closeDetail() {
    setDetailOpen(false);
    setSelectedReservation(null);
    setActiveTab("info");
    setLogs([]);
    setLogsError("");
    setLogsLoading(false);
    setDetailError("");
    setDetailMessage("");
    setDetailDoctors([]);
    setMemoText("");
    setNotes([]);
    setEditingNoteId("");
    setEditingMemoText("");
  }

  function toggleNewDoctor(name: string) {
    setNewDoctors((prev) =>
      prev.includes(name)
        ? prev.filter((item) => item !== name)
        : [...prev, name]
    );
  }

  function toggleDetailDoctor(name: string) {
    setDetailDoctors((prev) =>
      prev.includes(name)
        ? prev.filter((item) => item !== name)
        : [...prev, name]
    );
  }

  async function handleCreateReservation() {
    if (!currentUser) {
      setNewError("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    if (!newForm.name.trim()) {
      setNewError("이름을 입력하세요.");
      return;
    }

    if (!newForm.reservationDate) {
      setNewError("예약날짜를 선택하세요.");
      return;
    }

    if (!newDoctors.length) {
      setNewError("지정원장을 선택하세요.");
      return;
    }

    setSaving(true);
    setNewError("");

    try {
      const result = await createReservation(
        {
          name: newForm.name,
          birthInput: newForm.birthInput,
          birth: newForm.birthInput,
          phone: newForm.phone,
          nationality: newForm.nationality,
          consultArea: newForm.consultArea,
          reservationDate: newForm.reservationDate,
          reservationTime: newForm.reservationTime,
          doctors: newDoctors,
          coordinators: splitComma(newForm.coordinators),
          depositAmount: newForm.depositAmount,
        },
        currentUser
      );

      if (!result.success) {
        setNewError(result.message || "예약 등록에 실패했습니다.");
        return;
      }

      closeNewDrawer();
      await loadData();
    } catch (error) {
      console.error(error);
      setNewError("예약 등록 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDetail() {
    if (!currentUser || !selectedReservation) return;

    if (!detailForm.name.trim()) {
      setDetailError("이름을 입력하세요.");
      return;
    }

    if (!detailForm.reservationDate) {
      setDetailError("예약날짜를 선택하세요.");
      return;
    }

    if (!detailDoctors.length) {
      setDetailError("지정원장을 선택하세요.");
      return;
    }

    setDetailSaving(true);
    setDetailError("");
    setDetailMessage("");

    try {
      const result = await updateReservationFull(
        selectedReservation.id,
        selectedReservation.reservationId,
        selectedReservation.patientId,
        {
          name: detailForm.name,
          birthInput: detailForm.birthInput,
          birth: detailForm.birthInput,
          phone: detailForm.phone,
          nationality: detailForm.nationality,
          consultArea: detailForm.consultArea,
          reservationDate: detailForm.reservationDate,
          reservationTime: detailForm.reservationTime,
          doctors: detailDoctors,
          coordinators: splitComma(detailForm.coordinators),
          depositAmount: detailForm.depositAmount,
        },
        currentUser
      );

      if (!result.success) {
        setDetailError(result.message || "예약 수정에 실패했습니다.");
        return;
      }

      const updated: ReservationRecord = {
        ...selectedReservation,
        name: detailForm.name,
        patientName: detailForm.name,
        birthInput: detailForm.birthInput,
        birth: detailForm.birthInput,
        phone: detailForm.phone,
        nationality: detailForm.nationality,
        consultArea: detailForm.consultArea,
        reservationDate: detailForm.reservationDate,
        reservationTime: detailForm.reservationTime,
        doctors: detailDoctors,
        coordinators: splitComma(detailForm.coordinators),
        depositAmount: detailForm.depositAmount,
      };

      setReservations((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      );

      setSelectedReservation(updated);
      setDetailMessage("수정 저장 완료");

      await loadReservationLogs(updated);
      await refreshLatestLog(updated);
    } catch (error) {
      console.error(error);
      setDetailError("예약 수정 중 오류가 발생했습니다.");
    } finally {
      setDetailSaving(false);
    }
  }

  async function handleStatusChange(status: ReservationStatus) {
    if (!currentUser || !selectedReservation) return;

    const nextStatus =
      status === "대기" && selectedReservation.operationStatus === "대기"
        ? "내원전"
        : status;

    await updateReservationStatus(
      selectedReservation.id,
      selectedReservation.reservationId,
      nextStatus,
      currentUser
    );

    const updated: ReservationRecord = {
      ...selectedReservation,
      operationStatus: nextStatus,
    };

    setReservations((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );

    setSelectedReservation(updated);

    await loadReservationLogs(updated);
    await refreshLatestLog(updated);
  }

  async function handleSurgeryToggle() {
    if (!currentUser || !selectedReservation) return;

    const next = !selectedReservation.surgeryReserved;

    await toggleSurgeryReserved(
      selectedReservation.id,
      selectedReservation.reservationId,
      next,
      currentUser
    );

    const updated: ReservationRecord = {
      ...selectedReservation,
      surgeryReserved: next,
    };

    setReservations((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );

    setSelectedReservation(updated);

    await loadReservationLogs(updated);
    await refreshLatestLog(updated);
  }

  async function handleAddMemo() {
    if (!currentUser || !selectedReservation) return;

    const text = memoText.trim();

    if (!text) {
      alert("메모 내용을 입력하세요.");
      return;
    }

    try {
      const result = await addReservationNote({
        reservationId: selectedReservation.reservationId,
        reservationDocId: selectedReservation.id,
        patientId: selectedReservation.patientId || "",
        memoText: text,
        staff: currentUser,
      });

      if (!result.success) {
        alert(result.message || "메모 저장 실패");
        return;
      }

      setMemoText("");
      await loadReservationNotes(selectedReservation);
      await loadReservationLogs(selectedReservation);
      await refreshLatestLog(selectedReservation);
    } catch (error) {
      console.error(error);
      alert("메모 저장 중 오류가 발생했습니다.");
    }
  }

  function handleStartEditNote(note: ReservationNote) {
    setEditingNoteId(note.id);
    setEditingMemoText(note.memoText);
  }

  function handleCancelEditNote() {
    setEditingNoteId("");
    setEditingMemoText("");
  }

  async function handleUpdateNote(note: ReservationNote) {
    if (!currentUser || !selectedReservation) return;

    const result = await updateReservationNote({
      noteId: note.id,
      reservationId: selectedReservation.reservationId,
      patientId: selectedReservation.patientId || "",
      memoText: editingMemoText,
      staff: currentUser,
    });

    if (!result.success) {
      alert(result.message || "메모 수정 실패");
      return;
    }

    handleCancelEditNote();
    await loadReservationNotes(selectedReservation);
    await loadReservationLogs(selectedReservation);
    await refreshLatestLog(selectedReservation);
  }

  async function handleDeleteNote(note: ReservationNote) {
    if (!currentUser || !selectedReservation) return;

    const ok = confirm("메모를 삭제할까요?");
    if (!ok) return;

    await deleteReservationNote({
      noteId: note.id,
      reservationId: selectedReservation.reservationId,
      patientId: selectedReservation.patientId || "",
      staff: currentUser,
    });

    await loadReservationNotes(selectedReservation);
    await loadReservationLogs(selectedReservation);
    await refreshLatestLog(selectedReservation);
  }

  async function handleDeleteInvoiceFromDetail() {
    if (!currentUser || !selectedReservation) return;

    if (!selectedReservation.invoiceId) {
      alert("삭제할 인보이스가 없습니다.");
      return;
    }

    const ok = confirm(
      "연결된 인보이스를 삭제할까요?\n삭제 후 다시 생성할 수 있습니다."
    );

    if (!ok) return;

    try {
      const invoiceDocId =
        (selectedReservation as any).invoiceDocId ||
        selectedReservation.invoiceId;

      await updateDoc(doc(db, "invoices", invoiceDocId), {
        status: "void",
        isDeleted: true,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.displayName,
        updatedByUid: currentUser.uid,
      });

      await updateDoc(doc(db, "reservations", selectedReservation.id), {
        invoiceId: "",
        invoiceDocId: "",
        invoiceStatus: "",
        invoiceUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.displayName,
        updatedByUid: currentUser.uid,
      });

      await createLog({
        action: "invoice_delete",
        targetType: "invoice",
        targetId: invoiceDocId,
        staff: currentUser,
        message: `${
          selectedReservation.name || "고객"
        } 인보이스를 삭제 처리했습니다.`,
        patientId: selectedReservation.patientId || "",
        reservationId: selectedReservation.reservationId || "",
        invoiceId: selectedReservation.invoiceId || invoiceDocId,
        before: {
          invoiceId: selectedReservation.invoiceId || "",
          invoiceDocId: (selectedReservation as any).invoiceDocId || "",
          invoiceStatus: (selectedReservation as any).invoiceStatus || "",
        },
        after: {
          invoiceId: "",
          invoiceDocId: "",
          invoiceStatus: "void",
          isDeleted: true,
        },
      });

      const updated = {
        ...selectedReservation,
        invoiceId: "",
        invoiceDocId: "",
        invoiceStatus: "",
      } as ReservationRecord;

      setReservations((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      );

      setSelectedReservation(updated);

      await loadReservationLogs(updated);
      await refreshLatestLog(updated);

      alert("인보이스가 삭제 처리되었습니다.");
    } catch (error) {
      console.error(error);
      alert("인보이스 삭제 중 오류가 발생했습니다.");
    }
  }


  function renderNoteCard(note: ReservationNote, compact = false) {
    const isEditing = editingNoteId === note.id;

    return (
      <div
        key={note.id}
        className={
          compact
            ? "rounded-xl bg-gray-50 px-4 py-3 text-sm"
            : "rounded-xl border border-[#edf0f3] bg-white p-4 text-sm"
        }
      >
        {isEditing ? (
          <>
            <textarea
              rows={compact ? 2 : 3}
              value={editingMemoText}
              onChange={(e) => setEditingMemoText(e.target.value)}
              className="w-full resize-none rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-emerald-500 focus:outline-none"
            />

            <div className="mt-2 flex justify-end gap-3 text-xs">
              <button
                onClick={handleCancelEditNote}
                className="text-gray-500 hover:underline"
              >
                취소
              </button>
              <button
                onClick={() => handleUpdateNote(note)}
                className="font-semibold text-blue-600 hover:underline"
              >
                저장
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate font-semibold text-emerald-700">
                {note.createdBy || "작성자"}
              </span>

              <span className="shrink-0 text-xs text-gray-400">
                {formatLogDate(note.createdAt)}
              </span>
            </div>

            <div className="whitespace-pre-line leading-6 text-gray-700">
              {note.memoText}
            </div>

            <div className="mt-2 flex justify-end gap-3 text-xs">
              <button
                onClick={() => handleStartEditNote(note)}
                className="text-blue-500 hover:underline"
              >
                수정
              </button>
              <button
                onClick={() => handleDeleteNote(note)}
                className="text-red-500 hover:underline"
              >
                삭제
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  const selectedStatus = selectedReservation?.operationStatus || "내원전";
  const recentNotes = notes.slice(0, 3);

  return (
    <div className="relative -mx-6 -mb-6 mt-5 h-[calc(100vh-170px)] min-h-[640px] overflow-hidden bg-white">
      <div className="absolute inset-0 overflow-hidden rounded-2xl border border-[#edf0f3] bg-white">
        <div className="absolute left-0 right-0 top-0 z-30 flex min-h-[72px] items-center justify-between rounded-t-2xl border-b border-[#edf0f3] bg-[#ecfdf5] px-6 py-3">
          <div>
            <div className="mb-1 text-xs font-extrabold text-emerald-700">
              오늘의 메모
            </div>

            <div className="text-sm leading-6 text-emerald-800">
              {todayMemos.length === 0 ? (
                "등록된 메모가 없습니다."
              ) : (
                <div className="space-y-0.5">
                  {todayMemos.map((memo, index) => (
                    <div key={`${memo}-${index}`} className="line-clamp-1">
                      • {memo}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-10 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm transition focus:border-[#1d9e75] focus:outline-none"
            />

            <button
              onClick={openNewDrawer}
              className="h-10 rounded-xl bg-black px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
            >
              신규 예약
            </button>
          </div>
        </div>

        <div className="absolute left-0 right-0 top-[72px] z-20 grid grid-cols-4 gap-2 border-b border-[#edf0f3] bg-white px-6 py-2 md:grid-cols-8">
          <KpiBox label="전체" value={kpi.total} className="bg-gray-100" />
          <KpiBox label="내원전" value={kpi.before} color={statusColors.내원전} />
          <KpiBox label="대기" value={kpi.wait} color={statusColors.대기} />
          <KpiBox label="원상중" value={kpi.cons} color={statusColors.원상중} />
          <KpiBox label="후상중" value={kpi.post} color={statusColors.후상중} />
          <KpiBox label="귀가" value={kpi.left} color={statusColors.귀가} />
          <KpiBox label="부도" value={kpi.no} color={statusColors.부도} />
          <KpiBox
            label="예약"
            value={kpi.surg}
            className="bg-purple-50 text-purple-700"
          />
        </div>

        <div className="absolute bottom-0 left-0 right-0 top-[150px] flex overflow-hidden rounded-b-2xl">
          <div className="flex w-16 shrink-0 flex-col border-r border-[#edf0f3] bg-white">
            <div className="flex h-[60px] shrink-0 items-center justify-center border-b border-[#edf0f3] bg-white text-xs font-semibold text-gray-500">
              시간
            </div>

            <div className="flex-1 overflow-hidden">
              <div ref={timeScaleRef} className="will-change-transform">
                {slotLayouts.map((slot) => (
                  <div
                    key={slot.slot}
                    className="flex items-start justify-center border-b border-[#f1f3f5] pt-1.5 text-xs text-gray-400"
                    style={{ height: slot.height }}
                  >
                    {slot.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div
            ref={timelineScrollRef}
            onScroll={handleTimelineScroll}
            className="relative flex-1 overflow-auto bg-white"
          >
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                데이터 로딩 중...
              </div>
            ) : doctors.length === 0 ? (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-gray-400">
                등록된 원장이 없습니다.
              </div>
            ) : (
              <div className="min-w-max">
                <div className="sticky top-0 z-50 flex border-b border-[#edf0f3] bg-white">
                  {doctors.map((doctor, index) => {
                    const count = dayReservations.filter((item) =>
                      getReservationDoctors(item).includes(doctor.displayName)
                    ).length;

                    const colors = [
                      "#1d9e75",
                      "#2563eb",
                      "#8b5cf6",
                      "#f59e0b",
                      "#ef4444",
                    ];

                    return (
                      <div
                        key={doctor.uid}
                        className="flex h-[60px] w-[320px] shrink-0 items-center justify-center gap-2 border-r border-[#edf0f3] bg-white"
                      >
                        <div
                          className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                          style={{
                            background: colors[index % colors.length],
                          }}
                        >
                          {doctor.displayName.charAt(0)}
                        </div>

                        <span className="text-sm font-semibold">
                          {doctor.displayName}
                        </span>

                        <span className="text-xs text-gray-400">{count}명</span>
                      </div>
                    );
                  })}
                </div>

                <div
                  className="relative z-0 flex"
                  style={{ minHeight: timelineHeight }}
                >
                  {doctors.map((doctor) => {
                    const doctorReservations = dayReservations.filter((item) =>
                      getReservationDoctors(item).includes(doctor.displayName)
                    );

                    const laidOutReservations = layoutTimelineCards(
                      doctorReservations,
                      slotLayouts
                    );

                    return (
                      <div
                        key={doctor.uid}
                        className="relative w-[320px] shrink-0 border-r border-[#edf0f3] bg-white"
                        style={{ height: timelineHeight }}
                      >
                        {slotLayouts.map((slot) => (
                          <div
                            key={`${doctor.uid}-${slot.slot}`}
                            className="border-b border-[#f1f3f5] bg-white"
                            style={{ height: slot.height }}
                          />
                        ))}

                        {laidOutReservations.map(
                          ({ item, top, left, width, height }) => {
                            const status = getCardStatus(item);
                            const cardColor = getStatusColor(
                              status,
                              statusColors
                            );
                            const cardTextColor =
                              getReadableTextColor(cardColor);

                            const latestLog =
                              latestLogMap[item.reservationId] ||
                              latestLogMap[item.id] ||
                              latestLogMap[item.reservationId || item.id];

                            const infoLine = [
                              item.consultArea || "-",
                              getBirthGenderText(item),
                            ]
                              .filter(Boolean)
                              .join(" · ");

                            return (
                              <button
                                key={`${doctor.uid}-${item.id}`}
                                onClick={() => openDetail(item)}
                                className="absolute z-[2] flex overflow-hidden rounded-xl px-2.5 py-2 text-left shadow-[0_3px_10px_rgba(0,0,0,0.12)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.18)] active:scale-[0.99]"
                                style={{
                                  top,
                                  left,
                                  width,
                                  height,
                                  backgroundColor: cardColor,
                                  color: cardTextColor,
                                }}
                              >
                                <div className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate text-[12px] font-bold leading-[15px]">
                                      {item.name}
                                    </span>
                                    <span className="shrink-0 text-[11px] font-semibold leading-[15px] opacity-95">
                                      {item.reservationTime || "시간 미정"}
                                    </span>
                                  </div>

                                  <div className="mt-[3px] truncate text-[11px] font-medium leading-[14px] opacity-95">
                                    {infoLine}
                                  </div>

                                  <div className="mt-[6px] truncate text-[10px] leading-[13px] opacity-90">
                                    {STATUS_LABELS[status] || status}
                                    {latestLog && (
                                      <>
                                        {" "}
                                        · {latestLog.staffName || "시스템"} ·{" "}
                                        {formatCardLogDate(latestLog.createdAt)}
                                      </>
                                    )}
                                    {item.surgeryReserved ? " · 🏥수술" : ""}
                                  </div>
                                </div>
                              </button>
                            );
                          }
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {detailOpen && selectedReservation && (
        <>
          <div
            className="fixed inset-0 z-[998] bg-black/35"
            onClick={closeDetail}
          />

          <div className="fixed right-0 top-0 z-[999] flex h-screen w-[420px] max-w-[calc(100vw-12px)] flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
            <div className="shrink-0 border-b border-[#edf0f3] px-5 py-4">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <div className="text-xl font-bold">
                    {selectedReservation.name}
                  </div>
                  <div className="mt-0.5 text-sm text-gray-500">
                    {getBirthGenderNationalityText(selectedReservation)}
                  </div>
                </div>

                <button
                  onClick={closeDetail}
                  className="text-2xl leading-none text-gray-400 transition hover:scale-110 hover:text-gray-700 active:scale-95"
                >
                  ×
                </button>
              </div>

              <div className="grid grid-cols-6 gap-1.5">
                {DETAIL_STATUS_LIST.map((status) => {
                  const active = selectedStatus === status;
                  const label = status === "대기" ? "내원" : status;
                  const color = getStatusColor(status, statusColors);
                  const textColor = getReadableTextColor(color);

                  return (
                    <button
                      key={status}
                      onClick={() => handleStatusChange(status)}
                      className="min-w-0 rounded-lg border px-1.5 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
                      style={{
                        borderColor: color,
                        backgroundColor: active ? color : "#ffffff",
                        color: active ? textColor : color,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}

                <button
                  onClick={handleSurgeryToggle}
                  className={`min-w-0 rounded-lg border px-1.5 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
                    selectedReservation.surgeryReserved
                      ? "border-purple-600 bg-purple-600 text-white"
                      : "border-purple-400 bg-white text-purple-700"
                  }`}
                >
                  예약
                </button>
              </div>
            </div>

            <div className="flex shrink-0 border-b border-[#edf0f3]">
              {[
                { key: "info", label: "기본정보" },
                { key: "notes", label: "메모" },
                { key: "logs", label: "로그" },
                { key: "invoice", label: "인보이스" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as DetailTab)}
                  className={`flex-1 border-b-2 py-2.5 text-center text-sm transition hover:bg-gray-50 active:scale-[0.98] ${
                    activeTab === tab.key
                      ? "border-[#1d9e75] font-semibold text-[#1d9e75]"
                      : "border-transparent text-gray-500"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {activeTab === "info" && (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <EditField
                      label="이름"
                      value={detailForm.name}
                      onChange={(value) =>
                        setDetailForm((prev) => ({ ...prev, name: value }))
                      }
                    />

                    <div>
                      <label className="text-xs text-gray-500">생년월일</label>
                      <input
                        value={detailForm.birthInput}
                        onChange={(e) =>
                          setDetailForm((prev) => ({
                            ...prev,
                            birthInput: e.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                        placeholder="891210-1 / 19891210-1"
                      />
                      {detailForm.birthInput && (
                        <div className="mt-1 text-xs text-gray-500">
                          {detailBirthPreview.birthDisplay}
                          {detailBirthPreview.ageText
                            ? ` · ${detailBirthPreview.ageText}`
                            : ""}
                          {detailBirthPreview.gender
                            ? ` · ${detailBirthPreview.gender}`
                            : ""}
                        </div>
                      )}
                    </div>

                    <EditField
                      label="연락처"
                      value={detailForm.phone}
                      onChange={(value) =>
                        setDetailForm((prev) => ({ ...prev, phone: value }))
                      }
                    />

                    <EditField
                      label="국적"
                      value={detailForm.nationality}
                      onChange={(value) =>
                        setDetailForm((prev) => ({
                          ...prev,
                          nationality: value,
                        }))
                      }
                    />
                  </div>

                  <div className="mt-3">
                    <EditField
                      label="상담부위"
                      value={detailForm.consultArea}
                      onChange={(value) =>
                        setDetailForm((prev) => ({
                          ...prev,
                          consultArea: value,
                        }))
                      }
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-xs text-gray-500">예약날짜</label>
                      <input
                        type="date"
                        value={detailForm.reservationDate}
                        onChange={(e) =>
                          setDetailForm((prev) => ({
                            ...prev,
                            reservationDate: e.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-500">예약시간</label>
                      <input
                        type="time"
                        step={1800}
                        value={detailForm.reservationTime}
                        onChange={(e) =>
                          setDetailForm((prev) => ({
                            ...prev,
                            reservationTime: e.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="text-xs text-gray-500">지정원장</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {doctors.map((doctor) => {
                        const on = detailDoctors.includes(doctor.displayName);

                        return (
                          <button
                            key={doctor.uid}
                            onClick={() =>
                              toggleDetailDoctor(doctor.displayName)
                            }
                            className={`rounded-xl border px-3 py-2 text-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
                              on
                                ? "border-black bg-black text-white"
                                : "border-[#dfe3e8] bg-white text-gray-700"
                            }`}
                          >
                            {doctor.displayName}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <EditField
                      label="담당 실장"
                      value={detailForm.coordinators}
                      onChange={(value) =>
                        setDetailForm((prev) => ({
                          ...prev,
                          coordinators: value,
                        }))
                      }
                    />

                    <EditField
                      label="예약금"
                      value={detailForm.depositAmount}
                      onChange={(value) =>
                        setDetailForm((prev) => ({
                          ...prev,
                          depositAmount: value,
                        }))
                      }
                    />
                  </div>

                  {detailError && (
                    <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
                      {detailError}
                    </div>
                  )}

                  {detailMessage && (
                    <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {detailMessage}
                    </div>
                  )}

                  <button
                    onClick={handleSaveDetail}
                    disabled={detailSaving}
                    className="mt-4 w-full rounded-xl bg-black py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
                  >
                    {detailSaving ? "저장 중..." : "수정 저장"}
                  </button>

                  <div className="mt-5 border-t border-[#edf0f3] pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-xs font-semibold text-gray-500">
                        최근 메모
                      </label>

                      <button
                        onClick={() => setActiveTab("notes")}
                        className="text-xs text-emerald-600 transition hover:underline active:scale-95"
                      >
                        전체보기
                      </button>
                    </div>

                    <textarea
                      rows={2}
                      value={memoText}
                      onChange={(e) => setMemoText(e.target.value)}
                      className="w-full resize-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-emerald-500 focus:outline-none"
                      placeholder="기본정보에서 바로 메모 입력"
                    />

                    <button
                      onClick={handleAddMemo}
                      className="mt-2 w-full rounded-xl bg-emerald-600 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
                    >
                      메모 추가
                    </button>

                    <div className="mt-3 space-y-2">
                      {recentNotes.length === 0 ? (
                        <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-400">
                          등록된 메모가 없습니다.
                        </div>
                      ) : (
                        recentNotes.map((note) => renderNoteCard(note, true))
                      )}
                    </div>
                  </div>
                </>
              )}

              {activeTab === "notes" && (
                <div>
                  <textarea
                    rows={3}
                    value={memoText}
                    onChange={(e) => setMemoText(e.target.value)}
                    className="w-full resize-none rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-emerald-500 focus:outline-none"
                    placeholder="메모를 입력하세요..."
                  />

                  <button
                    onClick={handleAddMemo}
                    className="mt-2 w-full rounded-xl bg-emerald-600 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
                  >
                    메모 추가
                  </button>

                  <div className="mt-4 space-y-3">
                    {notes.length === 0 ? (
                      <div className="rounded-xl border border-[#edf0f3] bg-white p-4 text-sm text-gray-400">
                        등록된 메모가 없습니다.
                      </div>
                    ) : (
                      notes.map((note) => renderNoteCard(note))
                    )}
                  </div>
                </div>
              )}

              {activeTab === "logs" && (
                <div className="space-y-2">
                  {logsLoading ? (
                    <div className="rounded-xl border border-[#edf0f3] bg-white p-4 text-sm text-gray-400">
                      로그를 불러오는 중...
                    </div>
                  ) : logsError ? (
                    <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-500">
                      {logsError}
                    </div>
                  ) : logs.length === 0 ? (
                    <div className="rounded-xl border border-[#edf0f3] bg-white p-4 text-sm text-gray-400">
                      등록된 로그가 없습니다.
                    </div>
                  ) : (
                    logs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded-xl border border-[#edf0f3] bg-white p-3 text-sm"
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${getLogBadgeClass(
                              String(log.action || "")
                            )}`}
                          >
                            {log.action || "LOG"}
                          </span>

                          <span className="text-[11px] text-gray-400">
                            {formatLogDate(log.createdAt)}
                          </span>
                        </div>

                        <div className="text-sm leading-6 text-gray-700">
                          {log.message || "로그 내용 없음"}
                        </div>

                        {log.staffName && (
                          <div className="mt-1 text-[11px] text-gray-400">
                            처리자: {log.staffName}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "invoice" && (
                <div className="space-y-3">
                  <div className="rounded-2xl border-2 border-dashed border-[#dfe3e8] p-6 text-center">
                    <div className="text-sm text-gray-400">
                      이 고객의 인보이스를 생성하거나 확인할 수 있습니다.
                    </div>

                    <button
                      onClick={() =>
                        router.push(`/invoices/${selectedReservation.id}`)
                      }
                      className="mt-4 w-full rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
                    >
                      {selectedReservation.invoiceId
                        ? "인보이스 열기"
                        : "인보이스 생성"}
                    </button>
                  </div>

                  {selectedReservation.invoiceId && (
                    <button
                      onClick={handleDeleteInvoiceFromDetail}
                      className="w-full rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-medium text-red-600 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
                    >
                      인보이스 삭제
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {newOpen && (
        <>
          <div
            className="fixed inset-0 z-[998] bg-black/35"
            onClick={closeNewDrawer}
          />

          <div className="fixed right-0 top-0 z-[1001] flex h-screen w-[390px] max-w-[calc(100vw-12px)] flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
            <div className="flex shrink-0 items-center justify-between border-b border-[#edf0f3] px-6 py-5">
              <div>
                <div className="text-xl font-bold">신규 예약 등록</div>
                <div className="mt-1 text-sm text-gray-500">
                  단일 예약 추가
                </div>
              </div>

              <button
                onClick={closeNewDrawer}
                className="text-2xl text-gray-400 transition hover:scale-110 hover:text-gray-700 active:scale-95"
              >
                ×
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-auto p-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">이름 *</label>
                  <input
                    value={newForm.name}
                    onChange={(e) =>
                      setNewForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500">생년월일</label>
                  <input
                    value={newForm.birthInput}
                    onChange={(e) =>
                      setNewForm((prev) => ({
                        ...prev,
                        birthInput: e.target.value,
                      }))
                    }
                    placeholder="900101-1"
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />

                  {newForm.birthInput && (
                    <div className="mt-1 text-xs text-gray-500">
                      {birthPreview.birthDisplay}
                      {birthPreview.ageText
                        ? ` · ${birthPreview.ageText}`
                        : ""}
                      {birthPreview.gender ? ` · ${birthPreview.gender}` : ""}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-500">연락처</label>
                  <input
                    value={newForm.phone}
                    onChange={(e) =>
                      setNewForm((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500">국적</label>
                  <input
                    value={newForm.nationality}
                    onChange={(e) =>
                      setNewForm((prev) => ({
                        ...prev,
                        nationality: e.target.value,
                      }))
                    }
                    placeholder="몽골"
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">상담부위</label>
                <input
                  value={newForm.consultArea}
                  onChange={(e) =>
                    setNewForm((prev) => ({
                      ...prev,
                      consultArea: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">예약날짜 *</label>
                  <input
                    type="date"
                    value={newForm.reservationDate}
                    onChange={(e) =>
                      setNewForm((prev) => ({
                        ...prev,
                        reservationDate: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500">예약시간</label>
                  <input
                    type="time"
                    step={1800}
                    value={newForm.reservationTime}
                    onChange={(e) =>
                      setNewForm((prev) => ({
                        ...prev,
                        reservationTime: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">지정원장 *</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {doctors.map((doctor) => {
                    const on = newDoctors.includes(doctor.displayName);

                    return (
                      <button
                        key={doctor.uid}
                        onClick={() => toggleNewDoctor(doctor.displayName)}
                        className={`rounded-xl border px-3 py-2 text-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
                          on
                            ? "border-black bg-black text-white"
                            : "border-[#dfe3e8] bg-white text-gray-700"
                        }`}
                      >
                        {doctor.displayName}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">담당 실장</label>
                <input
                  value={newForm.coordinators}
                  onChange={(e) =>
                    setNewForm((prev) => ({
                      ...prev,
                      coordinators: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500">예약금</label>
                <input
                  value={newForm.depositAmount}
                  onChange={(e) =>
                    setNewForm((prev) => ({
                      ...prev,
                      depositAmount: e.target.value,
                    }))
                  }
                  placeholder="100,000원 / 10,000엔"
                  className="mt-1 w-full rounded-xl border border-[#dfe3e8] px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
                />
              </div>

              {newError && (
                <div className="text-sm text-red-500">{newError}</div>
              )}
            </div>

            <div className="flex shrink-0 gap-2 border-t border-[#edf0f3] p-4">
              <button
                onClick={closeNewDrawer}
                className="flex-1 rounded-xl border border-[#dfe3e8] py-3 text-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
              >
                취소
              </button>

              <button
                onClick={handleCreateReservation}
                disabled={saving}
                className="flex-1 rounded-xl bg-black py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-50"
              >
                {saving ? "저장 중..." : "예약 등록"}
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  );
}

function KpiBox({
  label,
  value,
  className,
  color,
}: {
  label: string;
  value: number;
  className?: string;
  color?: string;
}) {
  const validColor =
    color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "";

  return (
    <div
      className={`rounded-xl px-3 py-1.5 ${className || ""}`}
      style={
        validColor
          ? {
              backgroundColor: getSoftStatusColor(validColor),
              color: validColor,
              border: `1px solid ${validColor}33`,
            }
          : undefined
      }
    >
      <div className="text-xs font-semibold opacity-90">{label}</div>
      <div className="text-lg font-extrabold">{value}</div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-gray-500">{label}</label>
      <input
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
      />
    </div>
  );
}
