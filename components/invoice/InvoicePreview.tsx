"use client";

import type { InvoiceTemplate, InvoiceTemplateSection, InvoiceItemMaster } from "@/lib/invoices";
import type { InvoiceCategory } from "@/lib/invoiceSettings";

type Props = {
  template: InvoiceTemplate | null;
  sections: InvoiceTemplateSection[];
  categories: InvoiceCategory[];
  items: InvoiceItemMaster[];
  categoryOrder: string[];
  sectionOrder: string[];
};

function formatMoney(value: number) {
  return value.toLocaleString("ko-KR");
}

export function InvoicePreview({
  template,
  sections,
  categories,
  items,
  categoryOrder,
  sectionOrder,
}: Props) {
  if (!template) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        템플릿을 선택해 주세요
      </div>
    );
  }

  const orderedCategories = [...categories].sort((a, b) => {
    const ai = categoryOrder.indexOf(a.categoryId);
    const bi = categoryOrder.indexOf(b.categoryId);
    if (ai === -1 && bi === -1) return a.sortOrder - b.sortOrder;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const orderedSections = [...sections].sort((a, b) => {
    const ai = sectionOrder.indexOf(a.sectionId);
    const bi = sectionOrder.indexOf(b.sectionId);
    if (ai === -1 && bi === -1) return a.sortOrder - b.sortOrder;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const samplePatient = {
    name: "홍길동",
    birth: "990101",
    doctor: "김원장",
    surgerySchedule: "2026-06-08",
    totalAmount: "5,500,000",
    deposit: "1,000,000",
  };

  const labels = template.patientInfoLabels || {};

  return (
    <div className="overflow-auto rounded-xl border border-[#edf0f3] bg-white text-[11px]">
      <div className="min-w-[280px] p-4">
        {/* Header */}
        <div className="mb-3 text-center">
          <div className="text-[10px] font-bold text-gray-500">
            {template.clinicTitleKo || "병원명"}
          </div>
          <div className="text-base font-extrabold text-gray-800">
            {template.invoiceTitle || "견적서"}
          </div>
        </div>

        {/* Patient info */}
        <div className="mb-3 rounded-lg border border-[#edf0f3] bg-[#f8fafc] p-2.5">
          {[
            [labels.name || "성함", samplePatient.name],
            [labels.birth || "생년월일", samplePatient.birth],
            [labels.doctor || "담당원장", samplePatient.doctor],
            [labels.surgerySchedule || "수술예정일", samplePatient.surgerySchedule],
            [labels.totalAmount || "총금액", samplePatient.totalAmount],
            [labels.deposit || "보증금", samplePatient.deposit],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between py-0.5">
              <span className="text-gray-500">{label}</span>
              <span className="font-medium text-gray-700">{value}</span>
            </div>
          ))}
        </div>

        {/* Items by category */}
        <div className="mb-3">
          <div className="mb-1 grid grid-cols-[1fr_60px_60px] gap-1 border-b border-gray-200 pb-1 text-[10px] font-semibold text-gray-500">
            <span>항목</span>
            <span className="text-right">{template.regularPriceLabel || "정가"}</span>
            <span className="text-right">{template.eventPriceLabel || "이벤트가"}</span>
          </div>
          {orderedCategories.map((cat) => {
            const catItems = items.filter((i) => i.categoryId === cat.categoryId);
            if (!catItems.length) return null;
            return (
              <div key={cat.categoryId} className="mb-1.5">
                <div className="mb-0.5 text-[10px] font-bold text-emerald-700">
                  {cat.nameKo}
                </div>
                {catItems.slice(0, 2).map((item) => (
                  <div
                    key={item.itemId}
                    className="grid grid-cols-[1fr_60px_60px] gap-1 py-0.5 text-gray-600"
                  >
                    <span className="truncate">{item.nameKo}</span>
                    <span className="text-right">{formatMoney(item.regularPrice)}</span>
                    <span className="text-right font-medium text-emerald-600">
                      {formatMoney(item.eventPrice)}
                    </span>
                  </div>
                ))}
                {catItems.length > 2 && (
                  <div className="text-[10px] text-gray-400">외 {catItems.length - 2}개</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Sections */}
        {orderedSections.length > 0 && (
          <div className="space-y-1.5">
            {orderedSections.map((sec) => (
              <div
                key={sec.sectionId}
                className="rounded-lg p-2"
                style={{
                  backgroundColor: sec.backgroundColor || "#f0fdf4",
                  border: sec.borderColor ? `1px solid ${sec.borderColor}` : "1px solid #d1fae5",
                }}
              >
                <div className="mb-0.5 text-[10px] font-bold" style={{ color: sec.borderColor || "#059669" }}>
                  {sec.titleLocal || sec.titleKo}
                </div>
                {sec.lines.slice(0, 2).map((line, i) => (
                  <div key={i} className="text-[10px] text-gray-600">
                    {line.local || line.ko}
                  </div>
                ))}
                {sec.lines.length > 2 && (
                  <div className="text-[10px] text-gray-400">...</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
