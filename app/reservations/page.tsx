"use client";

import { useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  createReservation,
  createReservationsBatch,
  deleteReservation,
  type DoctorOption,
  type ReservationRecord,
  type ReservationStatus,
  toggleSurgeryReserved,
  updateReservationFull,
  updateReservationStatus,
} from "@/lib/reservations";
import type { StaffUser } from "@/lib/auth";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useReservationData } from "@/hooks/useReservationData";
import {
  getReservationBirthInfo,
  parseBirthInfo,
} from "@/lib/reservationUtils";
import { db } from "@/lib/firebase";
import { type VisitStatusColorMap } from "@/lib/settings";
import { todayString } from "@/lib/dateUtils";
import {
  getStatusColor,
  getSoftStatusColor,
  getStatusSelectStyle,
} from "@/lib/colorUtils";
import { formatDateGroup, normalizeTimeText } from "@/lib/timelineUtils";

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

export default function ReservationsPage() {
  const router = useRouter();

  const { currentUser, authReady } = useCurrentUser();
  const { reservations, doctors, statusColors, loading } = useReservationData(
    currentUser,
    authReady
  );

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
    } catch (error) {
      console.error(error);
      setErrorMessage("예약 등록 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!currentUser) {
      setErrorMessage("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    if (!editingReservation) {
      setErrorMessage("수정할 예약 정보를 찾을 수 없습니다.");
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
    } catch (error) {
      console.error(error);
      setErrorMessage("예약 수정 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleImportFromSheet() {
    if (!currentUser) {
      setErrorMessage("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    if (!importUrl.trim()) {
      setErrorMessage("구글시트 URL을 입력하세요.");
      return;
    }

    setImportLoading(true);
    setErrorMessage("");
    setImportResultMessage("");

    try {
      const response = await fetch("/api/import-sheet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: importUrl.trim(),
        }),
      });

      const result = await response.json();

      if (!result.success) {
        setErrorMessage(result.message || "구글시트 가져오기에 실패했습니다.");
        return;
      }

      const batchResult = await createReservationsBatch(
        result.payloads,
        currentUser
      );

      if (!batchResult.success) {
        setErrorMessage(
          batchResult.errors?.length
            ? batchResult.errors.join("\n")
            : "저장 가능한 예약 데이터가 없습니다."
        );
        return;
      }

      setImportResultMessage(
        `✅ ${batchResult.count}건 가져오기 완료${
          batchResult.errors?.length
            ? ` / 실패 ${batchResult.errors.length}건`
            : ""
        }`
      );

    } catch (error) {
      console.error(error);
      setErrorMessage("외부 링크 가져오기 중 오류가 발생했습니다.");
    } finally {
      setImportLoading(false);
    }
  }

  async function handleStatusChange(
    item: ReservationRecord,
    status: ReservationStatus
  ) {
    if (!currentUser) return;

    await updateReservationStatus(
      item.id,
      item.reservationId,
      status,
      currentUser
    );

    setReservations((prev) =>
      prev.map((r) =>
        r.id === item.id ? { ...r, operationStatus: status } : r
      )
    );
  }

  async function handleSurgeryToggle(item: ReservationRecord) {
    if (!currentUser) return;

    const next = !item.surgeryReserved;

    await toggleSurgeryReserved(
      item.id,
      item.reservationId,
      next,
      currentUser
    );

    setReservations((prev) =>
      prev.map((r) =>
        r.id === item.id ? { ...r, surgeryReserved: next } : r
      )
    );
  }

  async function handleDelete(item: ReservationRecord) {
    if (!currentUser) return;

    const ok = confirm(`${item.name} 님 예약을 삭제 처리할까요?`);
    if (!ok) return;

    const result = await deleteReservation(item.id, item.reservationId, currentUser);

    if (!result.success) {
      alert(result.message || "예약 삭제 권한이 없습니다.");
      return;
    }

    setReservations((prev) => prev.filter((r) => r.id !== item.id));
  }

  return (
    <>
      {invoiceMenu && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={closeInvoiceMenu} />

          <div
            className="fixed z-[9999] w-[170px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 text-sm shadow-xl"
            style={{
              left: invoiceMenu.x,
              top: invoiceMenu.y,
            }}
          >
            <button
              type="button"
              onClick={() => {
                const item = reservations.find((r) => r.id === invoiceMenu.id);
                if (item) openInvoicePage(item);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
            >
              <span>📂</span>
              <span>인보이스 보기</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const item = reservations.find((r) => r.id === invoiceMenu.id);
                if (item) handleDeleteInvoiceOnly(item);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-red-600 hover:bg-red-50"
            >
              <span>🧹</span>
              <span>인보이스 삭제</span>
            </button>
          </div>
        </>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white px-5 py-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름, 상담부위, 원장 검색..."
          className="w-[260px] rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:border-[#1d9e75]"
        />

        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:border-[#1d9e75]"
        />

        <button
          onClick={() => setFilterDate("")}
          className="rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-400"
        >
          날짜 초기화
        </button>

        <button
          onClick={openDrawer}
          className="ml-auto rounded-xl bg-black px-4 py-2 text-sm font-medium text-white"
        >
          + 단일 예약 추가
        </button>

        <button
          onClick={openImportDrawer}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700"
        >
          🔗 외부 링크 가져오기
        </button>

        <button
          onClick={loadData}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700"
        >
          새로고침
        </button>
      </div>

      <div className="px-5 pb-3 text-sm text-gray-500">
        전체 {reservations.length}건 / 표시 {filteredReservations.length}건
      </div>

      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <div className="overflow-x-auto border-y border-gray-100 bg-white">
          <table className="min-w-[1380px] w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[230px]" />
              <col className="w-[120px]" />
              <col className="w-[90px]" />
              <col className="w-[130px]" />
              <col className="w-[140px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[100px]" />
              <col className="w-[100px]" />
              <col className="w-[110px]" />
              <col className="w-[160px]" />
              <col className="w-[120px]" />
            </colgroup>

            <thead className="bg-gray-50">
              <tr>
                {[
                  "이름",
                  "생년월일",
                  "국적",
                  "연락처",
                  "상담부위",
                  "원장",
                  "실장",
                  "상태",
                  "수술예약",
                  "예약금",
                  "메모",
                  "관리",
                ].map((head) => (
                  <th
                    key={head}
                    className="border-b border-gray-200 px-4 py-3 text-left text-xs font-semibold text-gray-500"
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-gray-400">
                    데이터 로딩 중...
                  </td>
                </tr>
              ) : groupedReservations.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-gray-400">
                    예약이 없습니다.
                  </td>
                </tr>
              ) : (
                (() => {
                  const rows: React.ReactNode[] = [];
                  let lastDate = "";
                  let lastTime = "";

                  groupedReservations.forEach((item) => {
                    const date = item.reservationDate || "날짜 미정";
                    const time = normalizeTimeText(item.reservationTime || "");
                    const birthInfo = getReservationBirthInfo(item);
                    const currentStatus = item.operationStatus || "내원전";

                    if (!filterDate && date !== lastDate) {
                      rows.push(
                        <tr key={`date-${date}`} className="bg-gray-100">
                          <td
                            colSpan={12}
                            className="border-y border-gray-200 px-6 py-3 text-sm font-bold text-gray-900"
                          >
                            📅 {formatDateGroup(date)}
                          </td>
                        </tr>
                      );
                      lastDate = date;
                      lastTime = "";
                    }

                    if (!filterDate && time !== lastTime) {
                      rows.push(
                        <tr
                          key={`time-${date}-${time}`}
                          className="bg-gray-50"
                        >
                          <td
                            colSpan={12}
                            className="border-b border-gray-100 px-6 py-2 text-sm font-bold text-emerald-700"
                          >
                            ⏰ {time}
                          </td>
                        </tr>
                      );
                      lastTime = time;
                    }

                    rows.push(
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="border-b border-gray-100 px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) =>
                                handleInvoiceButtonClick(e, item)
                              }
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold shadow-sm transition hover:shadow active:scale-95 ${
                                item.invoiceId
                                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border border-gray-200 bg-gray-50 text-gray-400"
                              }`}
                              title={
                                item.invoiceId
                                  ? "인보이스 메뉴"
                                  : "인보이스 생성"
                              }
                            >
                              {item.invoiceId ? "🧾" : "+"}
                            </button>

                            <span className="truncate font-semibold text-gray-900">
                              {item.name}
                            </span>
                          </div>
                        </td>

                        <td className="border-b border-gray-100 px-4 py-3 text-gray-500">
                          {birthInfo.birthDisplay}
                        </td>

                        <td className="border-b border-gray-100 px-4 py-3 text-gray-500">
                          {item.nationality}
                        </td>

                        <td className="border-b border-gray-100 px-4 py-3 text-gray-500">
                          {item.phone}
                        </td>

                        <td className="border-b border-gray-100 px-4 py-3">
                          {item.consultArea}
                        </td>

                        <td className="border-b border-gray-100 px-4 py-3">
                          {item.doctors.join(", ")}
                        </td>

                        <td className="border-b border-gray-100 px-4 py-3 text-gray-500">
                          {item.coordinators.join(", ")}
                        </td>

                        <td className="border-b border-gray-100 px-4 py-3">
                          <select
                            value={currentStatus}
                            onChange={(e) =>
                              handleStatusChange(
                                item,
                                e.target.value as ReservationStatus
                              )
                            }
                            className="rounded-full border px-3 py-1 text-xs font-semibold outline-none transition"
                            style={getStatusSelectStyle(
                              currentStatus,
                              statusColors
                            )}
                          >
                            {STATUS_LIST.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="border-b border-gray-100 px-4 py-3 text-center">
                          <button
                            onClick={() => handleSurgeryToggle(item)}
                            className={`rounded-full px-3 py-1 text-xs ${
                              item.surgeryReserved
                                ? "bg-purple-50 text-purple-700"
                                : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {item.surgeryReserved ? "예약" : "미예약"}
                          </button>
                        </td>

                        <td className="border-b border-gray-100 px-4 py-3 text-gray-600">
                          {item.depositAmount || "—"}
                        </td>

                        <td className="border-b border-gray-100 px-4 py-3 text-xs text-gray-500">
                          <button className="text-emerald-700 hover:underline">
                            전체보기
                          </button>
                        </td>

                        <td className="border-b border-gray-100 px-4 py-3 text-center">
                          <button
                            onClick={() => openEditDrawer(item)}
                            className="px-2 py-1 text-xs text-blue-600 hover:underline"
                          >
                            수정
                          </button>

                          <button
                            onClick={() => handleDelete(item)}
                            className="px-2 py-1 text-xs text-red-500 hover:underline"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    );
                  });

                  return rows;
                })()
              )}
            </tbody>
          </table>
        </div>
      </div>

      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-[998] bg-black/35"
            onClick={closeDrawer}
          />

          <div className="fixed right-0 top-0 z-[999] flex h-screen w-[440px] max-w-full flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between border-b px-6 py-5">
              <div>
                <div className="text-xl font-bold">신규 예약 등록</div>
                <div className="mt-1 text-sm text-gray-500">
                  단일 예약 추가
                </div>
              </div>

              <button onClick={closeDrawer} className="text-2xl text-gray-400">
                ×
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-auto p-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">이름 *</label>
                  <input
                    value={form.name}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500">생년월일</label>
                  <input
                    value={form.birthInput}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        birthInput: e.target.value,
                      }))
                    }
                    placeholder="891210-1 / 19891210-1"
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />

                  {form.birthInput && (
                    <div className="mt-1 text-xs text-gray-500">
                      {birthPreview.birthDisplay && (
                        <span>{birthPreview.birthDisplay}</span>
                      )}
                      {birthPreview.ageText && (
                        <span> · {birthPreview.ageText}</span>
                      )}
                      {birthPreview.gender && (
                        <span> · {birthPreview.gender}</span>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-500">연락처</label>
                  <input
                    value={form.phone}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500">국적</label>
                  <input
                    value={form.nationality}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        nationality: e.target.value,
                      }))
                    }
                    placeholder="몽골"
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">상담부위</label>
                <input
                  value={form.consultArea}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      consultArea: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">예약날짜 *</label>
                  <input
                    type="date"
                    value={form.reservationDate}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        reservationDate: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500">예약시간</label>
                  <input
                    type="time"
                    value={form.reservationTime}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        reservationTime: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">지정원장 *</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {doctors.length === 0 ? (
                    <p className="text-sm text-gray-400">
                      등록된 원장이 없습니다.
                    </p>
                  ) : (
                    doctors.map((doctor) => {
                      const on = selectedDoctors.includes(doctor.displayName);

                      return (
                        <button
                          key={doctor.uid}
                          onClick={() => toggleDoctor(doctor.displayName)}
                          className={`rounded-xl border px-3 py-2 text-sm transition ${
                            on
                              ? "border-black bg-black text-white"
                              : "border-gray-300 bg-white"
                          }`}
                        >
                          {doctor.displayName}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">담당 실장</label>
                <input
                  value={form.coordinators}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      coordinators: e.target.value,
                    }))
                  }
                  placeholder="쉼표로 구분"
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500">예약금</label>
                <input
                  value={form.depositAmount}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      depositAmount: e.target.value,
                    }))
                  }
                  placeholder="100,000원 / 10,000엔"
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>

              {errorMessage && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {errorMessage}
                </div>
              )}
            </div>

            <div className="flex gap-2 border-t p-4">
              <button
                onClick={closeDrawer}
                className="flex-1 rounded-xl border py-3 text-sm"
              >
                취소
              </button>

              <button
                onClick={handleCreate}
                disabled={saving}
                className="flex-1 rounded-xl bg-black py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "저장 중..." : "예약 등록"}
              </button>
            </div>
          </div>
        </>
      )}

      {editDrawerOpen && editingReservation && (
        <>
          <div
            className="fixed inset-0 z-[998] bg-black/35"
            onClick={closeEditDrawer}
          />

          <div className="fixed right-0 top-0 z-[999] flex h-screen w-[440px] max-w-full flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between border-b px-6 py-5">
              <div>
                <div className="text-xl font-bold">예약 정보 수정</div>
                <div className="mt-1 text-sm text-gray-500">
                  {editingReservation.name} 님 예약 수정
                </div>
              </div>

              <button
                onClick={closeEditDrawer}
                className="text-2xl text-gray-400"
              >
                ×
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-auto p-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">이름 *</label>
                  <input
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500">생년월일</label>
                  <input
                    value={editForm.birthInput}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        birthInput: e.target.value,
                      }))
                    }
                    placeholder="891210-1 / 19891210-1"
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />

                  {editForm.birthInput && (
                    <div className="mt-1 text-xs text-gray-500">
                      {editBirthPreview.birthDisplay && (
                        <span>{editBirthPreview.birthDisplay}</span>
                      )}
                      {editBirthPreview.ageText && (
                        <span> · {editBirthPreview.ageText}</span>
                      )}
                      {editBirthPreview.gender && (
                        <span> · {editBirthPreview.gender}</span>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-500">연락처</label>
                  <input
                    value={editForm.phone}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        phone: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500">국적</label>
                  <input
                    value={editForm.nationality}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        nationality: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">상담부위</label>
                <input
                  value={editForm.consultArea}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      consultArea: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">예약날짜 *</label>
                  <input
                    type="date"
                    value={editForm.reservationDate}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        reservationDate: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500">예약시간</label>
                  <input
                    type="time"
                    value={editForm.reservationTime}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        reservationTime: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">지정원장 *</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {doctors.length === 0 ? (
                    <p className="text-sm text-gray-400">
                      등록된 원장이 없습니다.
                    </p>
                  ) : (
                    doctors.map((doctor) => {
                      const on = selectedEditDoctors.includes(
                        doctor.displayName
                      );

                      return (
                        <button
                          key={doctor.uid}
                          onClick={() => toggleEditDoctor(doctor.displayName)}
                          className={`rounded-xl border px-3 py-2 text-sm transition ${
                            on
                              ? "border-black bg-black text-white"
                              : "border-gray-300 bg-white"
                          }`}
                        >
                          {doctor.displayName}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">담당 실장</label>
                <input
                  value={editForm.coordinators}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      coordinators: e.target.value,
                    }))
                  }
                  placeholder="쉼표로 구분"
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500">예약금</label>
                <input
                  value={editForm.depositAmount}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      depositAmount: e.target.value,
                    }))
                  }
                  placeholder="100,000원 / 10,000엔"
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>

              {errorMessage && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {errorMessage}
                </div>
              )}
            </div>

            <div className="flex gap-2 border-t p-4">
              <button
                onClick={closeEditDrawer}
                className="flex-1 rounded-xl border py-3 text-sm"
              >
                취소
              </button>

              <button
                onClick={handleUpdate}
                disabled={saving}
                className="flex-1 rounded-xl bg-black py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "저장 중..." : "수정 저장"}
              </button>
            </div>
          </div>
        </>
      )}

      {importDrawerOpen && (
        <>
          <div
            className="fixed inset-0 z-[998] bg-black/35"
            onClick={closeImportDrawer}
          />

          <div className="fixed right-0 top-0 z-[999] flex h-screen w-[460px] max-w-full flex-col bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between border-b px-6 py-5">
              <div>
                <div className="text-xl font-bold">외부 링크 가져오기</div>
                <div className="mt-1 text-sm text-gray-500">
                  구글시트 URL에서 예약 데이터를 가져옵니다
                </div>
              </div>

              <button
                onClick={closeImportDrawer}
                className="text-2xl text-gray-400"
              >
                ×
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-auto p-6">
              <div className="rounded-2xl border p-4">
                <div className="mb-2 text-sm font-semibold">
                  📊 구글시트에서 가져오기
                </div>

                <div className="mb-3 text-xs leading-6 text-gray-500">
                  예약 데이터가 담긴 구글시트 URL을 입력하세요.
                  <br />
                  시트 공유 권한은 반드시{" "}
                  <b>링크가 있는 모든 사용자 보기 가능</b>으로 설정되어야
                  합니다.
                </div>

                <input
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                />

                <div className="mt-3 rounded-xl bg-gray-50 p-3 text-xs leading-6 text-gray-500">
                  <div className="mb-1 font-medium text-gray-700">
                    자동 인식 컬럼
                  </div>
                  <div>
                    이름, 생년월일, 연락처, 국적, 상담부위, 예약날짜,
                    예약시간, 원장, 실장, 예약금
                  </div>
                </div>

                <button
                  onClick={handleImportFromSheet}
                  disabled={importLoading}
                  className="mt-4 w-full rounded-xl bg-black py-3 text-sm font-medium text-white disabled:opacity-50"
                >
                  {importLoading ? "가져오는 중..." : "시트에서 가져오기"}
                </button>
              </div>

              {errorMessage && (
                <div className="whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {errorMessage}
                </div>
              )}

              {importResultMessage && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {importResultMessage}
                </div>
              )}
            </div>

            <div className="border-t p-4">
              <button
                onClick={closeImportDrawer}
                className="w-full rounded-xl border py-3 text-sm"
              >
                닫기
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
