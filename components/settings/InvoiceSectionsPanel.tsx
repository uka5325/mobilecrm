"use client";

import { useState } from "react";
import type { InvoiceTemplateSection } from "@/lib/invoiceSettings";
import {
  EmptyTableRow,
  InputField,
  SmallButton,
  SmallDangerButton,
  TableWrap,
  Td,
  TextareaField,
  Th,
} from "./ui";

export function InvoiceSectionsPanel({
  sections,
  canManage,
  saving,
  onSave,
  onDeactivate,
}: {
  sections: InvoiceTemplateSection[];
  canManage: boolean;
  saving: boolean;
  onSave: (payload: any) => void;
  onDeactivate: (sectionId: string) => void;
}) {
  const [form, setForm] = useState({
    sectionId: "",
    titleKo: "",
    titleEn: "",
    titleLocal: "",
    contentKo: "",
    contentEn: "",
    contentLocal: "",
    sortOrder: 999999,
    active: true,
  });

  function fill(item: InvoiceTemplateSection) {
    setForm({
      sectionId: item.sectionId,
      titleKo: item.titleKo,
      titleEn: item.titleEn,
      titleLocal: item.titleLocal,
      contentKo: item.contentKo,
      contentEn: item.contentEn,
      contentLocal: item.contentLocal,
      sortOrder: item.sortOrder,
      active: item.active,
    });
  }

  function reset() {
    setForm({
      sectionId: "",
      titleKo: "",
      titleEn: "",
      titleLocal: "",
      contentKo: "",
      contentEn: "",
      contentLocal: "",
      sortOrder: 999999,
      active: true,
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-4">
        <div className="mb-3 text-sm font-bold text-gray-900">
          안내사항 추가 / 수정
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <InputField
            label="안내사항 ID"
            value={form.sectionId}
            disabled={!!form.sectionId || !canManage || saving}
            placeholder="payment_notice"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, sectionId: value }))
            }
          />

          <InputField
            label="한국어 제목"
            value={form.titleKo}
            disabled={!canManage || saving}
            placeholder="결제 안내"
            onChange={(value) => setForm((prev) => ({ ...prev, titleKo: value }))}
          />

          <InputField
            label="영어 제목"
            value={form.titleEn}
            disabled={!canManage || saving}
            placeholder="Payment Notice"
            onChange={(value) => setForm((prev) => ({ ...prev, titleEn: value }))}
          />

          <InputField
            label="현지어 제목"
            value={form.titleLocal}
            disabled={!canManage || saving}
            placeholder="Төлбөрийн мэдээлэл"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, titleLocal: value }))
            }
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3">
          <TextareaField
            label="한국어 내용"
            value={form.contentKo}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, contentKo: value }))
            }
          />

          <TextareaField
            label="영어 내용"
            value={form.contentEn}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, contentEn: value }))
            }
          />

          <TextareaField
            label="현지어 내용"
            value={form.contentLocal}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, contentLocal: value }))
            }
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <InputField
            label="정렬순서"
            type="number"
            value={String(form.sortOrder)}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({
                ...prev,
                sortOrder: Number(value || 999999),
              }))
            }
          />

          <label className="flex items-center gap-2 pt-6 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              disabled={!canManage || saving}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, active: e.target.checked }))
              }
            />
            사용
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={reset}
            className="rounded-xl border border-[#dfe3e8] bg-white px-4 py-2 text-sm"
          >
            새 항목
          </button>

          <button
            disabled={!canManage || saving}
            onClick={() => onSave(form)}
            className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            저장
          </button>
        </div>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>제목</Th>
            <Th>영문</Th>
            <Th>현지어</Th>
            <Th>순서</Th>
            <Th>상태</Th>
            <Th>관리</Th>
          </tr>
        </thead>

        <tbody>
          {sections.length === 0 ? (
            <EmptyTableRow colSpan={7} text="등록된 안내사항이 없습니다." />
          ) : (
            sections.map((item) => (
              <tr key={item.id}>
                <Td>{item.sectionId}</Td>
                <Td>{item.titleKo}</Td>
                <Td>{item.titleEn || "-"}</Td>
                <Td>{item.titleLocal || "-"}</Td>
                <Td>{item.sortOrder}</Td>
                <Td>{item.active ? "사용" : "비활성"}</Td>
                <Td>
                  <div className="flex gap-2">
                    <SmallButton onClick={() => fill(item)}>수정</SmallButton>
                    <SmallDangerButton
                      disabled={!canManage || saving || !item.active}
                      onClick={() => onDeactivate(item.sectionId)}
                    >
                      비활성화
                    </SmallDangerButton>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>
    </div>
  );
}
