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
        className="mt-1 w-full rounded-[16px] border border-[#dbe7e3] bg-white px-3 py-2 text-base transition focus:border-[#5bd5c8] focus:outline-none focus:ring-2 focus:ring-[#dff7f3] sm:text-sm"
      />
    </div>
  );
}
