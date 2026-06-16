import {
  DEFAULT_VISIT_STATUS_COLORS,
  VISIT_STATUS_LIST,
  type VisitStatus,
  type VisitStatusColorMap,
} from "@/lib/settings";

export function getStatusColor(status: string, colors: VisitStatusColorMap) {
  if (VISIT_STATUS_LIST.includes(status as VisitStatus)) {
    return colors[status as VisitStatus] || DEFAULT_VISIT_STATUS_COLORS.내원전;
  }

  return DEFAULT_VISIT_STATUS_COLORS.내원전;
}

export function getSoftStatusColor(hex: string) {
  const color = String(hex || "").trim();

  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}2E`;
  }

  return "#f3f4f6";
}

export function getStatusSelectStyle(status: string, colors: VisitStatusColorMap) {
  const color = getStatusColor(status, colors);

  return {
    backgroundColor: getSoftStatusColor(color),
    color,
    borderColor: `${color}33`,
  };
}

export function getReadableTextColor(hex: string) {
  const clean = String(hex || "").replace("#", "");

  if (clean.length !== 6) return "#ffffff";

  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  return brightness > 150 ? "#111827" : "#ffffff";
}
