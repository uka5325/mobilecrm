"use client";

import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  createReservation,
  createReservationsBatch,
  deleteReservation,
  type DoctorOption,
  getAllReservations,
  subscribeAllReservations,
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
import { db } from "@/lib/firebase";
import {
  DEFAULT_VISIT_STATUS_COLORS,
  getVisitStatusColors,
  VISIT_STATUS_LIST,
  type VisitStatus,
  type VisitStatusColorMap,
} from "@/lib/settings";

const STATUS_LIST: ReservationStatus[] = [
  "내원전",
  "대기",
  "원상중",
  "후상중",
  "귀가",
  "부도",
];

type InvoiceMenuState = {
  id: string;
  x: number;
  y: number;
} | null;

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

function getStatusSelectStyle(status: string, colors: VisitStatusColorMap) {
  const color = getStatusColor(status, colors);

  return {
    backgroundColor: getSoftStatusColor(color),
    color,
    borderColor: `${color}33`,
  };
}

function formatDateGroup(dateStr: string) {
  if (!dateStr) return "날짜 미정";

  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;

  const yoil = ["일", "월", "화", "수", "목", "금", "토"];

  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}.${String(d.getDate()).padStart(2, "0")} (${yoil[d.getDay()]})`;
}

function normalizeTimeText(value: string) {
  const s = String(value || "").trim();
  if (!s) return "시간 미정";

  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;

  return s;
}

export default function ReservationsPage() {
  const router = useRouter();

  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);

  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);

  const [statusColors, setStatusColors] = useState<VisitStatusColorMap>(
    DEFAULT_VISIT_STATUS_COLORS
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");

  const [selectedDoctors, setSelectedDoctors] = useState<string[]>([]);
  const [selectedEditDoctors, setSelectedEditDoctors] = useState<string[]>([]);

  const [editingReservation, setEditingReservation] =
    useState<ReservationRecord | null>(null);

  const [invoiceMenu, setInvoiceMenu] = useState<InvoiceMenuState>(null);

  const [importUrl, setImportUrl] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importResultMessage, setImportResultMessage] = useState("");

  const [form, setForm] = useState({
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

  const [editForm, setEditForm] = useState({
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
    return parseBirthInfo(form.birthInput);
  }, [form.birthInput]);

  const editBirthPreview = useMemo(() => {
    return parseBirthInfo(editForm.birthInput);
  }, [editForm.birthInput]);

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
      setReservations(data.reservations);
      setDoctors(data.doctors);
    } catch (error) {
      console.error(error);
      alert("예약 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function loadReservationSettings() {
    try {
      const colors = await getVisitStatusColors();
      setStatusColors(colors);
    } catch (error) {
      console.error("예약관리 설정 색상 로딩 오류:", error);
      setStatusColors(DEFAULT_VISIT_STATUS_COLORS);
    }
  }

  useEffect(() => {
    setLoading(true);
    loadReservationSettings();

    const unsubscribe = subscribeAllReservations(
      (data) => {
        setReservations(data.reservations);
        setDoctors(data.doctors);
        setLoading(false);
      },
      () => {
        setLoading(false);
        alert("예약 실시간 데이터를 불러오지 못했습니다.");
      }
    );

    return () => unsubscribe();
  }, []);

  const filteredReservations = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return reservations.filter((item) => {
      if (filterDate && item.reservationDate !== filterDate) return false;

      if (!keyword) return true;

      const birthInfo = getReservationBirthInfo(item);

      const target = [
        item.name,
        birthInfo.birthDisplay,
        birthInfo.ageText,
        birthInfo.gender,
        item.phone,
        item.nationality,
        item.consultArea,
        item.reservationDate,
        item.reservationTime,
        item.operationStatus,
        item.depositAmount,
        item.doctors.join(", "),
        item.coordinators.join(", "),
      ]
        .join(" ")
        .toLowerCase();

      return target.includes(keyword);
    });
  }, [reservations, search, filterDate]);

  const groupedReservations = useMemo(() => {
    return [...filteredReservations].sort((a, b) => {
      const aa = [
        a.reservationDate || "",
        a.reservationTime || "",
        a.name || "",
      ].join("");

      const bb = [
        b.reservationDate || "",
        b.reservationTime || "",
        b.name || "",
      ].join("");

      return aa.localeCompare(bb);
    });
  }, [filteredReservations]);

  function closeInvoiceMenu() {
    setInvoiceMenu(null);
  }

  function openInvoicePage(item: ReservationRecord) {
    closeInvoiceMenu();
    router.push(`/invoices/${item.id}`);
  }

  function handleInvoiceButtonClick(
    e: MouseEvent<HTMLButtonElement>,
    item: ReservationRecord
  ) {
    e.preventDefault();
    e.stopPropagation();

    if (!item.invoiceId) {
      openInvoicePage(item);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();

    setInvoiceMenu((prev) =>
      prev?.id === item.id
        ? null
        : {
            id: item.id,
            x: Math.min(rect.left, window.innerWidth - 190),
            y: rect.bottom + 6,
          }
    );
  }

  async function handleDeleteInvoiceOnly(item: ReservationRecord) {
    if (!currentUser) return;

    const ok = confirm(
      "연결된 인보이스를 삭제할까요?\n삭제 후 다시 생성할 수 있습니다."
    );
    if (!ok) return;

    closeInvoiceMenu();

    try {
      const invoiceDocId =
        (item as any).invoiceDocId || (item as any).invoiceId || item.invoiceId;

      if (invoiceDocId) {
        await updateDoc(doc(db, "invoices", invoiceDocId), {
          status: "void",
          isDeleted: true,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.displayName,
          updatedByUid: currentUser.uid,
        });
      }

      await updateDoc(doc(db, "reservations", item.id), {
        invoiceId: "",
        invoiceDocId: "",
        invoiceStatus: "",
        invoiceUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.displayName,
        updatedByUid: currentUser.uid,
      });

      await loadData();
    } catch (error) {
      console.error(error);
      alert("인보이스 삭제 중 오류가 발생했습니다.");
    }
  }

  function openDrawer() {
    setErrorMessage("");
    setForm({
      name: "",
      birthInput: "",
      phone: "",
      nationality: "",
      consultArea: "",
      reservationDate: filterDate || todayString(),
      reservationTime: "",
      coordinators: "",
      depositAmount: "",
    });
    setSelectedDoctors([]);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setErrorMessage("");
    setSelectedDoctors([]);
  }

  function openEditDrawer(item: ReservationRecord) {
    setErrorMessage("");
    setEditingReservation(item);

    setEditForm({
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

    setSelectedEditDoctors(item.doctors || []);
    setEditDrawerOpen(true);
  }

  function closeEditDrawer() {
    setEditDrawerOpen(false);
    setEditingReservation(null);
    setSelectedEditDoctors([]);
    setErrorMessage("");
  }

  function openImportDrawer() {
    setImportUrl("");
    setImportResultMessage("");
    setErrorMessage("");
    setImportDrawerOpen(true);
  }

  function closeImportDrawer() {
    setImportDrawerOpen(false);
    setImportUrl("");
    setImportResultMessage("");
    setErrorMessage("");
  }

  function toggleDoctor(name: string) {
    setSelectedDoctors((prev) =>
      prev.includes(name)
        ? prev.filter((item) => item !== name)
        : [...prev, name]
    );
  }

  function toggleEditDoctor(name: string) {
    setSelectedEditDoctors((prev) =>
      prev.includes(name)
        ? prev.filter((item) => item !== name)
        : [...prev, name]
    );
  }

  async function handleCreate() {
    if (!currentUser) {
      setErrorMessage("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    if (!form.name.trim()) {
      setErrorMessage("이름을 입력하세요.");
      return;
    }

    if (!form.reservationDate) {
      setErrorMessage("예약날짜를 선택하세요.");
      return;
    }

    if (!selectedDoctors.length) {
      setErrorMessage("지정원장을 선택하세요.");
      return;
    }

    setSaving(true);
    setErrorMessage("");

    try {
      const result = await createReservation(
        {
          name: form.name,
          birthInput: form.birthInput,
          birth: form.birthInput,
          phone: form.phone,
          nationality: form.nationality,
          consultArea: form.consultArea,
          reservationDate: form.reservationDate,
          reservationTime: form.reservationTime,
          doctors: selectedDoctors,
          coordinators: form.coordinators
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          depositAmount: form.depositAmount,
        },
        currentUser
      );

      if (!result.success) {
        setErrorMessage(result.message || "예약 등록에 실패했습니다.");
        return;
      }

      closeDrawer();
      await loadData();
    } catch (error) {
      console.error(error);
      setErrorMessage("예약 등록 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!currentUser || !editingReservation) {
      setErrorMessage("수정할 예약 정보를 확인할 수 없습니다.");
      return;
    }

    if (!editForm.name.trim()) {
      setErrorMessage("이름을 입력하세요.");
      return;
    }

    if (!editForm.reservationDate) {
      setErrorMessage("예약날짜를 선택하세요.");
      return;
    }

    if (!selectedEditDoctors.length) {
      setErrorMessage("지정원장을 선택하세요.");
      return;
    }

    setSaving(true);
    setErrorMessage("");

    try {
      const result = await updateReservationFull(
        editingReservation.id,
        editingReservation.reservationId,
        editingReservation.patientId,
        {
          name: editForm.name,
          birthInput: editForm.birthInput,
          birth: editForm.birthInput,
          phone: editForm.phone,
          nationality: editForm.nationality,
          consultArea: editForm.consultArea,
          reservationDate: editForm.reservationDate,
          reservationTime: editForm.reservationTime,
          doctors: selectedEditDoctors,
          coordinators: editForm.coordinators
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          depositAmount: editForm.depositAmount,
        },
        currentUser
      );

      if (!result.success) {
        setErrorMessage(result.message || "예약 수정에 실패했습니다.");
        return;
      }

      closeEditDrawer();
      await loadData();
    } catch (error) {
      console.error(error);
      setErrorMessage("예약 수정 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(
    item: ReservationRecord,
    status: ReservationStatus
  ) {
    if (!currentUser) return;

    try {
      await updateReservationStatus(
        item.id,
        item.reservationId,
        status,
        currentUser
      );
    } catch (error) {
      console.error(error);
      alert("예약 상태 변경 중 오류가 발생했습니다.");
    }
  }

  async function handleSurgeryToggle(item: ReservationRecord) {
    if (!currentUser) return;

    try {
      await toggleSurgeryReserved(
        item.id,
        item.reservationId,
        !item.surgeryReserved,
        currentUser
      );
    } catch (error) {
      console.error(error);
      alert("수술예약 상태 변경 중 오류가 발생했습니다.");
    }
  }

  async function handleDelete(item: ReservationRecord) {
    if (!currentUser) return;

    const ok = confirm(
      `${item.name}님의 예약을 삭제할까요?\n삭제된 예약은 목록에서 숨김 처리됩니다.`
    );

    if (!ok) return;

    try {
      const result = await deleteReservation(
        item.id,
        item.reservationId,
        currentUser
      );

      if (!result.success) {
        alert(result.message || "예약 삭제 권한이 없습니다.");
        return;
      }

      await loadData();
    } catch (error) {
      console.error(error);
      alert("예약 삭제 중 오류가 발생했습니다.");
    }
  }

  async function handleImport() {
    if (!currentUser) {
      setErrorMessage("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    if (!importUrl.trim()) {
      setErrorMessage("구글시트 CSV 또는 공유 URL을 입력하세요.");
      return;
    }

    setImportLoading(true);
    setErrorMessage("");
    setImportResultMessage("");

    try {
      const res = await fetch("/api/import-sheet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: importUrl.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMessage(data.message || "구글시트 가져오기에 실패했습니다.");
        return;
      }

      const rows = Array.isArray(data.rows) ? data.rows : [];

      if (!rows.length) {
        setImportResultMessage("가져올 예약 데이터가 없습니다.");
        return;
      }

      const result = await createReservationsBatch(rows, currentUser);

      const errorText = result.errors?.length
        ? `\n\n실패/중복:\n${result.errors.slice(0, 20).join("\n")}${
            result.errors.length > 20
              ? `\n외 ${result.errors.length - 20}건`
              : ""
          }`
        : "";

      setImportResultMessage(
        `${result.count || 0}건을 가져왔습니다.${errorText}`
      );

      await loadData();
    } catch (error) {
      console.error(error);
      setErrorMessage("구글시트 가져오기 중 오류가 발생했습니다.");
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <div className="space-y-5" onClick={closeInvoiceMenu}>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">예약관리</h1>
            <p className="mt-1 text-sm text-slate-500">
              예약 생성, 수정, 인보이스 연결, 구글시트 가져오기를 관리합니다.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openImportDrawer}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              구글시트 가져오기
            </button>

            <button
              type="button"
              onClick={openDrawer}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              + 예약 추가
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_180px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름, 연락처, 국적, 상담부위, 원장, 코디 검색"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
          />

          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
          />
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">
            예약 데이터를 불러오는 중입니다.
          </div>
        ) : groupedReservations.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            표시할 예약이 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {groupedReservations.map((item, index) => {
              const prev = groupedReservations[index - 1];
              const showDateHeader =
                !prev || prev.reservationDate !== item.reservationDate;
              const birthInfo = getReservationBirthInfo(item);

              return (
                <div key={item.id}>
                  {showDateHeader && (
                    <div className="bg-slate-50 px-5 py-3 text-sm font-bold text-slate-700">
                      {formatDateGroup(item.reservationDate)}
                    </div>
                  )}

                  <div className="grid gap-4 px-5 py-4 lg:grid-cols-[100px_1.3fr_1fr_1fr_150px_180px] lg:items-center">
                    <div className="text-sm font-semibold text-slate-600">
                      {normalizeTimeText(item.reservationTime)}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => handleInvoiceButtonClick(e, item)}
                          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                            item.invoiceId
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                          }`}
                          title={
                            item.invoiceId
                              ? "인보이스 보기/삭제"
                              : "인보이스 생성"
                          }
                        >
                          +
                        </button>

                        <button
                          type="button"
                          onClick={() => openEditDrawer(item)}
                          className="text-left text-base font-bold text-slate-900 hover:underline"
                        >
                          {item.name}
                        </button>
                      </div>

                      <div className="mt-1 text-xs text-slate-500">
                        {item.reservationId} · {birthInfo.birthDisplay || "-"} ·{" "}
                        {birthInfo.ageText || "-"} · {birthInfo.gender || "-"}
                      </div>
                    </div>

                    <div className="text-sm text-slate-600">
                      <div>{item.phone || "-"}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        {item.nationality || "-"}
                      </div>
                    </div>

                    <div className="text-sm text-slate-600">
                      <div className="font-medium text-slate-700">
                        {item.consultArea || "-"}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {item.doctors.join(", ") || "-"}
                      </div>
                    </div>

                    <div>
                      <select
                        value={item.operationStatus || "내원전"}
                        onChange={(e) =>
                          handleStatusChange(
                            item,
                            e.target.value as ReservationStatus
                          )
                        }
                        style={getStatusSelectStyle(
                          item.operationStatus || "내원전",
                          statusColors
                        )}
                        className="w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                      >
                        {STATUS_LIST.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => handleSurgeryToggle(item)}
                        className={`rounded-xl px-3 py-2 text-xs font-bold ${
                          item.surgeryReserved
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {item.surgeryReserved ? "수술예약" : "상담예약"}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {invoiceMenu && (
        <div
          className="fixed z-50 w-44 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
          style={{
            left: invoiceMenu.x,
            top: invoiceMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const item = reservations.find((r) => r.id === invoiceMenu.id);
            if (!item) return null;

            return (
              <>
                <button
                  type="button"
                  onClick={() => openInvoicePage(item)}
                  className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  인보이스 보기
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteInvoiceOnly(item)}
                  className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50"
                >
                  인보이스 삭제
                </button>
              </>
            );
          })()}
        </div>
      )}

            {/* 신규 예약 Drawer */}
      {drawerOpen && (
        <ReservationDrawer
          title="예약 추가"
          saving={saving}
          errorMessage={errorMessage}
          form={form}
          setForm={setForm}
          doctors={doctors}
          selectedDoctors={selectedDoctors}
          toggleDoctor={toggleDoctor}
          birthPreview={birthPreview}
          onClose={closeDrawer}
          onSubmit={handleCreate}
        />
      )}

      {/* 예약 수정 Drawer */}
      {editDrawerOpen && editingReservation && (
        <ReservationDrawer
          title="예약 수정"
          saving={saving}
          errorMessage={errorMessage}
          form={editForm}
          setForm={setEditForm}
          doctors={doctors}
          selectedDoctors={selectedEditDoctors}
          toggleDoctor={toggleEditDoctor}
          birthPreview={editBirthPreview}
          onClose={closeEditDrawer}
          onSubmit={handleUpdate}
        />
      )}

      {/* 구글시트 Import Drawer */}
      {importDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold">구글시트 가져오기</h3>

            <p className="mt-2 text-sm text-slate-500">
              공유된 CSV URL 또는 Google Sheet 공유 링크를 입력하세요.
            </p>

            <textarea
              rows={4}
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              className="mt-4 w-full rounded-2xl border border-slate-200 p-3 text-sm outline-none focus:border-slate-400"
              placeholder="https://docs.google.com/..."
            />

            {errorMessage && (
              <div className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-600">
                {errorMessage}
              </div>
            )}

            {importResultMessage && (
              <div className="mt-3 whitespace-pre-line rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
                {importResultMessage}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeImportDrawer}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm"
              >
                닫기
              </button>

              <button
                type="button"
                disabled={importLoading}
                onClick={handleImport}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                {importLoading ? "가져오는 중..." : "가져오기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------- */
/* Drawer Component */
/* -------------------------------------------------- */

type DrawerProps = {
  title: string;
  saving: boolean;
  errorMessage: string;
  form: any;
  setForm: any;
  doctors: DoctorOption[];
  selectedDoctors: string[];
  toggleDoctor: (name: string) => void;
  birthPreview: any;
  onClose: () => void;
  onSubmit: () => void;
};

function ReservationDrawer({
  title,
  saving,
  errorMessage,
  form,
  setForm,
  doctors,
  selectedDoctors,
  toggleDoctor,
  birthPreview,
  onClose,
  onSubmit,
}: DrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-6 space-y-4">

          <input
            value={form.name}
            onChange={(e) =>
              setForm((prev: any) => ({
                ...prev,
                name: e.target.value,
              }))
            }
            placeholder="이름"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
          />

          <input
            value={form.birthInput}
            onChange={(e) =>
              setForm((prev: any) => ({
                ...prev,
                birthInput: e.target.value,
              }))
            }
            placeholder="890905 또는 890905-1"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
          />

          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            생년월일 : {birthPreview.birth || "-"} <br />
            성별 : {birthPreview.gender || "-"}
          </div>

          <input
            value={form.phone}
            onChange={(e) =>
              setForm((prev: any) => ({
                ...prev,
                phone: e.target.value,
              }))
            }
            placeholder="연락처"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
          />

          <input
            value={form.nationality}
            onChange={(e) =>
              setForm((prev: any) => ({
                ...prev,
                nationality: e.target.value,
              }))
            }
            placeholder="국적"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
          />

          <input
            value={form.consultArea}
            onChange={(e) =>
              setForm((prev: any) => ({
                ...prev,
                consultArea: e.target.value,
              }))
            }
            placeholder="상담부위"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
          />

          <input
            type="date"
            value={form.reservationDate}
            onChange={(e) =>
              setForm((prev: any) => ({
                ...prev,
                reservationDate: e.target.value,
              }))
            }
            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
          />

          <input
            type="time"
            value={form.reservationTime}
            onChange={(e) =>
              setForm((prev: any) => ({
                ...prev,
                reservationTime: e.target.value,
              }))
            }
            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
          />

          <div>
            <div className="mb-2 text-sm font-semibold">
              지정원장
            </div>

            <div className="flex flex-wrap gap-2">
              {doctors.map((doctor) => (
                <button
                  key={doctor.uid}
                  type="button"
                  onClick={() => toggleDoctor(doctor.displayName)}
                  className={`rounded-xl px-3 py-2 text-sm ${
                    selectedDoctors.includes(doctor.displayName)
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {doctor.displayName}
                </button>
              ))}
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-600">
              {errorMessage}
            </div>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={onSubmit}
            className="w-full rounded-2xl bg-slate-900 py-3 font-semibold text-white"
          >
            {saving ? "저장 중..." : title}
          </button>
        </div>
      </div>
    </div>
  );
}
