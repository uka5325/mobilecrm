"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  addConferenceMemo,
  changeMyPassword,
  DEFAULT_APPOINTMENT_TYPE_COLORS,
  DEFAULT_GENERAL_SETTINGS,
  deactivateStaffFromSettings,
  deleteConferenceMemo,
  updateConferenceMemo,
  getAppointmentTypeColors,
  getConferenceMemos,
  getGeneralSettings,
  getStaffListForSettings,
  resetAppointmentTypeColors,
  saveAppointmentTypeColors,
  saveGeneralSettings,
  updateStaffFromSettings,
  createStaffFromSettings,
  type AppointmentTypeColorMap,
  type ConferenceMemo,
  type CountryKey,
  type GeneralSettings,
  type SettingsStaffRecord,
  type SettingsStaffRole,
} from "@/lib/settings";
import { getStaffByUid, listenCurrentUser } from "@/lib/auth";
import type { StaffUser } from "@/lib/auth";
import { todayString } from "@/lib/dateUtils";
import {
  getErrorMessage,
  normalizeHexInput,
  notifyStaffSettingsUpdated,
} from "@/lib/settingsUtils";
import { GlobalAlert, EmptyBox, SectionHeader, Th } from "@/components/settings/ui";
import { StaffRow } from "@/components/settings/StaffRow";
import { AddStaffModal } from "@/components/settings/AddStaffModal";
import { StatusColorsPanel } from "@/components/settings/StatusColorsPanel";
import { SystemSettingsPanel } from "@/components/settings/SystemSettingsPanel";
import { MemoPanel } from "@/components/settings/MemoPanel";
import { SecurityPanel } from "@/components/settings/SecurityPanel";

type SettingsTab = "statusColors" | "system" | "memo" | "staff" | "security";

const TAB_ITEMS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: "statusColors", label: "유형별 색상", icon: "🎨" },
  { key: "system", label: "기본 설정", icon: "🌐" },
  { key: "memo", label: "오늘의 메모", icon: "📝" },
  { key: "staff", label: "직원 관리", icon: "👥" },
  { key: "security", label: "보안", icon: "🔐" },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("statusColors");

  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [colors, setColors] = useState<AppointmentTypeColorMap>(DEFAULT_APPOINTMENT_TYPE_COLORS);
  const [initialColors, setInitialColors] = useState<AppointmentTypeColorMap>(DEFAULT_APPOINTMENT_TYPE_COLORS);

  const [generalSettings, setGeneralSettings] = useState<GeneralSettings>(DEFAULT_GENERAL_SETTINGS);
  const [selectedCountry, setSelectedCountry] = useState<CountryKey>("Korea");

  const [memoDate, setMemoDate] = useState(todayString());
  const [memoText, setMemoText] = useState("");
  const [memos, setMemos] = useState<ConferenceMemo[]>([]);

  const [staffList, setStaffList] = useState<SettingsStaffRecord[]>([]);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [loading, setLoading] = useState(true);
  const [memoLoading, setMemoLoading] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canManageSettings = useMemo(() => {
    const role = String(currentUser?.role || "").toLowerCase();
    return role === "admin";
  }, [currentUser]);

  const canEditMemo = useMemo(() => {
    const role = String(currentUser?.role || "").toLowerCase();
    return ["admin", "coordinator", "staff"].includes(role);
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
        console.error((err as Error)?.message ?? "");
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
        getAppointmentTypeColors(),
        getGeneralSettings(),
      ]);
      setColors(loadedColors);
      setInitialColors(loadedColors);
      setGeneralSettings(loadedGeneral);
      setSelectedCountry(loadedGeneral.appCountry);
    } catch (err) {
      console.error((err as Error)?.message ?? "");
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
      console.error((err as Error)?.message ?? "");
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
      console.error((err as Error)?.message ?? "");
      setError("직원 목록을 불러오지 못했습니다.");
    } finally {
      setStaffLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading) return;
    loadBaseSettings();
    loadMemos(todayString());
    if (currentUser) loadStaffList();
  }, [authLoading]);

  function clearAlerts() {
    setError("");
    setMessage("");
  }

  async function handleSaveColors() {
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
    setSaving(true);
    clearAlerts();
    try {
      const savedColors = await saveAppointmentTypeColors(colors, currentUser);
      setColors(savedColors);
      setInitialColors(savedColors);
      setMessage("유형별 색상이 저장되었습니다.");
    } catch (err) {
      console.error((err as Error)?.message ?? "");
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleResetColors() {
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
    const ok = confirm("유형별 색상을 기본값으로 되돌릴까요?");
    if (!ok) return;
    setSaving(true);
    clearAlerts();
    try {
      const resetColors = await resetAppointmentTypeColors(currentUser);
      setColors(resetColors);
      setInitialColors(resetColors);
      setMessage("기본 색상으로 복원되었습니다.");
    } catch (err) {
      console.error((err as Error)?.message ?? "");
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
      console.error((err as Error)?.message ?? "");
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
      console.error((err as Error)?.message ?? "");
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
      console.error((err as Error)?.message ?? "");
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateMemo(memoId: string, newText: string) {
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
    clearAlerts();
    try {
      await updateConferenceMemo(memoId, newText, currentUser, memoDate);
      await loadMemos(memoDate);
      setMessage("메모가 수정되었습니다.");
    } catch (err) {
      console.error((err as Error)?.message ?? "");
      setError(getErrorMessage(err));
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
      console.error((err as Error)?.message ?? "");
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
            if (item.key === "staff" && !canManageSettings) return null;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => { setActiveTab(item.key); clearAlerts(); if (item.key === "memo") loadMemos(memoDate); }}
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
            onUpdateColor={(type: string, value: string) => {
              setColors((prev) => ({ ...prev, [type]: normalizeHexInput(value) }));
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
            onUpdate={handleUpdateMemo}
          />
        )}

        {activeTab === "staff" && (
          <section className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
            <div className="flex items-start justify-between gap-4">
              <SectionHeader
                title="직원 관리"
                description="직원 권한, 활성상태, 표시 순서를 관리합니다."
                badge={canManageSettings ? "수정 가능" : "보기 전용"}
                badgeActive={canManageSettings}
              />
              {currentUser?.role === "admin" && (
                <button
                  onClick={() => setShowAddStaff(true)}
                  className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
                >
                  + 직원 추가
                </button>
              )}
            </div>

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
                            console.error((err as Error)?.message ?? "");
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
                            console.error((err as Error)?.message ?? "");
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

        {showAddStaff && currentUser && (
          <AddStaffModal
            onClose={() => setShowAddStaff(false)}
            onSubmit={async (params) => {
              await createStaffFromSettings(
                params as { email: string; password: string; displayName: string; role: SettingsStaffRole; staffCode?: string },
                currentUser
              );
              await loadStaffList();
              setMessage("직원 계정이 추가되었습니다.");
            }}
          />
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
