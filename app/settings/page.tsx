"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  addConferenceMemo,
  changeMyPassword,
  COUNTRY_TIMEZONES,
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_VISIT_STATUS_COLORS,
  deactivateStaffFromSettings,
  deleteConferenceMemo,
  getConferenceMemos,
  getGeneralSettings,
  getStaffListForSettings,
  getVisitStatusColors,
  resetVisitStatusColors,
  saveGeneralSettings,
  saveVisitStatusColors,
  updateStaffFromSettings,
  VISIT_STATUS_LIST,
  type ConferenceMemo,
  type CountryKey,
  type GeneralSettings,
  type SettingsStaffRecord,
  type SettingsStaffRole,
  type VisitStatus,
  type VisitStatusColorMap,
} from "@/lib/settings";
import { getStaffByUid, listenCurrentUser } from "@/lib/auth";
import type { StaffUser } from "@/lib/auth";
import {
  deactivateInvoiceCategory,
  deactivateInvoiceItem,
  deactivateInvoiceTemplate,
  deactivateInvoiceTemplateSection,
  getInvoiceCategories,
  getInvoiceItems,
  getInvoiceTemplateSections,
  getInvoiceTemplates,
  saveInvoiceCategory,
  saveInvoiceItem,
  saveInvoiceTemplate,
  saveInvoiceTemplateSection,
  type InvoiceCategory,
  type InvoiceCurrency,
  type InvoiceItem,
  type InvoiceTemplate,
  type InvoiceTemplateSection,
} from "@/lib/invoiceSettings";

type SettingsTab =
  | "statusColors"
  | "system"
  | "memo"
  | "staff"
  | "invoice"
  | "security";

type InvoiceTab = "categories" | "items" | "sections" | "templates";

const TAB_ITEMS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: "statusColors", label: "내원상태 색상", icon: "🎨" },
  { key: "system", label: "기본 설정", icon: "🌐" },
  { key: "memo", label: "오늘의 메모", icon: "📝" },
  { key: "staff", label: "직원 관리", icon: "👥" },
  { key: "invoice", label: "인보이스 설정", icon: "🧾" },
  { key: "security", label: "보안", icon: "🔐" },
];

const INVOICE_TAB_ITEMS: { key: InvoiceTab; label: string }[] = [
  { key: "categories", label: "대분류" },
  { key: "items", label: "수술항목/가격" },
  { key: "sections", label: "안내사항" },
  { key: "templates", label: "제목/템플릿" },
];

const STAFF_ROLES: SettingsStaffRole[] = [
  "admin",
  "doctor",
  "coordinator",
  "staff",
  "interpreter",
];

const CURRENCY_LIST: InvoiceCurrency[] = [
  "KRW",
  "USD",
  "JPY",
  "CNY",
  "MNT",
  "VND",
];

const STATUS_HELP: Record<VisitStatus, string> = {
  내원전: "아직 방문 전인 예약",
  대기: "내원 후 대기 중인 고객",
  원상중: "원장 상담 진행 중",
  후상중: "실장/후상담 진행 중",
  귀가: "상담 또는 진료 종료",
  부도: "예약 후 미방문",
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

function getReadableTextColor(hex: string) {
  const clean = hex.replace("#", "");

  if (clean.length !== 6) return "#ffffff";

  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  return brightness > 150 ? "#111827" : "#ffffff";
}

function normalizeHexInput(value: string) {
  const raw = value.trim();

  if (!raw) return "#000000";
  if (raw.startsWith("#")) return raw;

  return `#${raw}`;
}

function isValidHex(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "오류가 발생했습니다.";
}

function toDate(value: unknown) {
  try {
    if (!value) return null;

    if (
      typeof value === "object" &&
      value !== null &&
      "toDate" in value &&
      typeof (value as { toDate?: unknown }).toDate === "function"
    ) {
      return (value as { toDate: () => Date }).toDate();
    }

    if (value instanceof Date) return value;

    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return date;
    }

    return null;
  } catch {
    return null;
  }
}

function formatDateTime(value: unknown) {
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

function notifyStaffSettingsUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("arc-crm-staff-updated"));
}

function formatPrice(value: number | string | undefined) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("ko-KR");
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("statusColors");
  const [activeInvoiceTab, setActiveInvoiceTab] =
    useState<InvoiceTab>("categories");

  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [colors, setColors] = useState<VisitStatusColorMap>(
    DEFAULT_VISIT_STATUS_COLORS
  );
  const [initialColors, setInitialColors] = useState<VisitStatusColorMap>(
    DEFAULT_VISIT_STATUS_COLORS
  );

  const [generalSettings, setGeneralSettings] = useState<GeneralSettings>(
    DEFAULT_GENERAL_SETTINGS
  );
  const [selectedCountry, setSelectedCountry] = useState<CountryKey>("Korea");

  const [memoDate, setMemoDate] = useState(todayString());
  const [memoText, setMemoText] = useState("");
  const [memos, setMemos] = useState<ConferenceMemo[]>([]);

  const [staffList, setStaffList] = useState<SettingsStaffRecord[]>([]);

  const [invoiceCategories, setInvoiceCategories] = useState<InvoiceCategory[]>(
    []
  );
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [invoiceSections, setInvoiceSections] = useState<
    InvoiceTemplateSection[]
  >([]);
  const [invoiceTemplates, setInvoiceTemplates] = useState<InvoiceTemplate[]>(
    []
  );

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [loading, setLoading] = useState(true);
  const [memoLoading, setMemoLoading] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canManageSettings = useMemo(() => {
    const role = String(currentUser?.role || "").toLowerCase();
    return role === "admin" || role === "doctor";
  }, [currentUser]);

  const canEditMemo = useMemo(() => {
    const role = String(currentUser?.role || "").toLowerCase();
    return ["admin", "doctor", "coordinator", "staff"].includes(role);
  }, [currentUser]);

  const hasColorChanges = useMemo(() => {
    return JSON.stringify(colors) !== JSON.stringify(initialColors);
  }, [colors, initialColors]);

  useEffect(() => {
    const unsubscribe = listenCurrentUser(async (user: User | null) => {
      try {
        if (!user) {
          setCurrentUser(null);
          setAuthLoading(false);
          return;
        }

        const staff = await getStaffByUid(user.uid);
        setCurrentUser(staff || null);
      } catch (err) {
        console.error(err);
        setCurrentUser(null);
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  async function loadBaseSettings() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const [loadedColors, loadedGeneral] = await Promise.all([
        getVisitStatusColors(),
        getGeneralSettings(),
      ]);

      setColors(loadedColors);
      setInitialColors(loadedColors);
      setGeneralSettings(loadedGeneral);
      setSelectedCountry(loadedGeneral.appCountry);
    } catch (err) {
      console.error(err);
      setError("설정 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMemos(date = memoDate) {
    setMemoLoading(true);
    setError("");

    try {
      const list = await getConferenceMemos(date, 50);
      setMemos(list);
    } catch (err) {
      console.error(err);
      setError("메모를 불러오지 못했습니다.");
    } finally {
      setMemoLoading(false);
    }
  }

  async function loadStaffList() {
    setStaffLoading(true);
    setError("");

    try {
      const list = await getStaffListForSettings();
      setStaffList(list);
    } catch (err) {
      console.error(err);
      setError("직원 목록을 불러오지 못했습니다.");
    } finally {
      setStaffLoading(false);
    }
  }

  async function loadInvoiceSettings() {
    setInvoiceLoading(true);
    setError("");

    try {
      const [categories, items, sections, templates] = await Promise.all([
        getInvoiceCategories(true),
        getInvoiceItems({ includeInactive: true }),
        getInvoiceTemplateSections(true),
        getInvoiceTemplates(true),
      ]);

      setInvoiceCategories(categories);
      setInvoiceItems(items);
      setInvoiceSections(sections);
      setInvoiceTemplates(templates);
    } catch (err) {
      console.error(err);
      setError("인보이스 설정을 불러오지 못했습니다.");
    } finally {
      setInvoiceLoading(false);
    }
  }

  useEffect(() => {
    loadBaseSettings();
    loadMemos(todayString());
    loadStaffList();
    loadInvoiceSettings();
  }, []);

  function clearAlerts() {
    setError("");
    setMessage("");
  }

  function updateColor(status: VisitStatus, value: string) {
    const next = normalizeHexInput(value);

    setColors((prev) => ({
      ...prev,
      [status]: next,
    }));
  }

  async function handleSaveColors() {
    if (!currentUser) {
      setError("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    const invalidStatus = VISIT_STATUS_LIST.find(
      (status) => !isValidHex(colors[status])
    );

    if (invalidStatus) {
      setError(`${invalidStatus} 색상 형식이 올바르지 않습니다. 예: #1d9e75`);
      return;
    }

    setSaving(true);
    clearAlerts();

    try {
      const savedColors = await saveVisitStatusColors(colors, currentUser);
      setColors(savedColors);
      setInitialColors(savedColors);
      setMessage("내원상태 색상이 저장되었습니다.");
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleResetColors() {
    if (!currentUser) {
      setError("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    const ok = confirm("내원상태 색상을 기본값으로 되돌릴까요?");
    if (!ok) return;

    setSaving(true);
    clearAlerts();

    try {
      const resetColors = await resetVisitStatusColors(currentUser);
      setColors(resetColors);
      setInitialColors(resetColors);
      setMessage("기본 색상으로 복원되었습니다.");
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveGeneralSettings() {
    if (!currentUser) {
      setError("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    setSaving(true);
    clearAlerts();

    try {
      const saved = await saveGeneralSettings(selectedCountry, currentUser);
      setGeneralSettings(saved);
      setSelectedCountry(saved.appCountry);
      setMessage("기본 설정이 저장되었습니다.");
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMemo() {
    if (!currentUser) {
      setError("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    if (!memoText.trim()) {
      setError("메모 내용을 입력하세요.");
      return;
    }

    setSaving(true);
    clearAlerts();

    try {
      await addConferenceMemo(memoDate, memoText, currentUser);
      setMemoText("");
      await loadMemos(memoDate);
      setMessage("메모가 추가되었습니다.");
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteMemo(memoId: string) {
    if (!currentUser) {
      setError("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    const ok = confirm("이 메모를 삭제할까요?");
    if (!ok) return;

    setSaving(true);
    clearAlerts();

    try {
      await deleteConferenceMemo(memoId, currentUser);
      await loadMemos(memoDate);
      setMessage("메모가 삭제되었습니다.");
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!currentUser) {
      setError("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    setSaving(true);
    clearAlerts();

    try {
      await changeMyPassword(currentPassword, newPassword, currentUser);
      setCurrentPassword("");
      setNewPassword("");
      setMessage("비밀번호가 변경되었습니다.");
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function runInvoiceAction(action: () => Promise<void>, doneMessage: string) {
    if (!currentUser) {
      setError("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    setSaving(true);
    clearAlerts();

    try {
      await action();
      await loadInvoiceSettings();
      setMessage(doneMessage);
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid max-w-[1180px] grid-cols-1 gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
      <nav className="h-fit rounded-[18px] border border-[#edf0f3] bg-white p-3 shadow-[0_2px_14px_rgba(0,0,0,0.04)] lg:sticky lg:top-8">
        <div className="mb-3 px-2 text-xs font-bold text-gray-400">
          SETTINGS
        </div>

        <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {TAB_ITEMS.map((item) => {
            const active = activeTab === item.key;

            return (
              <button
                key={item.key}
                onClick={() => {
                  setActiveTab(item.key);
                  clearAlerts();
                }}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-3 text-left text-sm transition hover:-translate-y-0.5 active:scale-95 lg:w-full ${
                  active
                    ? "bg-emerald-50 font-bold text-emerald-700"
                    : "bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="min-w-0">
        <GlobalAlert error={error} message={message} />

        {activeTab === "statusColors" && (
          <section className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
            <SectionHeader
              title="내원상태 색상 설정"
              description="타임라인 고객 카드, 예약관리 상태 배지, 대시보드 상태 표시 색상에 공통으로 사용할 기준 색상입니다."
              badge={
                authLoading
                  ? "권한 확인 중"
                  : canManageSettings
                    ? "수정 가능"
                    : "보기 전용"
              }
              badgeActive={canManageSettings}
            />

            {loading ? (
              <EmptyBox text="설정을 불러오는 중..." />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {VISIT_STATUS_LIST.map((status) => {
                    const color = colors[status];
                    const valid = isValidHex(color);
                    const previewColor = valid
                      ? color
                      : DEFAULT_VISIT_STATUS_COLORS[status];

                    return (
                      <div
                        key={status}
                        className="rounded-2xl border border-[#edf0f3] bg-white p-4"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-gray-900">
                              {status}
                            </div>
                            <div className="mt-0.5 text-xs text-gray-400">
                              {STATUS_HELP[status]}
                            </div>
                          </div>

                          <div
                            className="flex h-10 min-w-[76px] items-center justify-center rounded-xl px-3 text-xs font-bold shadow-sm"
                            style={{
                              backgroundColor: previewColor,
                              color: getReadableTextColor(previewColor),
                            }}
                          >
                            {status}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={previewColor}
                            disabled={!canManageSettings || saving}
                            onChange={(e) => updateColor(status, e.target.value)}
                            className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-[#dfe3e8] bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50"
                          />

                          <input
                            value={color}
                            disabled={!canManageSettings || saving}
                            onChange={(e) => updateColor(status, e.target.value)}
                            className={`h-10 min-w-0 flex-1 rounded-xl border bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100 disabled:bg-gray-50 disabled:text-gray-400 ${
                              valid ? "border-[#dfe3e8]" : "border-red-300"
                            }`}
                            placeholder="#1d9e75"
                          />
                        </div>

                        {!valid && (
                          <div className="mt-2 text-xs text-red-500">
                            HEX 색상값을 입력해주세요. 예: #1d9e75
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 rounded-2xl border border-[#edf0f3] bg-gray-50 p-4">
                  <div className="mb-3 text-sm font-bold text-gray-900">
                    미리보기
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {VISIT_STATUS_LIST.map((status) => {
                      const color = isValidHex(colors[status])
                        ? colors[status]
                        : DEFAULT_VISIT_STATUS_COLORS[status];

                      return (
                        <span
                          key={status}
                          className="rounded-full px-3 py-1.5 text-xs font-bold"
                          style={{
                            backgroundColor: color,
                            color: getReadableTextColor(color),
                          }}
                        >
                          {status}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    onClick={handleResetColors}
                    disabled={!canManageSettings || saving}
                    className="rounded-xl border border-[#dfe3e8] bg-white px-5 py-3 text-sm font-medium text-gray-700 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    기본값 복원
                  </button>

                  <button
                    onClick={handleSaveColors}
                    disabled={!canManageSettings || saving || !hasColorChanges}
                    className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "저장 중..." : "색상 저장"}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {activeTab === "system" && (
          <section className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
            <SectionHeader
              title="기본 설정"
              description="상담회 국가와 로그 시간대를 설정합니다. 예약 시간은 변환하지 않고, 로그/표시 기준 시간대만 관리합니다."
              badge={canManageSettings ? "수정 가능" : "보기 전용"}
              badgeActive={canManageSettings}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-gray-500">
                  상담회 국가
                </label>
                <select
                  value={selectedCountry}
                  disabled={!canManageSettings || saving}
                  onChange={(e) =>
                    setSelectedCountry(e.target.value as CountryKey)
                  }
                  className="h-11 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100 disabled:bg-gray-50 disabled:text-gray-400"
                >
                  {Object.entries(COUNTRY_TIMEZONES).map(([key, country]) => (
                    <option key={key} value={key}>
                      {country.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-500">
                  현재 로그 시간대
                </label>
                <input
                  value={COUNTRY_TIMEZONES[selectedCountry].timezone}
                  readOnly
                  className="h-11 w-full rounded-xl border border-[#dfe3e8] bg-gray-50 px-3 text-sm text-gray-500 outline-none"
                />
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[#edf0f3] bg-gray-50 p-4 text-sm text-gray-500">
              현재 저장값: {generalSettings.appCountryLabel} /{" "}
              {generalSettings.appTimezone}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={handleSaveGeneralSettings}
                disabled={!canManageSettings || saving}
                className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "저장 중..." : "기본 설정 저장"}
              </button>
            </div>
          </section>
        )}

        {activeTab === "memo" && (
          <section className="space-y-4">
            <div className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
              <SectionHeader
                title="오늘의 메모"
                description="선택한 날짜의 홈/타임라인에 표시할 운영 메모를 관리합니다."
                badge={canEditMemo ? "수정 가능" : "보기 전용"}
                badgeActive={canEditMemo}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    메모 표시 날짜
                  </label>
                  <input
                    type="date"
                    value={memoDate}
                    onChange={(e) => {
                      setMemoDate(e.target.value);
                      loadMemos(e.target.value);
                    }}
                    className="h-11 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    메모 내용
                  </label>
                  <textarea
                    rows={3}
                    value={memoText}
                    disabled={!canEditMemo || saving}
                    onChange={(e) => setMemoText(e.target.value)}
                    placeholder="전체 공유 메모를 입력하세요."
                    className="w-full resize-none rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleAddMemo}
                  disabled={!canEditMemo || saving}
                  className="rounded-xl bg-[#1d9e75] px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "저장 중..." : "메모 추가"}
                </button>
              </div>
            </div>

            <div className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900">
                  선택 날짜 메모
                </h3>
                <span className="text-xs text-gray-400">{memos.length}개</span>
              </div>

              {memoLoading ? (
                <EmptyBox text="메모를 불러오는 중..." />
              ) : memos.length === 0 ? (
                <EmptyBox text="등록된 메모가 없습니다." />
              ) : (
                <div className="space-y-2">
                  {memos.map((memo) => {
                    const memoTime = formatDateTime(memo.createdAt);

                    return (
                      <div
                        key={memo.id}
                        className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-4"
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div className="text-xs text-gray-400">
                            {memo.createdByName || "시스템"}
                            {memoTime ? ` · ${memoTime}` : ""}
                          </div>

                          {canEditMemo && (
                            <button
                              onClick={() => handleDeleteMemo(memo.id)}
                              disabled={saving}
                              className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-100 active:scale-95 disabled:opacity-50"
                            >
                              삭제
                            </button>
                          )}
                        </div>

                        <div className="whitespace-pre-line text-sm leading-6 text-gray-800">
                          {memo.memoText}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "staff" && (
          <section className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
            <SectionHeader
              title="직원 관리"
              description="직원 권한, 활성상태, 원장 표시 순서를 관리합니다. 신규 Auth 계정 생성은 서버 API 연결 후 추가하는 것이 안전합니다."
              badge={canManageSettings ? "수정 가능" : "보기 전용"}
              badgeActive={canManageSettings}
            />

            {staffLoading ? (
              <EmptyBox text="직원 목록을 불러오는 중..." />
            ) : staffList.length === 0 ? (
              <EmptyBox text="등록된 직원이 없습니다." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <Th>이름</Th>
                      <Th>이메일</Th>
                      <Th>권한</Th>
                      <Th>순서</Th>
                      <Th>상태</Th>
                      <Th>관리</Th>
                    </tr>
                  </thead>

                  <tbody>
                    {staffList.map((staff) => (
                      <StaffRow
                        key={staff.id}
                        item={staff}
                        currentUser={currentUser}
                        canManage={canManageSettings}
                        saving={saving}
                        onSave={async (payload) => {
                          if (!currentUser) {
                            setError("로그인 정보를 확인할 수 없습니다.");
                            return;
                          }

                          setSaving(true);
                          clearAlerts();

                          try {
                            await updateStaffFromSettings(
                              staff.id,
                              payload,
                              currentUser
                            );
                            await loadStaffList();
                            notifyStaffSettingsUpdated();
                            setMessage("직원 정보가 저장되었습니다.");
                          } catch (err) {
                            console.error(err);
                            setError(getErrorMessage(err));
                          } finally {
                            setSaving(false);
                          }
                        }}
                        onDeactivate={async () => {
                          if (!currentUser) {
                            setError("로그인 정보를 확인할 수 없습니다.");
                            return;
                          }

                          const ok = confirm(
                            "이 직원을 비활성화할까요?\n로그인은 차단되지만 기록은 보존됩니다."
                          );

                          if (!ok) return;

                          setSaving(true);
                          clearAlerts();

                          try {
                            await deactivateStaffFromSettings(
                              staff.id,
                              currentUser
                            );
                            await loadStaffList();
                            notifyStaffSettingsUpdated();
                            setMessage("직원이 비활성화되었습니다.");
                          } catch (err) {
                            console.error(err);
                            setError(getErrorMessage(err));
                          } finally {
                            setSaving(false);
                          }
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {activeTab === "invoice" && (
          <section className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
            <SectionHeader
              title="인보이스 설정"
              description="인보이스 대분류, 수술항목/가격, 안내사항, 제목 템플릿을 관리합니다. 삭제는 기존 인보이스 보존을 위해 비활성화로 처리됩니다."
              badge={canManageSettings ? "수정 가능" : "보기 전용"}
              badgeActive={canManageSettings}
            />

            <div className="mb-5 flex flex-wrap gap-2">
              {INVOICE_TAB_ITEMS.map((tab) => {
                const active = activeInvoiceTab === tab.key;

                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveInvoiceTab(tab.key)}
                    className={`rounded-xl px-4 py-2 text-sm transition active:scale-95 ${
                      active
                        ? "bg-black font-semibold text-white"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}

              <button
                onClick={loadInvoiceSettings}
                className="ml-auto rounded-xl border border-[#dfe3e8] bg-white px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50 active:scale-95"
              >
                새로고침
              </button>
            </div>

            {invoiceLoading ? (
              <EmptyBox text="인보이스 설정을 불러오는 중..." />
            ) : (
              <>
                {activeInvoiceTab === "categories" && (
                  <InvoiceCategoriesPanel
                    categories={invoiceCategories}
                    canManage={canManageSettings}
                    saving={saving}
                    onSave={(payload) =>
                      runInvoiceAction(
                        () => saveInvoiceCategory(payload, currentUser!),
                        "인보이스 대분류가 저장되었습니다."
                      )
                    }
                    onDeactivate={(categoryId) =>
                      runInvoiceAction(
                        () => deactivateInvoiceCategory(categoryId, currentUser!),
                        "인보이스 대분류가 비활성화되었습니다."
                      )
                    }
                  />
                )}

                {activeInvoiceTab === "items" && (
                  <InvoiceItemsPanel
                    categories={invoiceCategories}
                    items={invoiceItems}
                    canManage={canManageSettings}
                    saving={saving}
                    onSave={(payload) =>
                      runInvoiceAction(
                        () => saveInvoiceItem(payload, currentUser!),
                        "인보이스 수술항목이 저장되었습니다."
                      )
                    }
                    onDeactivate={(itemId) =>
                      runInvoiceAction(
                        () => deactivateInvoiceItem(itemId, currentUser!),
                        "인보이스 수술항목이 비활성화되었습니다."
                      )
                    }
                  />
                )}

                {activeInvoiceTab === "sections" && (
                  <InvoiceSectionsPanel
                    sections={invoiceSections}
                    canManage={canManageSettings}
                    saving={saving}
                    onSave={(payload) =>
                      runInvoiceAction(
                        () => saveInvoiceTemplateSection(payload, currentUser!),
                        "인보이스 안내사항이 저장되었습니다."
                      )
                    }
                    onDeactivate={(sectionId) =>
                      runInvoiceAction(
                        () =>
                          deactivateInvoiceTemplateSection(
                            sectionId,
                            currentUser!
                          ),
                        "인보이스 안내사항이 비활성화되었습니다."
                      )
                    }
                  />
                )}

                {activeInvoiceTab === "templates" && (
                  <InvoiceTemplatesPanel
                    templates={invoiceTemplates}
                    canManage={canManageSettings}
                    saving={saving}
                    onSave={(payload) =>
                      runInvoiceAction(
                        () => saveInvoiceTemplate(payload, currentUser!),
                        "인보이스 템플릿이 저장되었습니다."
                      )
                    }
                    onDeactivate={(templateId) =>
                      runInvoiceAction(
                        () =>
                          deactivateInvoiceTemplate(templateId, currentUser!),
                        "인보이스 템플릿이 비활성화되었습니다."
                      )
                    }
                  />
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "security" && (
          <section className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
            <SectionHeader
              title="보안"
              description="현재 로그인 계정의 비밀번호를 변경합니다."
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-gray-500">
                  현재 비밀번호
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="h-11 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-500">
                  새 비밀번호
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-11 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100"
                />
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[#edf0f3] bg-gray-50 p-4 text-sm text-gray-500">
              Firebase Auth 기준으로 재인증 후 비밀번호를 변경합니다. 새
              비밀번호는 최소 6자 이상이어야 합니다.
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={handleChangePassword}
                disabled={saving}
                className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "변경 중..." : "비밀번호 변경"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function InvoiceCategoriesPanel({
  categories,
  canManage,
  saving,
  onSave,
  onDeactivate,
}: {
  categories: InvoiceCategory[];
  canManage: boolean;
  saving: boolean;
  onSave: (payload: {
    categoryId?: string;
    nameKo: string;
    nameEn?: string;
    nameLocal?: string;
    active?: boolean;
    sortOrder?: number;
  }) => void;
  onDeactivate: (categoryId: string) => void;
}) {
  const [form, setForm] = useState({
    categoryId: "",
    nameKo: "",
    nameEn: "",
    nameLocal: "",
    sortOrder: 999999,
    active: true,
  });

  function fill(item: InvoiceCategory) {
    setForm({
      categoryId: item.categoryId,
      nameKo: item.nameKo,
      nameEn: item.nameEn,
      nameLocal: item.nameLocal,
      sortOrder: item.sortOrder,
      active: item.active,
    });
  }

  function reset() {
    setForm({
      categoryId: "",
      nameKo: "",
      nameEn: "",
      nameLocal: "",
      sortOrder: 999999,
      active: true,
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-4">
        <div className="mb-3 text-sm font-bold text-gray-900">
          대분류 추가 / 수정
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <InputField
            label="대분류 ID"
            value={form.categoryId}
            disabled={!!form.categoryId || !canManage || saving}
            placeholder="breast"
            onChange={(value) => setForm((prev) => ({ ...prev, categoryId: value }))}
          />
          <InputField
            label="한국어 대분류명"
            value={form.nameKo}
            disabled={!canManage || saving}
            placeholder="가슴 수술"
            onChange={(value) => setForm((prev) => ({ ...prev, nameKo: value }))}
          />
          <InputField
            label="영어 대분류명"
            value={form.nameEn}
            disabled={!canManage || saving}
            placeholder="Breast Surgery"
            onChange={(value) => setForm((prev) => ({ ...prev, nameEn: value }))}
          />
          <InputField
            label="현지어 대분류명"
            value={form.nameLocal}
            disabled={!canManage || saving}
            placeholder="Хөхний мэс засал"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, nameLocal: value }))
            }
          />
          <InputField
            label="정렬순서"
            type="number"
            value={String(form.sortOrder)}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, sortOrder: Number(value || 999999) }))
            }
          />

          <label className="flex items-center gap-2 pt-6 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              disabled={!canManage || saving}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, active: e.target.checked }))
              }
            />
            사용
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={reset}
            className="rounded-xl border border-[#dfe3e8] bg-white px-4 py-2 text-sm"
          >
            새 항목
          </button>
          <button
            disabled={!canManage || saving}
            onClick={() => onSave(form)}
            className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            저장
          </button>
        </div>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>한국어</Th>
            <Th>영어</Th>
            <Th>현지어</Th>
            <Th>순서</Th>
            <Th>상태</Th>
            <Th>관리</Th>
          </tr>
        </thead>
        <tbody>
          {categories.length === 0 ? (
            <EmptyTableRow colSpan={7} text="등록된 대분류가 없습니다." />
          ) : (
            categories.map((item) => (
              <tr key={item.id}>
                <Td>{item.categoryId}</Td>
                <Td>{item.nameKo}</Td>
                <Td>{item.nameEn || "-"}</Td>
                <Td>{item.nameLocal || "-"}</Td>
                <Td>{item.sortOrder}</Td>
                <Td>{item.active ? "사용" : "비활성"}</Td>
                <Td>
                  <div className="flex gap-2">
                    <SmallButton onClick={() => fill(item)}>수정</SmallButton>
                    <SmallDangerButton
                      disabled={!canManage || saving || !item.active}
                      onClick={() => onDeactivate(item.categoryId)}
                    >
                      비활성화
                    </SmallDangerButton>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>
    </div>
  );
}

function InvoiceItemsPanel({
  categories,
  items,
  canManage,
  saving,
  onSave,
  onDeactivate,
}: {
  categories: InvoiceCategory[];
  items: InvoiceItem[];
  canManage: boolean;
  saving: boolean;
  onSave: (payload: any) => void;
  onDeactivate: (itemId: string) => void;
}) {
  const activeCategories = categories.filter((item) => item.active);

  const [form, setForm] = useState({
    itemId: "",
    categoryId: activeCategories[0]?.categoryId || "",
    nameKo: "",
    nameEn: "",
    nameLocal: "",
    regularPrice: 0,
    eventPrice: 0,
    costPrice: 0,
    currency: "KRW",
    sortOrder: 999999,
    active: true,
    memo: "",
  });

  useEffect(() => {
    if (!form.categoryId && activeCategories[0]?.categoryId) {
      setForm((prev) => ({ ...prev, categoryId: activeCategories[0].categoryId }));
    }
  }, [activeCategories, form.categoryId]);

  const selectedCategory = categories.find(
    (item) => item.categoryId === form.categoryId
  );

  function fill(item: InvoiceItem) {
    setForm({
      itemId: item.itemId,
      categoryId: item.categoryId,
      nameKo: item.nameKo,
      nameEn: item.nameEn,
      nameLocal: item.nameLocal,
      regularPrice: item.regularPrice,
      eventPrice: item.eventPrice,
      costPrice: item.costPrice,
      currency: item.currency || "KRW",
      sortOrder: item.sortOrder,
      active: item.active,
      memo: item.memo || "",
    });
  }

  function reset() {
    setForm({
      itemId: "",
      categoryId: activeCategories[0]?.categoryId || "",
      nameKo: "",
      nameEn: "",
      nameLocal: "",
      regularPrice: 0,
      eventPrice: 0,
      costPrice: 0,
      currency: "KRW",
      sortOrder: 999999,
      active: true,
      memo: "",
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-4">
        <div className="mb-3 text-sm font-bold text-gray-900">
          수술항목 / 가격 추가 · 수정
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-gray-500">대분류</label>
            <select
              value={form.categoryId}
              disabled={!canManage || saving}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, categoryId: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm"
            >
              {activeCategories.map((category) => (
                <option key={category.categoryId} value={category.categoryId}>
                  {category.nameKo}
                </option>
              ))}
            </select>
          </div>

          <InputField
            label="항목 ID"
            value={form.itemId}
            disabled={!!form.itemId || !canManage || saving}
            placeholder="breast_motiva"
            onChange={(value) => setForm((prev) => ({ ...prev, itemId: value }))}
          />

          <InputField
            label="한국어 항목명"
            value={form.nameKo}
            disabled={!canManage || saving}
            placeholder="모티바"
            onChange={(value) => setForm((prev) => ({ ...prev, nameKo: value }))}
          />

          <InputField
            label="영어 항목명"
            value={form.nameEn}
            disabled={!canManage || saving}
            placeholder="Motiva"
            onChange={(value) => setForm((prev) => ({ ...prev, nameEn: value }))}
          />

          <InputField
            label="현지어 항목명"
            value={form.nameLocal}
            disabled={!canManage || saving}
            placeholder="Мотива"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, nameLocal: value }))
            }
          />

          <div>
            <label className="mb-1 block text-xs text-gray-500">통화</label>
            <select
              value={form.currency}
              disabled={!canManage || saving}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, currency: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm"
            >
              {CURRENCY_LIST.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>

          <InputField
            label="정가"
            type="number"
            value={String(form.regularPrice)}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, regularPrice: Number(value || 0) }))
            }
          />

          <InputField
            label="이벤트가"
            type="number"
            value={String(form.eventPrice)}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, eventPrice: Number(value || 0) }))
            }
          />

          <InputField
            label="원가"
            type="number"
            value={String(form.costPrice)}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, costPrice: Number(value || 0) }))
            }
          />

          <InputField
            label="정렬순서"
            type="number"
            value={String(form.sortOrder)}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, sortOrder: Number(value || 999999) }))
            }
          />
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs text-gray-500">메모</label>
          <textarea
            value={form.memo}
            disabled={!canManage || saving}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, memo: e.target.value }))
            }
            className="w-full resize-none rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm"
            rows={2}
            placeholder="내부 참고 메모"
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              disabled={!canManage || saving}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, active: e.target.checked }))
              }
            />
            사용
          </label>

          <div className="flex gap-2">
            <button
              onClick={reset}
              className="rounded-xl border border-[#dfe3e8] bg-white px-4 py-2 text-sm"
            >
              새 항목
            </button>
            <button
              disabled={!canManage || saving}
              onClick={() =>
                onSave({
                  ...form,
                  categoryKo: selectedCategory?.nameKo || "",
                  categoryLocal: selectedCategory?.nameLocal || "",
                })
              }
              className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </div>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>대분류</Th>
            <Th>항목명</Th>
            <Th>영문</Th>
            <Th>현지어</Th>
            <Th>정가</Th>
            <Th>이벤트가</Th>
            <Th>순서</Th>
            <Th>상태</Th>
            <Th>관리</Th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <EmptyTableRow colSpan={9} text="등록된 수술항목이 없습니다." />
          ) : (
            items.map((item) => (
              <tr key={item.id}>
                <Td>{item.categoryKo || item.categoryId}</Td>
                <Td>{item.nameKo}</Td>
                <Td>{item.nameEn || "-"}</Td>
                <Td>{item.nameLocal || "-"}</Td>
                <Td>{formatPrice(item.regularPrice)} {item.currency}</Td>
                <Td>{formatPrice(item.eventPrice)} {item.currency}</Td>
                <Td>{item.sortOrder}</Td>
                <Td>{item.active ? "사용" : "비활성"}</Td>
                <Td>
                  <div className="flex gap-2">
                    <SmallButton onClick={() => fill(item)}>수정</SmallButton>
                    <SmallDangerButton
                      disabled={!canManage || saving || !item.active}
                      onClick={() => onDeactivate(item.itemId)}
                    >
                      비활성화
                    </SmallDangerButton>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>
    </div>
  );
}

function InvoiceSectionsPanel({
  sections,
  canManage,
  saving,
  onSave,
  onDeactivate,
}: {
  sections: InvoiceTemplateSection[];
  canManage: boolean;
  saving: boolean;
  onSave: (payload: any) => void;
  onDeactivate: (sectionId: string) => void;
}) {
  const [form, setForm] = useState({
    sectionId: "",
    titleKo: "",
    titleEn: "",
    titleLocal: "",
    contentKo: "",
    contentEn: "",
    contentLocal: "",
    sortOrder: 999999,
    active: true,
  });

  function fill(item: InvoiceTemplateSection) {
    setForm({
      sectionId: item.sectionId,
      titleKo: item.titleKo,
      titleEn: item.titleEn,
      titleLocal: item.titleLocal,
      contentKo: item.contentKo,
      contentEn: item.contentEn,
      contentLocal: item.contentLocal,
      sortOrder: item.sortOrder,
      active: item.active,
    });
  }

  function reset() {
    setForm({
      sectionId: "",
      titleKo: "",
      titleEn: "",
      titleLocal: "",
      contentKo: "",
      contentEn: "",
      contentLocal: "",
      sortOrder: 999999,
      active: true,
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-4">
        <div className="mb-3 text-sm font-bold text-gray-900">
          안내사항 추가 / 수정
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <InputField
            label="안내사항 ID"
            value={form.sectionId}
            disabled={!!form.sectionId || !canManage || saving}
            placeholder="payment_notice"
            onChange={(value) => setForm((prev) => ({ ...prev, sectionId: value }))}
          />
          <InputField
            label="한국어 제목"
            value={form.titleKo}
            disabled={!canManage || saving}
            placeholder="결제 안내"
            onChange={(value) => setForm((prev) => ({ ...prev, titleKo: value }))}
          />
          <InputField
            label="영어 제목"
            value={form.titleEn}
            disabled={!canManage || saving}
            placeholder="Payment Notice"
            onChange={(value) => setForm((prev) => ({ ...prev, titleEn: value }))}
          />
          <InputField
            label="현지어 제목"
            value={form.titleLocal}
            disabled={!canManage || saving}
            placeholder="Төлбөрийн мэдээлэл"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, titleLocal: value }))
            }
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3">
          <TextareaField
            label="한국어 내용"
            value={form.contentKo}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, contentKo: value }))
            }
          />
          <TextareaField
            label="영어 내용"
            value={form.contentEn}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, contentEn: value }))
            }
          />
          <TextareaField
            label="현지어 내용"
            value={form.contentLocal}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, contentLocal: value }))
            }
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <InputField
            label="정렬순서"
            type="number"
            value={String(form.sortOrder)}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, sortOrder: Number(value || 999999) }))
            }
          />

          <label className="flex items-center gap-2 pt-6 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              disabled={!canManage || saving}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, active: e.target.checked }))
              }
            />
            사용
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={reset}
            className="rounded-xl border border-[#dfe3e8] bg-white px-4 py-2 text-sm"
          >
            새 항목
          </button>
          <button
            disabled={!canManage || saving}
            onClick={() => onSave(form)}
            className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            저장
          </button>
        </div>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>제목</Th>
            <Th>영문</Th>
            <Th>현지어</Th>
            <Th>순서</Th>
            <Th>상태</Th>
            <Th>관리</Th>
          </tr>
        </thead>
        <tbody>
          {sections.length === 0 ? (
            <EmptyTableRow colSpan={7} text="등록된 안내사항이 없습니다." />
          ) : (
            sections.map((item) => (
              <tr key={item.id}>
                <Td>{item.sectionId}</Td>
                <Td>{item.titleKo}</Td>
                <Td>{item.titleEn || "-"}</Td>
                <Td>{item.titleLocal || "-"}</Td>
                <Td>{item.sortOrder}</Td>
                <Td>{item.active ? "사용" : "비활성"}</Td>
                <Td>
                  <div className="flex gap-2">
                    <SmallButton onClick={() => fill(item)}>수정</SmallButton>
                    <SmallDangerButton
                      disabled={!canManage || saving || !item.active}
                      onClick={() => onDeactivate(item.sectionId)}
                    >
                      비활성화
                    </SmallDangerButton>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>
    </div>
  );
}

function InvoiceTemplatesPanel({
  templates,
  canManage,
  saving,
  onSave,
  onDeactivate,
}: {
  templates: InvoiceTemplate[];
  canManage: boolean;
  saving: boolean;
  onSave: (payload: any) => void;
  onDeactivate: (templateId: string) => void;
}) {
  const [form, setForm] = useState({
    templateId: "",
    titleKo: "",
    titleEn: "",
    titleLocal: "",
    hospitalNameKo: "아크성형외과",
    hospitalNameEn: "ARC Plastic Surgery",
    hospitalNameLocal: "",
    footerKo: "",
    footerEn: "",
    footerLocal: "",
    language: "mn",
    sortOrder: 999999,
    active: true,
  });

  function fill(item: InvoiceTemplate) {
    setForm({
      templateId: item.templateId,
      titleKo: item.titleKo,
      titleEn: item.titleEn,
      titleLocal: item.titleLocal,
      hospitalNameKo: item.hospitalNameKo,
      hospitalNameEn: item.hospitalNameEn,
      hospitalNameLocal: item.hospitalNameLocal,
      footerKo: item.footerKo,
      footerEn: item.footerEn,
      footerLocal: item.footerLocal,
      language: item.language,
      sortOrder: item.sortOrder,
      active: item.active,
    });
  }

  function reset() {
    setForm({
      templateId: "",
      titleKo: "",
      titleEn: "",
      titleLocal: "",
      hospitalNameKo: "아크성형외과",
      hospitalNameEn: "ARC Plastic Surgery",
      hospitalNameLocal: "",
      footerKo: "",
      footerEn: "",
      footerLocal: "",
      language: "mn",
      sortOrder: 999999,
      active: true,
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-4">
        <div className="mb-3 text-sm font-bold text-gray-900">
          인보이스 제목 / 템플릿 추가 · 수정
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <InputField
            label="템플릿 ID"
            value={form.templateId}
            disabled={!!form.templateId || !canManage || saving}
            placeholder="default_mn"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, templateId: value }))
            }
          />
          <InputField
            label="언어"
            value={form.language}
            disabled={!canManage || saving}
            placeholder="mn"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, language: value }))
            }
          />
          <InputField
            label="한국어 제목"
            value={form.titleKo}
            disabled={!canManage || saving}
            placeholder="수술 견적서"
            onChange={(value) => setForm((prev) => ({ ...prev, titleKo: value }))}
          />
          <InputField
            label="영어 제목"
            value={form.titleEn}
            disabled={!canManage || saving}
            placeholder="Surgery Quotation"
            onChange={(value) => setForm((prev) => ({ ...prev, titleEn: value }))}
          />
          <InputField
            label="현지어 제목"
            value={form.titleLocal}
            disabled={!canManage || saving}
            placeholder="Мэс заслын үнийн санал"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, titleLocal: value }))
            }
          />
          <InputField
            label="정렬순서"
            type="number"
            value={String(form.sortOrder)}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, sortOrder: Number(value || 999999) }))
            }
          />
          <InputField
            label="병원명 한국어"
            value={form.hospitalNameKo}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, hospitalNameKo: value }))
            }
          />
          <InputField
            label="병원명 영어"
            value={form.hospitalNameEn}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, hospitalNameEn: value }))
            }
          />
          <InputField
            label="병원명 현지어"
            value={form.hospitalNameLocal}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, hospitalNameLocal: value }))
            }
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3">
          <TextareaField
            label="하단 문구 한국어"
            value={form.footerKo}
            disabled={!canManage || saving}
            onChange={(value) => setForm((prev) => ({ ...prev, footerKo: value }))}
          />
          <TextareaField
            label="하단 문구 영어"
            value={form.footerEn}
            disabled={!canManage || saving}
            onChange={(value) => setForm((prev) => ({ ...prev, footerEn: value }))}
          />
          <TextareaField
            label="하단 문구 현지어"
            value={form.footerLocal}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, footerLocal: value }))
            }
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              disabled={!canManage || saving}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, active: e.target.checked }))
              }
            />
            사용
          </label>

          <div className="flex gap-2">
            <button
              onClick={reset}
              className="rounded-xl border border-[#dfe3e8] bg-white px-4 py-2 text-sm"
            >
              새 항목
            </button>
            <button
              disabled={!canManage || saving}
              onClick={() => onSave(form)}
              className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </div>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>언어</Th>
            <Th>제목</Th>
            <Th>병원명</Th>
            <Th>순서</Th>
            <Th>상태</Th>
            <Th>관리</Th>
          </tr>
        </thead>
        <tbody>
          {templates.length === 0 ? (
            <EmptyTableRow colSpan={7} text="등록된 템플릿이 없습니다." />
          ) : (
            templates.map((item) => (
              <tr key={item.id}>
                <Td>{item.templateId}</Td>
                <Td>{item.language}</Td>
                <Td>{item.titleKo}</Td>
                <Td>{item.hospitalNameKo || "-"}</Td>
                <Td>{item.sortOrder}</Td>
                <Td>{item.active ? "사용" : "비활성"}</Td>
                <Td>
                  <div className="flex gap-2">
                    <SmallButton onClick={() => fill(item)}>수정</SmallButton>
                    <SmallDangerButton
                      disabled={!canManage || saving || !item.active}
                      onClick={() => onDeactivate(item.templateId)}
                    >
                      비활성화
                    </SmallDangerButton>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  badge,
  badgeActive,
}: {
  title: string;
  description: string;
  badge?: string;
  badgeActive?: boolean;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-gray-500">{description}</p>
      </div>

      {badge && (
        <span
          className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${
            badgeActive
              ? "bg-emerald-50 text-emerald-700"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function GlobalAlert({
  error,
  message,
}: {
  error: string;
  message: string;
}) {
  if (!error && !message) return null;

  return (
    <div className="mb-4">
      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {message && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      )}
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-8 text-center text-sm text-gray-400">
      {text}
    </div>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[#edf0f3]">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap border-b border-[#edf0f3] bg-gray-50 px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="whitespace-nowrap border-b border-[#f1f3f5] px-3 py-3 text-gray-700">
      {children}
    </td>
  );
}

function EmptyTableRow({
  colSpan,
  text,
}: {
  colSpan: number;
  text: string;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="py-10 text-center text-sm text-gray-400"
      >
        {text}
      </td>
    </tr>
  );
}

function SmallButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-200 active:scale-95"
    >
      {children}
    </button>
  );
}

function SmallDangerButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">{label}</label>
      <input
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100 disabled:bg-gray-50 disabled:text-gray-400"
      />
    </div>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">{label}</label>
      <textarea
        rows={3}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-none rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#1d9e75] focus:ring-4 focus:ring-emerald-100 disabled:bg-gray-50 disabled:text-gray-400"
      />
    </div>
  );
}

function StaffRow({
  item,
  currentUser,
  canManage,
  saving,
  onSave,
  onDeactivate,
}: {
  item: SettingsStaffRecord;
  currentUser: StaffUser | null;
  canManage: boolean;
  saving: boolean;
  onSave: (payload: {
    displayName: string;
    role: SettingsStaffRole | string;
    active: boolean;
    orderNo: number;
  }) => Promise<void>;
  onDeactivate: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(item.displayName);
  const [role, setRole] = useState<SettingsStaffRole | string>(item.role);
  const [active, setActive] = useState(item.active);
  const [orderNo, setOrderNo] = useState(Number(item.orderNo || 999999));

  useEffect(() => {
    setDisplayName(item.displayName);
    setRole(item.role);
    setActive(item.active);
    setOrderNo(Number(item.orderNo || 999999));
  }, [item]);

  const isMe = currentUser?.uid === item.uid || currentUser?.uid === item.id;

  return (
    <tr>
      <Td>
        <input
          value={displayName}
          disabled={!canManage || saving}
          onChange={(e) => setDisplayName(e.target.value)}
          className="h-9 w-[130px] rounded-lg border border-[#dfe3e8] bg-white px-2 text-sm outline-none disabled:bg-gray-50 disabled:text-gray-400"
        />
      </Td>

      <Td>{item.email || "-"}</Td>

      <Td>
        <select
          value={role}
          disabled={!canManage || saving}
          onChange={(e) => setRole(e.target.value as SettingsStaffRole)}
          className="h-9 rounded-lg border border-[#dfe3e8] bg-white px-2 text-sm outline-none disabled:bg-gray-50 disabled:text-gray-400"
        >
          {STAFF_ROLES.map((roleItem) => (
            <option key={roleItem} value={roleItem}>
              {roleItem}
            </option>
          ))}
        </select>
      </Td>

      <Td>
        <input
          type="number"
          value={orderNo}
          disabled={!canManage || saving}
          onChange={(e) => setOrderNo(Number(e.target.value || 999999))}
          className="h-9 w-[80px] rounded-lg border border-[#dfe3e8] bg-white px-2 text-sm outline-none disabled:bg-gray-50 disabled:text-gray-400"
        />
      </Td>

      <Td>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            disabled={!canManage || saving || isMe}
            onChange={(e) => setActive(e.target.checked)}
          />
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              active
                ? "bg-emerald-50 text-emerald-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {active ? "활성" : "비활성"}
          </span>
        </label>
      </Td>

      <Td>
        <div className="flex gap-2">
          <button
            disabled={!canManage || saving}
            onClick={() =>
              onSave({
                displayName,
                role,
                active,
                orderNo,
              })
            }
            className="rounded-lg bg-black px-3 py-2 text-xs font-medium text-white transition hover:-translate-y-0.5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            저장
          </button>

          <button
            disabled={!canManage || saving || !active || isMe}
            onClick={onDeactivate}
            className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            비활성화
          </button>
        </div>
      </Td>
    </tr>
  );
}
