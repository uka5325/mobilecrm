"use client";

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
              backgroundColor: `${validColor}22`,
              border: `2px solid ${validColor}`,
            }
          : undefined
      }
    >
      <div className="text-xs font-semibold text-gray-500">{label}</div>
      <div
        className="text-lg font-extrabold"
        style={validColor ? { color: validColor } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
