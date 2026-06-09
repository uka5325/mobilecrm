"use client";

import { useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  deleteReservation,
  updateReservationFull,
  type ReservationRecord,
  type ReservationStatus,
  toggleSurgeryReserved,
  updateReservationStatus,
} from "@/lib/reservations";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useReservationData } from "@/hooks/useReservationData";
import { getReservationBirthInfo } from "@/lib/reservationUtils";
import { db } from "@/lib/firebase";
import { todayString } from "@/lib/dateUtils";
import {
  getStatusColor,
  getSoftStatusColor,
  getStatusSelectStyle,
} from "@/lib/colorUtils";
import { formatDateGroup, normalizeTimeText } from "@/lib/timelineUtils";
import { CreateDrawer } from "@/components/reservations/CreateDrawer";
import { EditDrawer } from "@/components/reservations/EditDrawer";
import { ImportDrawer } from "@/components/reservations/ImportDrawer";
import { getReservationNotes, updateReservationNote, deleteReservationNote, type ReservationNote } from "@/lib/reservationNotes";
import { toDate } from "@/lib/settingsUtils";

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

  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);

  const [editingReservation, setEditingReservation] =
    useState<ReservationRecord | null>(null);

  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineForm, setInlineForm] = useState<{
    name: string; birthInput: string; phone: string; nationality: string;
    consultArea: string; reservationDate: string; reservationTime: string;
    coordinators: string; depositAmount: string; doctors: string[];
  } | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);

  const [invoiceMenu, setInvoiceMenu] = useState<InvoiceMenuState>(null);

  type MemoPopover = { item: ReservationRecord; notes: ReservationNote[]; loading: boolean } | null;
  const [memoPopover, setMemoPopover] = useState<MemoPopover>(null);
  const memoPopoverRef = useRef<HTMLDivElement | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");

  const [downloadOpen, setDownloadOpen] = useState(false);
  const [dlStart, setDlStart] = useState(() => todayString().slice(0, 7) + "-01");
  const [dlEnd, setDlEnd] = useState(todayString);
  const [downloading, setDownloading] = useState(false);

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

    if (!confirm("연결된 인보이스를 삭제할까요?\n삭제 후 다시 생성할 수 있습니다.")) return;

    closeInvoiceMenu();

    try {
      const invoiceDocId = item.invoiceDocId || item.invoiceId;

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
  }

  function startInlineEdit(item: ReservationRecord) {
    setInlineEditId(item.id);
    setInlineForm({
      name: item.name || "",
      birthInput: item.birthInput || item.birth || "",
      phone: item.phone || "",
      nationality: item.nationality || "",
      consultArea: item.consultArea || "",
      reservationDate: item.reservationDate || "",
      reservationTime: item.reservationTime || "",
      coordinators: item.coordinators.join(", "),
      depositAmount: item.depositAmount || "",
      doctors: item.doctors || [],
    });
  }

  async function saveInlineEdit(item: ReservationRecord) {
    if (!inlineForm || !currentUser) return;
    setInlineSaving(true);
    try {
      await updateReservationFull(
        item.id,
        item.reservationId,
        item.patientId,
        {
          name: inlineForm.name,
          birthInput: inlineForm.birthInput,
          birth: inlineForm.birthInput,
          phone: inlineForm.phone,
          nationality: inlineForm.nationality,
          consultArea: inlineForm.consultArea,
          reservationDate: inlineForm.reservationDate,
          reservationTime: inlineForm.reservationTime,
          doctors: inlineForm.doctors,
          coordinators: inlineForm.coordinators.split(",").map((s) => s.trim()).filter(Boolean),
          depositAmount: inlineForm.depositAmount,
        },
        currentUser
      );
      setInlineEditId(null);
      setInlineForm(null);
    } catch {
      alert("수정 중 오류가 발생했습니다.");
    } finally {
      setInlineSaving(false);
    }
  }

  async function openMemoPopover(item: ReservationRecord) {
    setMemoPopover({ item, notes: [], loading: true });
    setEditingNoteId(null);
    try {
      const notes = await getReservationNotes(item.reservationId, item.id, item.patientId);
      setMemoPopover((prev) => (prev?.item.id === item.id ? { item, notes, loading: false } : prev));
    } catch {
      setMemoPopover((prev) => (prev?.item.id === item.id ? { item, notes: [], loading: false } : prev));
    }
  }

  async function handleMemoUpdate(note: ReservationNote) {
    if (!currentUser || !memoPopover) return;
    await updateReservationNote({
      noteId: note.id,
      reservationId: note.reservationId,
      patientId: note.patientId || memoPopover.item.patientId || "",
      memoText: editingNoteText,
      staff: currentUser,
    });
    setEditingNoteId(null);
    const notes = await getReservationNotes(memoPopover.item.reservationId, memoPopover.item.id, memoPopover.item.patientId);
    setMemoPopover((prev) => prev ? { ...prev, notes } : prev);
  }

  async function handleMemoDelete(note: ReservationNote) {
    if (!currentUser || !memoPopover) return;
    if (!confirm("메모를 삭제할까요?")) return;
    await deleteReservationNote({
      noteId: note.id,
      reservationId: note.reservationId,
      patientId: note.patientId || memoPopover.item.patientId || "",
      staff: currentUser,
    });
    const notes = await getReservationNotes(memoPopover.item.reservationId, memoPopover.item.id, memoPopover.item.patientId);
    setMemoPopover((prev) => prev ? { ...prev, notes } : prev);
  }

  function escapeCsv(value: string): string {
    const s = String(value ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toDateStr(value: unknown): string {
    const d = toDate(value);
    if (!d) return "";
    return (
      d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0") + " " +
      String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const inRange = reservations.filter((r) => {
        const d = r.reservationDate || "";
        return d >= dlStart && d <= dlEnd;
      });

      const notesPerReservation = await Promise.all(
        inRange.map((r) =>
          getReservationNotes(r.reservationId, r.id, r.patientId).catch(() => [] as ReservationNote[])
        )
      );

      const header = [
        "예약일", "예약시간", "환자명", "생년월일", "성별", "연락처",
        "상담부위", "담당원장", "상담실장", "수술결정여부",
        "예약금", "예약금통화", "현재상태", "전체메모", "등록일", "최종수정일",
      ];

      const rows = inRange.map((r, i) => {
        const birthInfo = getReservationBirthInfo(r);
        const notes = notesPerReservation[i];
        const allMemo = notes.map((n) => `[${n.createdBy || ""}] ${n.memoText}`).join(" | ");
        const depositRaw = String(r.depositAmount || "").trim();
        const depositMatch = depositRaw.match(/^([\d,]+)\s*([A-Z₩$¥€]+)?$/);
        const depositAmount = depositMatch ? depositMatch[1].replace(/,/g, "") : depositRaw;
        const depositCurrency = depositMatch?.[2] || "KRW";

        return [
          r.reservationDate || "",
          r.reservationTime || "",
          r.name || "",
          birthInfo.birthDisplay || "",
          birthInfo.gender || "",
          r.phone || "",
          r.consultArea || "",
          r.doctors.join(", "),
          r.coordinators.join(", "),
          r.surgeryReserved ? "예" : "아니오",
          depositAmount,
          depositCurrency,
          r.operationStatus || "",
          allMemo,
          toDateStr(r.createdAt),
          toDateStr(r.updatedAt),
        ].map(escapeCsv).join(",");
      });

      const bom = "﻿";
      const csv = bom + [header.map(escapeCsv).join(","), ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `예약목록_${dlStart}_${dlEnd}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloadOpen(false);
    } finally {
      setDownloading(false);
    }
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

  }

  return (
    <>
      {/* Memo popover */}
      {memoPopover && (
        <>
          <div className="fixed inset-0 z-[9994]" onClick={() => setMemoPopover(null)} />
          <div className="fixed left-1/2 top-1/2 z-[9995] w-[420px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#edf0f3] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#edf0f3] px-5 py-4">
              <div>
                <div className="font-bold text-gray-800">{memoPopover.item.name} 메모</div>
                <div className="text-xs text-gray-400">{memoPopover.item.reservationDate} · {memoPopover.item.reservationTime}</div>
              </div>
              <button onClick={() => setMemoPopover(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="max-h-[360px] overflow-y-auto p-5">
              {memoPopover.loading ? (
                <div className="py-8 text-center text-sm text-gray-400">메모 로딩 중...</div>
              ) : memoPopover.notes.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">등록된 메모가 없습니다.</div>
              ) : (
                <div className="space-y-3">
                  {memoPopover.notes.map((note) => (
                    <div key={note.id} className="rounded-xl border border-[#edf0f3] bg-[#f8fafc] p-3">
                      <div className="mb-1.5 flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 rounded-lg bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          {note.createdBy || "알 수 없음"}
                        </span>
                        {editingNoteId === note.id ? (
                          <textarea
                            className="flex-1 rounded-lg border border-[#dfe3e8] px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                            rows={2}
                            value={editingNoteText}
                            onChange={(e) => setEditingNoteText(e.target.value)}
                          />
                        ) : (
                          <span className="flex-1 text-sm leading-relaxed text-gray-700">{note.memoText}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                          {editingNoteId === note.id ? (
                            <>
                              <button onClick={() => handleMemoUpdate(note)} className="text-xs text-emerald-600 hover:underline">저장</button>
                              <button onClick={() => setEditingNoteId(null)} className="text-xs text-gray-400 hover:underline">취소</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.memoText); }} className="text-xs text-blue-500 hover:underline">수정</button>
                              <button onClick={() => handleMemoDelete(note)} className="text-xs text-red-400 hover:underline">삭제</button>
                            </>
                          )}
                        </div>
                        <div className="text-xs text-gray-400">
                          {(() => {
                            const d = toDate(note.createdAt);
                            if (!d) return "";
                            return d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
                          })()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

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

      <div className="-mx-6 mb-4 rounded-t-2xl border border-[#edf0f3] bg-[#ecfdf5] px-6 py-4 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름, 상담부위, 원장 검색..."
            className="h-10 min-w-0 flex-1 rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm outline-none focus:border-[#1d9e75]"
          />

          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="h-10 w-[160px] appearance-none rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none focus:border-[#1d9e75]"
          />

          <button
            onClick={() => setFilterDate("")}
            className="h-10 rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm text-gray-400 hover:bg-gray-50"
          >
            날짜 초기화
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="h-10 rounded-xl bg-black px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
          >
            + 단일 예약 추가
          </button>
          <button
            onClick={() => setImportDrawerOpen(true)}
            className="h-10 rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm text-gray-700 hover:bg-gray-50"
          >
            🔗 외부 링크 가져오기
          </button>

          <div className="relative ml-auto">
            <button
              onClick={() => setDownloadOpen((v) => !v)}
              className="h-10 rounded-xl border border-[#dfe3e8] bg-white px-4 text-sm text-gray-700 hover:bg-gray-50"
            >
              📥 다운로드
            </button>

          {downloadOpen && (
            <>
              <div className="fixed inset-0 z-[9990]" onClick={() => setDownloadOpen(false)} />
              <div className="absolute right-0 top-full z-[9991] mt-2 w-[280px] rounded-2xl border border-[#edf0f3] bg-white p-4 shadow-xl">
                <div className="mb-3 text-sm font-bold text-gray-700">예약 데이터 다운로드</div>
                <div className="mb-2 text-xs text-gray-400">선택한 기간의 예약을 CSV로 내보냅니다. (Google 스프레드시트에서 열기 가능)</div>
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-500">시작일</label>
                    <input
                      type="date"
                      value={dlStart}
                      onChange={(e) => setDlStart(e.target.value)}
                      className="w-full min-w-0 appearance-none rounded-xl border border-[#dfe3e8] px-2 py-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-500">종료일</label>
                    <input
                      type="date"
                      value={dlEnd}
                      onChange={(e) => setDlEnd(e.target.value)}
                      className="w-full min-w-0 appearance-none rounded-xl border border-[#dfe3e8] px-2 py-2 text-xs focus:border-[#1d9e75] focus:outline-none"
                    />
                  </div>
                </div>
                <div className="mb-3 text-xs text-gray-400">
                  해당 기간 예약: {reservations.filter((r) => {
                    const d = r.reservationDate || "";
                    return d >= dlStart && d <= dlEnd;
                  }).length}건
                </div>
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="w-full rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {downloading ? "생성 중..." : "CSV 다운로드"}
                </button>
              </div>
            </>
          )}
          </div>
        </div>
      </div>

      <div className="px-5 pb-3 text-sm text-gray-500">
        전체 {reservations.length}건 / 표시 {filteredReservations.length}건
      </div>

      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <div className="overflow-x-auto border-y border-gray-100 bg-white">
          <table className="min-w-[1380px] w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[200px]" />
              <col className="w-[110px]" />
              <col className="w-[80px]" />
              <col className="w-[130px]" />
              <col className="w-[120px]" />
              <col className="w-[90px]" />
              <col className="w-[100px]" />
              <col className="w-[90px]" />
              <col className="w-[100px]" />
              <col className="w-[80px]" />
              <col className="w-[120px]" />
              <col className="w-[110px]" />
            </colgroup>

            <thead className="bg-gray-50">
              <tr>
                {[
                  "이름",
                  "생년월일",
                  "국적",
                  "상담부위",
                  "원장",
                  "실장",
                  "상태",
                  "수술예약",
                  "예약금",
                  "메모",
                  "연락처",
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

                    const isEditing = inlineEditId === item.id;
                    const f = inlineForm;
                    const cellCls = "border-b border-gray-100 px-2 py-2";
                    const inputCls = "w-full rounded-lg border border-[#dfe3e8] px-2 py-1 text-xs focus:border-[#1d9e75] focus:outline-none";

                    rows.push(
                      <tr key={item.id} className={isEditing ? "bg-emerald-50" : "hover:bg-gray-50"}>
                        {/* 이름 */}
                        <td className={`${cellCls} px-4`}>
                          {isEditing ? (
                            <input className={inputCls} value={f!.name} onChange={(e) => setInlineForm((p) => p && ({ ...p, name: e.target.value }))} />
                          ) : (
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={(e) => handleInvoiceButtonClick(e, item)}
                                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold shadow-sm transition hover:shadow active:scale-95 ${item.invoiceId ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-gray-200 bg-gray-50 text-gray-400"}`}
                                title={item.invoiceId ? "인보이스 메뉴" : "인보이스 생성"}>
                                {item.invoiceId ? "🧾" : "+"}
                              </button>
                              <span className="truncate font-semibold text-gray-900">{item.name}</span>
                            </div>
                          )}
                        </td>

                        {/* 생년월일 */}
                        <td className={cellCls}>
                          {isEditing ? (
                            <input className={inputCls} value={f!.birthInput} onChange={(e) => setInlineForm((p) => p && ({ ...p, birthInput: e.target.value }))} placeholder="891210-1" />
                          ) : (
                            <span className="text-gray-500">{birthInfo.birthDisplay}</span>
                          )}
                        </td>

                        {/* 국적 */}
                        <td className={cellCls}>
                          {isEditing ? (
                            <input className={inputCls} value={f!.nationality} onChange={(e) => setInlineForm((p) => p && ({ ...p, nationality: e.target.value }))} />
                          ) : (
                            <span className="text-gray-500">{item.nationality}</span>
                          )}
                        </td>

                        {/* 상담부위 */}
                        <td className={cellCls}>
                          {isEditing ? (
                            <input className={inputCls} value={f!.consultArea} onChange={(e) => setInlineForm((p) => p && ({ ...p, consultArea: e.target.value }))} />
                          ) : item.consultArea}
                        </td>

                        {/* 원장 */}
                        <td className={cellCls}>
                          {isEditing ? (
                            <input className={inputCls} value={f!.doctors.join(", ")} onChange={(e) => setInlineForm((p) => p && ({ ...p, doctors: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))} placeholder="쉼표 구분" />
                          ) : item.doctors.join(", ")}
                        </td>

                        {/* 실장 */}
                        <td className={cellCls}>
                          {isEditing ? (
                            <input className={inputCls} value={f!.coordinators} onChange={(e) => setInlineForm((p) => p && ({ ...p, coordinators: e.target.value }))} placeholder="쉼표 구분" />
                          ) : (
                            <span className="text-gray-500">{item.coordinators.join(", ")}</span>
                          )}
                        </td>

                        {/* 상태 */}
                        <td className={cellCls}>
                          <select
                            value={currentStatus}
                            onChange={(e) => handleStatusChange(item, e.target.value as ReservationStatus)}
                            className="rounded-full border px-2 py-1 text-xs font-semibold outline-none transition"
                            style={getStatusSelectStyle(currentStatus, statusColors)}
                          >
                            {STATUS_LIST.map((status) => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                        </td>

                        {/* 수술예약 */}
                        <td className={`${cellCls} text-center`}>
                          <button onClick={() => handleSurgeryToggle(item)}
                            className={`rounded-full px-2 py-1 text-xs ${item.surgeryReserved ? "bg-purple-50 text-purple-700" : "bg-gray-100 text-gray-500"}`}>
                            {item.surgeryReserved ? "예약" : "미예약"}
                          </button>
                        </td>

                        {/* 예약금 */}
                        <td className={cellCls}>
                          {isEditing ? (
                            <input className={inputCls} value={f!.depositAmount} onChange={(e) => setInlineForm((p) => p && ({ ...p, depositAmount: e.target.value }))} />
                          ) : (
                            <span className="text-gray-600">{item.depositAmount || "—"}</span>
                          )}
                        </td>

                        {/* 메모 */}
                        <td className={`${cellCls} text-xs text-gray-500`}>
                          <button onClick={() => openMemoPopover(item)} className="text-emerald-700 hover:underline">전체보기</button>
                        </td>

                        {/* 연락처 */}
                        <td className={cellCls}>
                          {isEditing ? (
                            <input className={inputCls} value={f!.phone} onChange={(e) => setInlineForm((p) => p && ({ ...p, phone: e.target.value }))} />
                          ) : (
                            <span className="text-gray-500">{item.phone}</span>
                          )}
                        </td>

                        {/* 관리 */}
                        <td className={`${cellCls} text-center`}>
                          {isEditing ? (
                            <div className="flex justify-center gap-1">
                              <button onClick={() => saveInlineEdit(item)} disabled={inlineSaving} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-50">
                                {inlineSaving ? "…" : "저장"}
                              </button>
                              <button onClick={() => { setInlineEditId(null); setInlineForm(null); }} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500">
                                취소
                              </button>
                            </div>
                          ) : (
                            <>
                              <button onClick={() => startInlineEdit(item)} className="px-2 py-1 text-xs text-blue-600 hover:underline">수정</button>
                              <button onClick={() => handleDelete(item)} className="px-2 py-1 text-xs text-red-500 hover:underline">삭제</button>
                            </>
                          )}
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

      {currentUser && (
        <CreateDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          doctors={doctors}
          currentUser={currentUser}
          initialDate={filterDate || undefined}
        />
      )}

      {currentUser && (
        <EditDrawer
          open={editDrawerOpen}
          onClose={() => { setEditDrawerOpen(false); setEditingReservation(null); }}
          reservation={editingReservation}
          doctors={doctors}
          currentUser={currentUser}
        />
      )}

      {currentUser && (
        <ImportDrawer
          open={importDrawerOpen}
          onClose={() => setImportDrawerOpen(false)}
          currentUser={currentUser}
        />
      )}

    </>
  );
}
