"use client";

import { useState } from "react";
import type { StaffUser } from "@/lib/auth";
import type { SettingsStaffRecord, SettingsStaffRole } from "@/lib/settings";
import { Td } from "./ui";

const STAFF_ROLES: SettingsStaffRole[] = [
  "admin",
  "coordinator",
  "staff",
  "interpreter",
];

export function StaffRow({
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
  // key={staff.id}(부모 app/settings/page.tsx)로 직원마다 컴포넌트가 분리돼 있으므로
  // 아래 초기값은 "다른 직원으로 바뀔 때"만 다시 잡힌다. 과거엔 [item] 변화마다
  // 로컬 편집값을 서버값으로 재동기화하는 effect가 있었는데, 다른 직원을 저장하면
  // 부모가 staffList 전체를 새 배열/새 객체로 교체해 이 행의 item도 참조만 바뀌면서
  // 편집 중이던(아직 저장 안 한) 값이 조용히 원래 값으로 되돌아가는 버그가 있었다.
  const [displayName, setDisplayName] = useState(item.displayName);
  const [role, setRole] = useState<SettingsStaffRole | string>(item.role);
  const [active, setActive] = useState(item.active);
  const [orderNo, setOrderNo] = useState(Number(item.orderNo || 999999));

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
