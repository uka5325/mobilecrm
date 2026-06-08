"use client";

import { useEffect, useState } from "react";
import type { StaffUser } from "@/lib/auth";
import type { SettingsStaffRecord, SettingsStaffRole } from "@/lib/settings";
import { Td } from "./ui";

const STAFF_ROLES: SettingsStaffRole[] = [
  "admin",
  "doctor",
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
