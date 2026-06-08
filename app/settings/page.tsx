"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  addConferenceMemo,
  changeMyPassword,
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
  type ConferenceMemo,
  type CountryKey,
  type GeneralSettings,
  type SettingsStaffRecord,
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
  type InvoiceItem,
  type InvoiceTemplate,
  type InvoiceTemplateSection,
} from "@/lib/invoiceSettings";
import { todayString } from "@/lib/dateUtils";
import {
  getErrorMessage,
  normalizeHexInput,
  notifyStaffSettingsUpdated,
} from "@/lib/settingsUtils";
import { GlobalAlert, EmptyBox, SectionHeader, Th } from "@/components/settings/ui";
import { InvoiceCategoriesPanel } from "@/components/settings/InvoiceCategoriesPanel";
import { InvoiceItemsPanel } from "@/components/settings/InvoiceItemsPanel";
import { InvoiceSectionsPanel } from "@/components/settings/InvoiceSectionsPanel";
import { InvoiceTemplatesPanel } from "@/components/settings/InvoiceTemplatesPanel";
import { StaffRow } from "@/components/settings/StaffRow";
import { StatusColorsPanel } from "@/components/settings/StatusColorsPanel";
import { SystemSettingsPanel } from "@/components/settings/SystemSettingsPanel";
import { MemoPanel } from "@/components/settings/MemoPanel";
import { SecurityPanel } from "@/components/settings/SecurityPanel";

type SettingsTab = "statusColors" | "system" | "memo" | "staff" | "invoice" | "security";
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

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("statusColors");
  const [activeInvoiceTab, setActiveInvoiceTab] = useState<InvoiceTab>("categories");

  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [colors, setColors] = useState<VisitStatusColorMap>(DEFAULT_VISIT_STATUS_COLORS);
  const [initialColors, setInitialColors] = useState<VisitStatusColorMap>(DEFAULT_VISIT_STATUS_COLORS);

  const [generalSettings, setGeneralSettings] = useState<GeneralSettings>(DEFAULT_GENERAL_SETTINGS);
  const [selectedCountry, setSelectedCountry] = useState<CountryKey>("Korea");

  const [memoDate, setMemoDate] = useState(todayString());
  const [memoText, setMemoText] = useState("");
  const [memos, setMemos] = useState<ConferenceMemo[]>([]);

  const [staffList, setStaffList] = useState<SettingsStaffRecord[]>([]);

  const [invoiceCategories, setInvoiceCategories] = useState<InvoiceCategory[]>([]);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [invoiceSections, setInvoiceSections] = useState<InvoiceTemplateSection[]>([]);
  const [invoiceTemplates, setInvoiceTemplates] = useState<InvoiceTemplate[]>([]);

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
        if (!user) { setCurrentUser(null); setAuthLoading(false); return; }
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

  async function handleSaveColors() {
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
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
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
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
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
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
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
    if (!memoText.trim()) { setError("메모 내용을 입력하세요."); return; }
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
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
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
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
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

  async function runInvoiceAction(action: () => Promise<unknown>, doneMessage: string) {
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
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
        <div className="mb-3 px-2 text-xs font-bold text-gray-400">SETTINGS</div>

        <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {TAB_ITEMS.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => { setActiveTab(item.key); clearAlerts(); }}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-3 text-left text-sm transition hover:-translate-y-0.5 active:scale-95 lg:w-full ${
                  active ? "bg-emerald-50 font-bold text-emerald-700" : "bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-900"
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
          <StatusColorsPanel
            colors={colors}
            loading={loading}
            authLoading={authLoading}
            canManage={canManageSettings}
            saving={saving}
            hasChanges={hasColorChanges}
            onUpdateColor={(status: VisitStatus, value: string) => {
              setColors((prev) => ({ ...prev, [status]: normalizeHexInput(value) }));
            }}
            onSave={handleSaveColors}
            onReset={handleResetColors}
          />
        )}

        {activeTab === "system" && (
          <SystemSettingsPanel
            generalSettings={generalSettings}
            selectedCountry={selectedCountry}
            canManage={canManageSettings}
            saving={saving}
            onChangeCountry={setSelectedCountry}
            onSave={handleSaveGeneralSettings}
          />
        )}

        {activeTab === "memo" && (
          <MemoPanel
            memoDate={memoDate}
            memoText={memoText}
            memos={memos}
            memoLoading={memoLoading}
            canEdit={canEditMemo}
            saving={saving}
            onDateChange={(date) => { setMemoDate(date); loadMemos(date); }}
            onTextChange={setMemoText}
            onAdd={handleAddMemo}
            onDelete={handleDeleteMemo}
          />
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
                          if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
                          setSaving(true);
                          clearAlerts();
                          try {
                            await updateStaffFromSettings(staff.id, payload, currentUser);
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
                          if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
                          const ok = confirm("이 직원을 비활성화할까요?\n로그인은 차단되지만 기록은 보존됩니다.");
                          if (!ok) return;
                          setSaving(true);
                          clearAlerts();
                          try {
                            await deactivateStaffFromSettings(staff.id, currentUser);
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
                      active ? "bg-black font-semibold text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
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
                    onSave={(payload) => runInvoiceAction(() => saveInvoiceCategory(payload, currentUser!), "인보이스 대분류가 저장되었습니다.")}
                    onDeactivate={(categoryId) => runInvoiceAction(() => deactivateInvoiceCategory(categoryId, currentUser!), "인보이스 대분류가 비활성화되었습니다.")}
                  />
                )}
                {activeInvoiceTab === "items" && (
                  <InvoiceItemsPanel
                    categories={invoiceCategories}
                    items={invoiceItems}
                    canManage={canManageSettings}
                    saving={saving}
                    onSave={(payload) => runInvoiceAction(() => saveInvoiceItem(payload, currentUser!), "인보이스 수술항목이 저장되었습니다.")}
                    onDeactivate={(itemId) => runInvoiceAction(() => deactivateInvoiceItem(itemId, currentUser!), "인보이스 수술항목이 비활성화되었습니다.")}
                  />
                )}
                {activeInvoiceTab === "sections" && (
                  <InvoiceSectionsPanel
                    sections={invoiceSections}
                    canManage={canManageSettings}
                    saving={saving}
                    onSave={(payload) => runInvoiceAction(() => saveInvoiceTemplateSection(payload, currentUser!), "인보이스 안내사항이 저장되었습니다.")}
                    onDeactivate={(sectionId) => runInvoiceAction(() => deactivateInvoiceTemplateSection(sectionId, currentUser!), "인보이스 안내사항이 비활성화되었습니다.")}
                  />
                )}
                {activeInvoiceTab === "templates" && (
                  <InvoiceTemplatesPanel
                    templates={invoiceTemplates}
                    canManage={canManageSettings}
                    saving={saving}
                    onSave={(payload) => runInvoiceAction(() => saveInvoiceTemplate(payload, currentUser!), "인보이스 템플릿이 저장되었습니다.")}
                    onDeactivate={(templateId) => runInvoiceAction(() => deactivateInvoiceTemplate(templateId, currentUser!), "인보이스 템플릿이 비활성화되었습니다.")}
                  />
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "security" && (
          <SecurityPanel
            currentPassword={currentPassword}
            newPassword={newPassword}
            saving={saving}
            onCurrentPasswordChange={setCurrentPassword}
            onNewPasswordChange={setNewPassword}
            onSave={handleChangePassword}
          />
        )}
      </div>
    </div>
  );
}
