"use client";

import { useState } from "react";
import type { InvoiceCategory } from "@/lib/invoiceSettings";
import {
  EmptyTableRow,
  InputField,
  SmallButton,
  SmallDangerButton,
  TableWrap,
  Td,
  Th,
} from "./ui";

export function InvoiceCategoriesPanel({
  categories,
  canManage,
  saving,
  onSave,
  onDeactivate,
}: {
  categories: InvoiceCategory[];
  canManage: boolean;
  saving: boolean;
  onSave: (payload: {
    categoryId?: string;
    nameKo: string;
    nameEn?: string;
    nameLocal?: string;
    active?: boolean;
    sortOrder?: number;
  }) => void;
  onDeactivate: (categoryId: string) => void;
}) {
  const [form, setForm] = useState({
    categoryId: "",
    nameKo: "",
    nameEn: "",
    nameLocal: "",
    sortOrder: 999999,
    active: true,
  });

  function fill(item: InvoiceCategory) {
    setForm({
      categoryId: item.categoryId,
      nameKo: item.nameKo,
      nameEn: item.nameEn,
      nameLocal: item.nameLocal,
      sortOrder: item.sortOrder,
      active: item.active,
    });
  }

  function reset() {
    setForm({
      categoryId: "",
      nameKo: "",
      nameEn: "",
      nameLocal: "",
      sortOrder: 999999,
      active: true,
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-4">
        <div className="mb-3 text-sm font-bold text-gray-900">
          대분류 추가 / 수정
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <InputField
            label="대분류 ID"
            value={form.categoryId}
            disabled={!!form.categoryId || !canManage || saving}
            placeholder="breast"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, categoryId: value }))
            }
          />

          <InputField
            label="한국어 대분류명"
            value={form.nameKo}
            disabled={!canManage || saving}
            placeholder="가슴 수술"
            onChange={(value) => setForm((prev) => ({ ...prev, nameKo: value }))}
          />

          <InputField
            label="영어 대분류명"
            value={form.nameEn}
            disabled={!canManage || saving}
            placeholder="Breast Surgery"
            onChange={(value) => setForm((prev) => ({ ...prev, nameEn: value }))}
          />

          <InputField
            label="현지어 대분류명"
            value={form.nameLocal}
            disabled={!canManage || saving}
            placeholder="Хөхний мэс засал"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, nameLocal: value }))
            }
          />

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
            <Th>한국어</Th>
            <Th>영어</Th>
            <Th>현지어</Th>
            <Th>순서</Th>
            <Th>상태</Th>
            <Th>관리</Th>
          </tr>
        </thead>

        <tbody>
          {categories.length === 0 ? (
            <EmptyTableRow colSpan={7} text="등록된 대분류가 없습니다." />
          ) : (
            categories.map((item) => (
              <tr key={item.id}>
                <Td>{item.categoryId}</Td>
                <Td>{item.nameKo}</Td>
                <Td>{item.nameEn || "-"}</Td>
                <Td>{item.nameLocal || "-"}</Td>
                <Td>{item.sortOrder}</Td>
                <Td>{item.active ? "사용" : "비활성"}</Td>
                <Td>
                  <div className="flex gap-2">
                    <SmallButton onClick={() => fill(item)}>수정</SmallButton>
                    <SmallDangerButton
                      disabled={!canManage || saving || !item.active}
                      onClick={() => onDeactivate(item.categoryId)}
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
