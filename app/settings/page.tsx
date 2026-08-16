"use client";

import { GlobalAlert, EmptyBox, SectionHeader, Th } from "@/components/settings/ui";
import { StaffRow } from "@/components/settings/StaffRow";
import { AddStaffModal } from "@/components/settings/AddStaffModal";
import { StatusColorsPanel } from "@/components/settings/StatusColorsPanel";
import { SystemSettingsPanel } from "@/components/settings/SystemSettingsPanel";
import { MemoPanel } from "@/components/settings/MemoPanel";
import { SecurityPanel } from "@/components/settings/SecurityPanel";
import { useSettingsPageController, type SettingsTab } from "@/hooks/useSettingsPageController";

const TAB_ITEMS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: "statusColors", label: "유형별 색상", icon: "색" },
  { key: "system", label: "기본 설정", icon: "기본" },
  { key: "memo", label: "오늘의 메모", icon: "메모" },
  { key: "staff", label: "직원 관리", icon: "직원" },
  { key: "security", label: "보안", icon: "보안" },
];

export default function SettingsPage() {
  const s = useSettingsPageController();
  const { currentUser, activeTab, canManageSettings } = s;

  return (
    <div className="max-w-[1180px] space-y-5">
      <nav className="h-[184px] overflow-hidden rounded-[26px] bg-[#eaf8f3] p-5 shadow-[0_18px_50px_rgba(7,56,58,0.08)] lg:h-[196px] lg:p-6">
        <div className="flex h-full flex-col justify-between">
          <div>
            <div className="text-[11px] font-black tracking-[0.18em] text-[#0f8f83]">SETTINGS</div>
            <p className="mt-2 text-sm font-medium leading-5 text-[#667085]">
              시스템 설정과 운영 기준을 관리합니다.
            </p>
          </div>

          <div className="rounded-[20px] bg-white p-1">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5">
              {TAB_ITEMS.map((item) => {
                if (item.key === "staff" && !canManageSettings) return null;
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => s.selectTab(item.key)}
                    className={`h-10 min-w-0 rounded-[16px] px-2 text-[11px] font-semibold transition active:scale-95 ${
                      active
                        ? "bg-[#e3f2ee] text-[#0f9b8e]"
                        : "text-[#667085] hover:bg-[#f6f7f5] hover:text-[#0f9b8e]"
                    }`}
                  >
                    <span className="block truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </nav>

      <div className="min-w-0">
        <GlobalAlert error={s.error} message={s.message} />

        {activeTab === "statusColors" && (
          <StatusColorsPanel
            colors={s.colors}
            loading={s.loading}
            authLoading={s.authLoading}
            canManage={canManageSettings}
            saving={s.saving}
            hasChanges={s.hasColorChanges}
            onUpdateColor={s.updateColor}
            onSave={s.handleSaveColors}
            onReset={s.handleResetColors}
          />
        )}

        {activeTab === "system" && (
          <SystemSettingsPanel
            generalSettings={s.generalSettings}
            selectedCountry={s.selectedCountry}
            canManage={canManageSettings}
            saving={s.saving}
            onChangeCountry={s.setSelectedCountry}
            onSave={s.handleSaveGeneralSettings}
          />
        )}

        {activeTab === "memo" && (
          <MemoPanel
            memoDate={s.memoDate}
            memoText={s.memoText}
            memos={s.memos}
            memoLoading={s.memoLoading}
            canEdit={s.canEditMemo}
            saving={s.saving}
            onDateChange={s.changeMemoDate}
            onTextChange={s.setMemoText}
            onAdd={s.handleAddMemo}
            onDelete={s.handleDeleteMemo}
            onUpdate={s.handleUpdateMemo}
          />
        )}

        {activeTab === "staff" && (
          <section className="rounded-[28px] bg-white p-5 shadow-[0_16px_50px_rgba(15,23,42,0.055)] lg:p-6">
            <div className="flex items-start justify-between gap-4">
              <SectionHeader
                title="직원 관리"
                description="직원 권한, 활성상태, 표시 순서를 관리합니다."
                badge={canManageSettings ? "수정 가능" : "보기 전용"}
                badgeActive={canManageSettings}
              />
              {currentUser?.role === "admin" && (
                <button
                  onClick={() => s.setShowAddStaff(true)}
                  className="shrink-0 rounded-[18px] bg-[linear-gradient(135deg,#77dfd1_0%,#40c5b3_50%,#0f9b8e_100%)] px-4 py-2 text-sm font-bold text-white shadow-[0_10px_24px_rgba(15,143,131,0.14)] transition hover:-translate-y-0.5 active:scale-95"
                >
                  + 직원 추가
                </button>
              )}
            </div>

            {s.staffLoading ? (
              <EmptyBox text="직원 목록을 불러오는 중..." />
            ) : s.staffList.length === 0 ? (
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
                    {s.staffList.map((staff) => (
                      <StaffRow
                        key={staff.id}
                        item={staff}
                        currentUser={currentUser}
                        canManage={canManageSettings}
                        saving={s.saving}
                        onSave={(payload) => s.saveStaff(staff.id, payload)}
                        onDeactivate={() => s.deactivateStaff(staff.id)}
                        onActivate={() => s.activateStaff(staff.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {s.showAddStaff && currentUser && (
          <AddStaffModal
            onClose={() => s.setShowAddStaff(false)}
            onSubmit={s.addStaff}
          />
        )}

        {activeTab === "security" && (
          <SecurityPanel
            currentPassword={s.currentPassword}
            newPassword={s.newPassword}
            saving={s.saving}
            onCurrentPasswordChange={s.setCurrentPassword}
            onNewPasswordChange={s.setNewPassword}
            onSave={s.handleChangePassword}
          />
        )}
      </div>
    </div>
  );
}
