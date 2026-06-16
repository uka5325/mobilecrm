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
        className="mt-1 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm transition focus:border-[#1d9e75] focus:outline-none"
      />
    </div>
  );
}
