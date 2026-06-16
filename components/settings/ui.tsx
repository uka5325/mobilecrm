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
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      )}
    </div>
  );
}

export function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-8 text-center text-sm text-gray-400">
      {text}
    </div>
  );
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[#edf0f3]">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap border-b border-[#edf0f3] bg-gray-50 px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500">
      {children}
    </th>
  );
}

export function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="whitespace-nowrap border-b border-[#f1f3f5] px-3 py-3 text-gray-700">
      {children}
    </td>
  );
}

export function EmptyTableRow({
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

export function SmallButton({
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

export function SmallDangerButton({
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

export function InputField({
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

export function TextareaField({
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
