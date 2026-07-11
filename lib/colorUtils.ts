export function getReadableTextColor(hex: string) {
  const clean = String(hex || "").replace("#", "");

  if (clean.length !== 6) return "#ffffff";

  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  return brightness > 150 ? "#111827" : "#ffffff";
}
