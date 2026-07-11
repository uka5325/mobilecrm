export function formatMoney(value: number | undefined) {
  if (value === undefined || value === null) return "-";
  return Number(value).toLocaleString("ko-KR");
}

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "임시저장",
  confirmed: "확정",
  void: "취소",
};

export const INVOICE_STATUS_CLASS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-500",
  confirmed: "bg-emerald-50 text-emerald-700",
  void: "bg-red-50 text-red-500",
};
