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
  { key: "statusColors", label: "유형별 색상", icon: "🎨" },
  { key: "system", label: "기본 설정", icon: "🌐" },
  { key: "memo", label: "오늘의 메모", icon: "📝" },
  { key: "staff", label: "직원 관리", icon: "👥" },
  { key: "security", label: "보안", icon: "🔐" },
];

export default function SettingsPage() {
  const s = useSettingsPageController();
  const { currentUser, activeTab, canManageSettings } = s;

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
                onClick={() => s.selectTab(item.key)}
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
                  onClick={() => s.setShowAddStaff(true)}
                  className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
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
