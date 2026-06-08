"use client";

import { getSoftStatusColor } from "@/lib/colorUtils";

export function KpiBox({
  label,
  value,
  className,
  color,
}: {
  label: string;
  value: number;
  className?: string;
  color?: string;
}) {
  const validColor =
    color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "";

  return (
    <div
      className={`rounded-xl px-3 py-1.5 ${className || ""}`}
      style={
        validColor
          ? {
              backgroundColor: getSoftStatusColor(validColor),
              color: validColor,
              border: `1px solid ${validColor}33`,
            }
          : undefined
      }
    >
      <div className="text-xs font-semibold opacity-90">{label}</div>
      <div className="text-lg font-extrabold">{value}</div>
    </div>
  );
}
