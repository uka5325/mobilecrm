"use client";

export function EditField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-gray-500">{label}</label>
      <input
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-[16px] bg-[#f8fbfa] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-[#bdeee8] sm:text-sm"
      />
    </div>
  );
}
