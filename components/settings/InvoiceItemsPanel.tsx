"use client";

import { useEffect, useState } from "react";
import type { InvoiceCategory, InvoiceCurrency, InvoiceItem } from "@/lib/invoiceSettings";
import {
  EmptyTableRow,
  InputField,
  SmallButton,
  SmallDangerButton,
  TableWrap,
  Td,
  Th,
} from "./ui";

const CURRENCY_LIST: InvoiceCurrency[] = [
  "KRW",
  "USD",
  "JPY",
  "CNY",
  "MNT",
  "VND",
];

function formatPrice(value: number | string | undefined) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("ko-KR");
}

export function InvoiceItemsPanel({
  categories,
  items,
  canManage,
  saving,
  onSave,
  onDeactivate,
}: {
  categories: InvoiceCategory[];
  items: InvoiceItem[];
  canManage: boolean;
  saving: boolean;
  onSave: (payload: any) => void;
  onDeactivate: (itemId: string) => void;
}) {
  const activeCategories = categories.filter((item) => item.active);

  const [form, setForm] = useState({
    itemId: "",
    categoryId: activeCategories[0]?.categoryId || "",
    nameKo: "",
    nameEn: "",
    nameLocal: "",
    regularPrice: 0,
    eventPrice: 0,
    costPrice: 0,
    currency: "KRW",
    sortOrder: 999999,
    active: true,
    memo: "",
  });

  useEffect(() => {
    if (!form.categoryId && activeCategories[0]?.categoryId) {
      setForm((prev) => ({
        ...prev,
        categoryId: activeCategories[0].categoryId,
      }));
    }
  }, [activeCategories, form.categoryId]);

  const selectedCategory = categories.find(
    (item) => item.categoryId === form.categoryId
  );

  function fill(item: InvoiceItem) {
    setForm({
      itemId: item.itemId,
      categoryId: item.categoryId,
      nameKo: item.nameKo,
      nameEn: item.nameEn,
      nameLocal: item.nameLocal,
      regularPrice: item.regularPrice,
      eventPrice: item.eventPrice,
      costPrice: item.costPrice,
      currency: item.currency || "KRW",
      sortOrder: item.sortOrder,
      active: item.active,
      memo: item.memo || "",
    });
  }

  function reset() {
    setForm({
      itemId: "",
      categoryId: activeCategories[0]?.categoryId || "",
      nameKo: "",
      nameEn: "",
      nameLocal: "",
      regularPrice: 0,
      eventPrice: 0,
      costPrice: 0,
      currency: "KRW",
      sortOrder: 999999,
      active: true,
      memo: "",
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-4">
        <div className="mb-3 text-sm font-bold text-gray-900">
          수술항목 / 가격 추가 · 수정
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-gray-500">대분류</label>
            <select
              value={form.categoryId}
              disabled={!canManage || saving}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, categoryId: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm"
            >
              {activeCategories.map((category) => (
                <option key={category.categoryId} value={category.categoryId}>
                  {category.nameKo}
                </option>
              ))}
            </select>
          </div>

          <InputField
            label="항목 ID"
            value={form.itemId}
            disabled={!!form.itemId || !canManage || saving}
            placeholder="breast_motiva"
            onChange={(value) => setForm((prev) => ({ ...prev, itemId: value }))}
          />

          <InputField
            label="한국어 항목명"
            value={form.nameKo}
            disabled={!canManage || saving}
            placeholder="모티바"
            onChange={(value) => setForm((prev) => ({ ...prev, nameKo: value }))}
          />

          <InputField
            label="영어 항목명"
            value={form.nameEn}
            disabled={!canManage || saving}
            placeholder="Motiva"
            onChange={(value) => setForm((prev) => ({ ...prev, nameEn: value }))}
          />

          <InputField
            label="현지어 항목명"
            value={form.nameLocal}
            disabled={!canManage || saving}
            placeholder="Мотива"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, nameLocal: value }))
            }
          />

          <div>
            <label className="mb-1 block text-xs text-gray-500">통화</label>
            <select
              value={form.currency}
              disabled={!canManage || saving}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, currency: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-[#dfe3e8] bg-white px-3 text-sm"
            >
              {CURRENCY_LIST.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>

          <InputField
            label="정가"
            type="number"
            value={String(form.regularPrice)}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({
                ...prev,
                regularPrice: Number(value || 0),
              }))
            }
          />

          <InputField
            label="이벤트가"
            type="number"
            value={String(form.eventPrice)}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({
                ...prev,
                eventPrice: Number(value || 0),
              }))
            }
          />

          <InputField
            label="원가"
            type="number"
            value={String(form.costPrice)}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({
                ...prev,
                costPrice: Number(value || 0),
              }))
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
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs text-gray-500">메모</label>
          <textarea
            value={form.memo}
            disabled={!canManage || saving}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, memo: e.target.value }))
            }
            className="w-full resize-none rounded-xl border border-[#dfe3e8] bg-white px-3 py-2 text-sm"
            rows={2}
            placeholder="내부 참고 메모"
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
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

          <div className="flex gap-2">
            <button
              onClick={reset}
              className="rounded-xl border border-[#dfe3e8] bg-white px-4 py-2 text-sm"
            >
              새 항목
            </button>

            <button
              disabled={!canManage || saving}
              onClick={() =>
                onSave({
                  ...form,
                  categoryKo: selectedCategory?.nameKo || "",
                  categoryLocal: selectedCategory?.nameLocal || "",
                })
              }
              className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </div>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>대분류</Th>
            <Th>항목명</Th>
            <Th>영문</Th>
            <Th>현지어</Th>
            <Th>정가</Th>
            <Th>이벤트가</Th>
            <Th>순서</Th>
            <Th>상태</Th>
            <Th>관리</Th>
          </tr>
        </thead>

        <tbody>
          {items.length === 0 ? (
            <EmptyTableRow colSpan={9} text="등록된 수술항목이 없습니다." />
          ) : (
            items.map((item) => (
              <tr key={item.id}>
                <Td>{item.categoryKo || item.categoryId}</Td>
                <Td>{item.nameKo}</Td>
                <Td>{item.nameEn || "-"}</Td>
                <Td>{item.nameLocal || "-"}</Td>
                <Td>
                  {formatPrice(item.regularPrice)} {item.currency}
                </Td>
                <Td>
                  {formatPrice(item.eventPrice)} {item.currency}
                </Td>
                <Td>{item.sortOrder}</Td>
                <Td>{item.active ? "사용" : "비활성"}</Td>
                <Td>
                  <div className="flex gap-2">
                    <SmallButton onClick={() => fill(item)}>수정</SmallButton>
                    <SmallDangerButton
                      disabled={!canManage || saving || !item.active}
                      onClick={() => onDeactivate(item.itemId)}
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
