"use client";

import React from "react";

export function SectionHeader({
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
        <h2 className="text-lg font-black tracking-[-0.03em] text-[#101828]">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-[#667085]">{description}</p>
      </div>

      {badge && (
        <span
          className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${
            badgeActive
              ? "bg-[#e3f2ee] text-[#0f9b8e]"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

export function GlobalAlert({
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
        <div className="rounded-xl border border-emerald-100 bg-[#e3f2ee] px-4 py-3 text-sm text-[#0f9b8e]">
          {message}
        </div>
      )}
    </div>
  );
}

export function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-[24px] bg-[#f8fbfa] p-8 text-center text-sm text-[#8b93a1]">
      {text}
    </div>
  );
}

export function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap bg-[#f8fbfa] px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085]">
      {children}
    </th>
  );
}

export function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="whitespace-nowrap px-3 py-3 text-gray-700">
      {children}
    </td>
  );
}
