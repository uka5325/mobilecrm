"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  activateStaffFromSettings,
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
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { todayString } from "@/lib/dateUtils";
import {
  getErrorMessage,
  normalizeHexInput,
  notifyStaffSettingsUpdated,
} from "@/lib/settingsUtils";

export type SettingsTab = "statusColors" | "system" | "memo" | "staff" | "security";

type StaffSavePayload = { displayName: string; role: SettingsStaffRole | string; orderNo: number };
type AddStaffParams = { email: string; password: string; displayName: string; role: SettingsStaffRole; staffCode?: string };

// 설정 페이지의 상태·로딩·저장·새로고침 흐름을 한곳에서 소유하는 컨트롤러.
// 페이지(app/settings/page.tsx)는 JSX 배선만 담당한다.
export function useSettingsPageController() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("statusColors");
  const loadedTabsRef = useRef<Set<SettingsTab>>(new Set());

  // 전역 단일 Provider(CurrentUserProvider)에서 직원 상태를 읽는다 — 자체 onAuthStateChanged/
  // verify-staff 중복 구독 제거, 비활성 직원 처리 일관화(Provider가 안전 로그아웃 담당).
  const { currentUser, authReady } = useCurrentUser();
  const authLoading = !authReady;

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

  async function loadColors() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const loadedColors = await getAppointmentTypeColors();
      setColors(loadedColors);
      setInitialColors(loadedColors);
    } catch (err) {
      loadedTabsRef.current.delete("statusColors");
      console.error((err as Error)?.message ?? "");
      setError("색상 설정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function loadGeneralSettings() {
    setError("");
    try {
      const loadedGeneral = await getGeneralSettings();
      setGeneralSettings(loadedGeneral);
      setSelectedCountry(loadedGeneral.appCountry);
    } catch (err) {
      loadedTabsRef.current.delete("system");
      console.error((err as Error)?.message ?? "");
      setError("기본 설정을 불러오지 못했습니다.");
    }
  }

  async function loadMemos(date = memoDate) {
    setMemoLoading(true);
    setError("");
    try {
      const list = await getConferenceMemos(date, 50);
      setMemos(list);
    } catch (err) {
      loadedTabsRef.current.delete("memo");
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
      loadedTabsRef.current.delete("staff");
      console.error((err as Error)?.message ?? "");
      setError("직원 목록을 불러오지 못했습니다.");
    } finally {
      setStaffLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || loadedTabsRef.current.has(activeTab)) return;
    if (activeTab === "staff" && !currentUser) return;

    loadedTabsRef.current.add(activeTab);
    if (activeTab === "statusColors") void loadColors();
    else if (activeTab === "system") void loadGeneralSettings();
    else if (activeTab === "memo") void loadMemos(memoDate);
    else if (activeTab === "staff") void loadStaffList();
    // 탭별 loader는 컴포넌트 스코프 함수라 deps에 넣으면 매 렌더 재실행된다.
    // loadedTabsRef가 최초 1회 로드와 실패 후 재시도를 제어한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, activeTab, currentUser]);

  function clearAlerts() {
    setError("");
    setMessage("");
  }

  function selectTab(tab: SettingsTab) {
    setActiveTab(tab);
    clearAlerts();
  }

  function updateColor(type: string, value: string) {
    setColors((prev) => ({ ...prev, [type]: normalizeHexInput(value) }));
  }

  function changeMemoDate(date: string) {
    setMemoDate(date);
    loadMemos(date);
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

  async function saveStaff(staffId: string, payload: StaffSavePayload) {
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
    setSaving(true);
    clearAlerts();
    try {
      await updateStaffFromSettings(staffId, payload, currentUser);
      await loadStaffList();
      notifyStaffSettingsUpdated();
      setMessage("직원 정보가 저장되었습니다.");
    } catch (err) {
      console.error((err as Error)?.message ?? "");
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function deactivateStaff(staffId: string) {
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
    const ok = confirm("이 직원을 비활성화할까요?\n로그인은 차단되지만 기록은 보존됩니다.");
    if (!ok) return;
    setSaving(true);
    clearAlerts();
    try {
      const result = await deactivateStaffFromSettings(staffId, currentUser);
      await loadStaffList();
      notifyStaffSettingsUpdated();
      if (result.tokenRevoked === false) {
        // 부분 성공 — 완전 성공으로 숨기지 않고 재확인이 필요함을 알린다.
        setError("직원은 비활성화됐지만 기존 로그인 토큰 폐기에 실패했습니다. 재확인이 필요합니다.");
      } else {
        setMessage("직원이 비활성화되었습니다.");
      }
    } catch (err) {
      console.error((err as Error)?.message ?? "");
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function activateStaff(staffId: string) {
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
    const ok = confirm("이 직원을 다시 활성화할까요?");
    if (!ok) return;
    setSaving(true);
    clearAlerts();
    try {
      await activateStaffFromSettings(staffId, currentUser);
      await loadStaffList();
      notifyStaffSettingsUpdated();
      setMessage("직원이 활성화되었습니다.");
    } catch (err) {
      console.error((err as Error)?.message ?? "");
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function addStaff(params: AddStaffParams) {
    if (!currentUser) { setError("로그인 정보를 확인할 수 없습니다."); return; }
    await createStaffFromSettings(params, currentUser);
    await loadStaffList();
    setMessage("직원 계정이 추가되었습니다.");
  }

  return {
    // 탭/사용자
    activeTab,
    selectTab,
    currentUser,
    authLoading,
    canManageSettings,
    canEditMemo,
    // 알림
    error,
    message,
    // 색상
    colors,
    loading,
    hasColorChanges,
    updateColor,
    handleSaveColors,
    handleResetColors,
    // 기본 설정
    generalSettings,
    selectedCountry,
    setSelectedCountry,
    handleSaveGeneralSettings,
    // 메모
    memoDate,
    memoText,
    memos,
    memoLoading,
    setMemoText,
    changeMemoDate,
    handleAddMemo,
    handleDeleteMemo,
    handleUpdateMemo,
    // 직원
    staffList,
    staffLoading,
    showAddStaff,
    setShowAddStaff,
    saveStaff,
    deactivateStaff,
    activateStaff,
    addStaff,
    // 보안
    currentPassword,
    newPassword,
    setCurrentPassword,
    setNewPassword,
    handleChangePassword,
    // 공통
    saving,
  };
}
