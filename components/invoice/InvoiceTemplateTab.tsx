"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableItem } from "./SortableItem";
import { InvoicePreview } from "./InvoicePreview";
import { getInvoiceTemplate, getInvoiceItemMasters, getInvoiceSections, saveInvoiceTemplateOrder } from "@/lib/invoices";
import {
  getInvoiceCategories,
  getInvoiceTemplateSections,
  getInvoiceTemplates,
  saveInvoiceCategory,
  saveInvoiceTemplateSection,
  type InvoiceCategory,
  type InvoiceTemplateSection,
} from "@/lib/invoiceSettings";
import type { InvoiceTemplate, InvoiceItemMaster, InvoiceTemplateSection as InvSecFromInvoices } from "@/lib/invoices";
import type { StaffUser } from "@/lib/auth";

type Props = {
  currentUser: StaffUser;
};

type AddCategoryForm = { nameKo: string; nameLocal: string };
type AddSectionForm = { titleKo: string; titleLocal: string; contentKo: string; contentLocal: string };

export function InvoiceTemplateTab({ currentUser }: Props) {
  const [templateId, setTemplateId] = useState("template_mn");
  const [allTemplates, setAllTemplates] = useState<{ templateId: string; titleKo: string }[]>([]);
  const [template, setTemplate] = useState<InvoiceTemplate | null>(null);
  const [previewSections, setPreviewSections] = useState<InvSecFromInvoices[]>([]);
  const [items, setItems] = useState<InvoiceItemMaster[]>([]);
  const [categories, setCategories] = useState<InvoiceCategory[]>([]);
  const [settingsSections, setSettingsSections] = useState<InvoiceTemplateSection[]>([]);

  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [addCatOpen, setAddCatOpen] = useState(false);
  const [addCatForm, setAddCatForm] = useState<AddCategoryForm>({ nameKo: "", nameLocal: "" });
  const [addCatSaving, setAddCatSaving] = useState(false);

  const [addSecOpen, setAddSecOpen] = useState(false);
  const [addSecForm, setAddSecForm] = useState<AddSectionForm>({ titleKo: "", titleLocal: "", contentKo: "", contentLocal: "" });
  const [addSecSaving, setAddSecSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    getInvoiceTemplates(false).then((templates) => {
      setAllTemplates(templates.map((t) => ({ templateId: t.templateId, titleKo: t.titleKo })));
    });
  }, []);

  useEffect(() => {
    loadAll();
  }, [templateId]);

  async function loadAll() {
    const [tmpl, cats, secs, masterItems, prevSecs] = await Promise.all([
      getInvoiceTemplate(templateId),
      getInvoiceCategories(false),
      getInvoiceTemplateSections(false),
      getInvoiceItemMasters(),
      getInvoiceSections(templateId),
    ]);
    setTemplate(tmpl);
    setCategories(cats);
    setSettingsSections(secs);
    setItems(masterItems);
    setPreviewSections(prevSecs);

    setCategoryOrder(tmpl?.categoryOrder ?? cats.map((c) => c.categoryId));
    setSectionOrder(tmpl?.sectionOrder ?? secs.map((s) => s.sectionId));
  }

  function handleCatDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setCategoryOrder((prev) => {
        const oldIndex = prev.indexOf(String(active.id));
        const newIndex = prev.indexOf(String(over.id));
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  function handleSecDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSectionOrder((prev) => {
        const oldIndex = prev.indexOf(String(active.id));
        const newIndex = prev.indexOf(String(over.id));
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveInvoiceTemplateOrder(templateId, categoryOrder, sectionOrder);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCategory() {
    if (!addCatForm.nameKo.trim()) return;
    setAddCatSaving(true);
    try {
      await saveInvoiceCategory(
        { nameKo: addCatForm.nameKo, nameLocal: addCatForm.nameLocal, sortOrder: categories.length * 10 },
        currentUser
      );
      setAddCatForm({ nameKo: "", nameLocal: "" });
      setAddCatOpen(false);
      await loadAll();
    } finally {
      setAddCatSaving(false);
    }
  }

  async function handleAddSection() {
    if (!addSecForm.titleKo.trim()) return;
    setAddSecSaving(true);
    try {
      await saveInvoiceTemplateSection(
        {
          titleKo: addSecForm.titleKo,
          titleLocal: addSecForm.titleLocal,
          contentKo: addSecForm.contentKo,
          contentLocal: addSecForm.contentLocal,
          sortOrder: settingsSections.length * 10,
        },
        currentUser
      );
      setAddSecForm({ titleKo: "", titleLocal: "", contentKo: "", contentLocal: "" });
      setAddSecOpen(false);
      await loadAll();
    } finally {
      setAddSecSaving(false);
    }
  }

  const orderedCategories = [...categories].sort((a, b) => {
    const ai = categoryOrder.indexOf(a.categoryId);
    const bi = categoryOrder.indexOf(b.categoryId);
    if (ai === -1 && bi === -1) return a.sortOrder - b.sortOrder;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const orderedSections = [...settingsSections].sort((a, b) => {
    const ai = sectionOrder.indexOf(a.sectionId);
    const bi = sectionOrder.indexOf(b.sectionId);
    if (ai === -1 && bi === -1) return a.sortOrder - b.sortOrder;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Template selector + save */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">템플릿</span>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="h-9 rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm focus:border-[#1d9e75] focus:outline-none"
          >
            {allTemplates.length === 0 && (
              <option value="template_mn">기본 템플릿</option>
            )}
            {allTemplates.map((t) => (
              <option key={t.templateId} value={t.templateId}>
                {t.titleKo || t.templateId}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-9 rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
        >
          {saved ? "저장됨 ✓" : saving ? "저장 중..." : "순서 저장"}
        </button>
      </div>

      {/* 3-column layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left: Categories */}
        <div className="rounded-2xl border border-[#edf0f3] bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-700">카테고리 순서</span>
            <button
              onClick={() => setAddCatOpen(true)}
              className="h-7 rounded-lg bg-gray-100 px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
            >
              + 추가
            </button>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatDragEnd}>
            <SortableContext items={categoryOrder} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {orderedCategories.map((cat) => (
                  <SortableItem key={cat.categoryId} id={cat.categoryId}>
                    <div className="flex cursor-grab items-center gap-2 rounded-xl border border-[#edf0f3] bg-[#f8fafc] px-3 py-2 active:cursor-grabbing">
                      <span className="text-gray-300">⠿</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-700">
                          {cat.nameKo}
                        </div>
                        {cat.nameLocal && (
                          <div className="truncate text-xs text-gray-400">{cat.nameLocal}</div>
                        )}
                      </div>
                    </div>
                  </SortableItem>
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Add category form */}
          {addCatOpen && (
            <div className="mt-3 rounded-xl border border-[#edf0f3] bg-[#f0fdf4] p-3">
              <input
                placeholder="카테고리명 (한국어)"
                value={addCatForm.nameKo}
                onChange={(e) => setAddCatForm((p) => ({ ...p, nameKo: e.target.value }))}
                className="mb-2 w-full rounded-lg border border-[#dfe3e8] px-2.5 py-1.5 text-sm focus:border-[#1d9e75] focus:outline-none"
              />
              <input
                placeholder="카테고리명 (현지어)"
                value={addCatForm.nameLocal}
                onChange={(e) => setAddCatForm((p) => ({ ...p, nameLocal: e.target.value }))}
                className="mb-2 w-full rounded-lg border border-[#dfe3e8] px-2.5 py-1.5 text-sm focus:border-[#1d9e75] focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddCategory}
                  disabled={addCatSaving}
                  className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  저장
                </button>
                <button
                  onClick={() => setAddCatOpen(false)}
                  className="flex-1 rounded-lg bg-gray-100 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Middle: Sections */}
        <div className="rounded-2xl border border-[#edf0f3] bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-700">안내사항 순서</span>
            <button
              onClick={() => setAddSecOpen(true)}
              className="h-7 rounded-lg bg-gray-100 px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
            >
              + 추가
            </button>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSecDragEnd}>
            <SortableContext items={sectionOrder} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {orderedSections.map((sec) => (
                  <SortableItem key={sec.sectionId} id={sec.sectionId}>
                    <div className="flex cursor-grab items-center gap-2 rounded-xl border border-[#edf0f3] bg-[#f8fafc] px-3 py-2 active:cursor-grabbing">
                      <span className="text-gray-300">⠿</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-700">
                          {sec.titleKo}
                        </div>
                        {sec.titleLocal && (
                          <div className="truncate text-xs text-gray-400">{sec.titleLocal}</div>
                        )}
                      </div>
                    </div>
                  </SortableItem>
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Add section form */}
          {addSecOpen && (
            <div className="mt-3 rounded-xl border border-[#edf0f3] bg-[#f0fdf4] p-3">
              <input
                placeholder="안내사항 제목 (한국어)"
                value={addSecForm.titleKo}
                onChange={(e) => setAddSecForm((p) => ({ ...p, titleKo: e.target.value }))}
                className="mb-2 w-full rounded-lg border border-[#dfe3e8] px-2.5 py-1.5 text-sm focus:border-[#1d9e75] focus:outline-none"
              />
              <input
                placeholder="안내사항 제목 (현지어)"
                value={addSecForm.titleLocal}
                onChange={(e) => setAddSecForm((p) => ({ ...p, titleLocal: e.target.value }))}
                className="mb-2 w-full rounded-lg border border-[#dfe3e8] px-2.5 py-1.5 text-sm focus:border-[#1d9e75] focus:outline-none"
              />
              <textarea
                placeholder="내용 (한국어)"
                value={addSecForm.contentKo}
                onChange={(e) => setAddSecForm((p) => ({ ...p, contentKo: e.target.value }))}
                rows={2}
                className="mb-2 w-full rounded-lg border border-[#dfe3e8] px-2.5 py-1.5 text-sm focus:border-[#1d9e75] focus:outline-none"
              />
              <textarea
                placeholder="내용 (현지어)"
                value={addSecForm.contentLocal}
                onChange={(e) => setAddSecForm((p) => ({ ...p, contentLocal: e.target.value }))}
                rows={2}
                className="mb-2 w-full rounded-lg border border-[#dfe3e8] px-2.5 py-1.5 text-sm focus:border-[#1d9e75] focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddSection}
                  disabled={addSecSaving}
                  className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  저장
                </button>
                <button
                  onClick={() => setAddSecOpen(false)}
                  className="flex-1 rounded-lg bg-gray-100 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Preview */}
        <div className="rounded-2xl border border-[#edf0f3] bg-[#f8fafc] p-4">
          <div className="mb-3 text-sm font-bold text-gray-700">미리보기</div>
          <InvoicePreview
            template={template}
            sections={previewSections}
            categories={categories}
            items={items}
            categoryOrder={categoryOrder}
            sectionOrder={sectionOrder}
          />
        </div>
      </div>
    </div>
  );
}
