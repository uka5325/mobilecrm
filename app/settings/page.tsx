"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  DEFAULT_VISIT_STATUS_COLORS,
  getVisitStatusColors,
  resetVisitStatusColors,
  saveVisitStatusColors,
  VISIT_STATUS_LIST,
  type VisitStatus,
  type VisitStatusColorMap,
} from "@/lib/settings";
import { getStaffByUid, listenCurrentUser } from "@/lib/auth";
import type { StaffUser } from "@/lib/auth";

type SettingsTab = "statusColors" | "system" | "memo" | "staff" | "security";

const TAB_ITEMS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: "statusColors", label: "내원상태 색상", icon: "🎨" },
  { key: "system", label: "기본 설정", icon: "🌐" },
  { key: "memo", label: "오늘의 메모", icon: "📝" },
  { key: "staff", label: "직원 관리", icon: "👥" },
  { key: "security", label: "보안", icon: "🔐" },
];

const STATUS_HELP: Record<VisitStatus, string> = {
  내원전: "아직 방문 전인 예약",
  대기: "내원 후 대기 중인 고객",
  원상중: "원장 상담 진행 중",
  후상중: "실장/후상담 진행 중",
  귀가: "상담 또는 진료 종료",
  부도: "예약 후 미방문",
};

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

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("statusColors");

  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [colors, setColors] = useState<VisitStatusColorMap>(
    DEFAULT_VISIT_STATUS_COLORS
  );
  const [initialColors, setInitialColors] = useState<VisitStatusColorMap>(
    DEFAULT_VISIT_STATUS_COLORS
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canManageSettings = useMemo(() => {
    const role = String(currentUser?.role || "").toLowerCase();

    return role === "admin" || role === "doctor";
  }, [currentUser]);

  const hasChanges = useMemo(() => {
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

  async function loadSettings() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const loadedColors = await getVisitStatusColors();

      setColors(loadedColors);
      setInitialColors(loadedColors);
    } catch (err) {
      console.error(err);
      setError("설정 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

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

    if (!canManageSettings) {
      setError("설정 변경 권한이 없습니다. admin 또는 doctor만 변경할 수 있습니다.");
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
    setError("");
    setMessage("");

    try {
      const savedColors = await saveVisitStatusColors(colors, currentUser);

      setColors(savedColors);
      setInitialColors(savedColors);
      setMessage("내원상태 색상이 저장되었습니다.");
    } catch (err) {
      console.error(err);
      setError("색상 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetColors() {
    if (!currentUser) {
      setError("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    if (!canManageSettings) {
      setError("설정 변경 권한이 없습니다. admin 또는 doctor만 변경할 수 있습니다.");
      return;
    }

    const ok = confirm("내원상태 색상을 기본값으로 되돌릴까요?");

    if (!ok) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const resetColors = await resetVisitStatusColors(currentUser);

      setColors(resetColors);
      setInitialColors(resetColors);
      setMessage("기본 색상으로 복원되었습니다.");
    } catch (err) {
      console.error(err);
      setError("기본값 복원 중 오류가 발생했습니다.");
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
                onClick={() => setActiveTab(item.key)}
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
        {activeTab === "statusColors" && (
          <section className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  내원상태 색상 설정
                </h2>
                <p className="mt-1 text-sm leading-6 text-gray-500">
                  타임라인 고객 카드, 예약관리 상태 배지, 대시보드 상태 표시 색상에
                  공통으로 사용할 수 있는 기준 색상입니다.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    canManageSettings
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {authLoading
                    ? "권한 확인 중"
                    : canManageSettings
                      ? "수정 가능"
                      : "보기 전용"}
                </span>
              </div>
            </div>

            {loading ? (
              <div className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-8 text-center text-sm text-gray-400">
                설정을 불러오는 중...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {VISIT_STATUS_LIST.map((status) => {
                    const color = colors[status];
                    const textColor = getReadableTextColor(color);
                    const valid = isValidHex(color);

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
                              backgroundColor: valid
                                ? color
                                : DEFAULT_VISIT_STATUS_COLORS[status],
                              color: valid
                                ? textColor
                                : getReadableTextColor(
                                    DEFAULT_VISIT_STATUS_COLORS[status]
                                  ),
                            }}
                          >
                            {status}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={
                              valid ? color : DEFAULT_VISIT_STATUS_COLORS[status]
                            }
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

                {error && (
                  <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {error}
                  </div>
                )}

                {message && (
                  <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {message}
                  </div>
                )}

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
                    disabled={!canManageSettings || saving || !hasChanges}
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
          <ComingSoonPanel
            title="기본 설정"
            description="상담회 국가, 시간대, 기본 날짜 기준을 관리하는 영역입니다."
            items={[
              "상담회 국가 / 시간대 설정",
              "로그 저장 시간 기준",
              "기본 조회 날짜 설정",
            ]}
          />
        )}

        {activeTab === "memo" && (
          <ComingSoonPanel
            title="오늘의 메모"
            description="홈과 타임라인에 표시되는 날짜별 운영 메모를 관리하는 영역입니다."
            items={[
              "날짜별 메모 추가",
              "메모 삭제",
              "홈 / 타임라인 동시 표시",
            ]}
          />
        )}

        {activeTab === "staff" && (
          <ComingSoonPanel
            title="직원 관리"
            description="직원 계정, 권한, 원장 표시 순서를 관리하는 영역입니다."
            items={[
              "직원 추가 / 비활성화",
              "권한 변경",
              "원장 표시 순서 설정",
            ]}
          />
        )}

        {activeTab === "security" && (
          <ComingSoonPanel
            title="보안"
            description="내 비밀번호 변경과 로그인 보안 설정을 관리하는 영역입니다."
            items={[
              "내 비밀번호 변경",
              "로그인 기록 확인",
              "계정별 접근 권한 점검",
            ]}
          />
        )}
      </div>
    </div>
  );
}

function ComingSoonPanel({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: string[];
}) {
  return (
    <section className="rounded-[18px] border border-[#edf0f3] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.04)]">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-gray-500">{description}</p>
      </div>

      <div className="rounded-2xl border border-dashed border-[#dfe3e8] bg-gray-50 p-5">
        <div className="mb-3 text-sm font-bold text-gray-700">
          다음 단계에서 구현 예정
        </div>

        <ul className="space-y-2 text-sm text-gray-500">
          {items.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
