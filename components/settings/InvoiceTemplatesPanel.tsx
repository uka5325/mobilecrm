"use client";

import { useState } from "react";
import type { InvoiceTemplate } from "@/lib/invoiceSettings";
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

export function InvoiceTemplatesPanel({
  templates,
  canManage,
  saving,
  onSave,
  onDeactivate,
}: {
  templates: InvoiceTemplate[];
  canManage: boolean;
  saving: boolean;
  onSave: (payload: any) => void;
  onDeactivate: (templateId: string) => void;
}) {
  const [form, setForm] = useState({
    templateId: "",
    titleKo: "",
    titleEn: "",
    titleLocal: "",
    hospitalNameKo: "아크성형외과",
    hospitalNameEn: "ARC Plastic Surgery",
    hospitalNameLocal: "",
    footerKo: "",
    footerEn: "",
    footerLocal: "",
    language: "mn",
    sortOrder: 999999,
    active: true,
  });

  function fill(item: InvoiceTemplate) {
    setForm({
      templateId: item.templateId,
      titleKo: item.titleKo,
      titleEn: item.titleEn,
      titleLocal: item.titleLocal,
      hospitalNameKo: item.hospitalNameKo,
      hospitalNameEn: item.hospitalNameEn,
      hospitalNameLocal: item.hospitalNameLocal,
      footerKo: item.footerKo,
      footerEn: item.footerEn,
      footerLocal: item.footerLocal,
      language: item.language,
      sortOrder: item.sortOrder,
      active: item.active,
    });
  }

  function reset() {
    setForm({
      templateId: "",
      titleKo: "",
      titleEn: "",
      titleLocal: "",
      hospitalNameKo: "아크성형외과",
      hospitalNameEn: "ARC Plastic Surgery",
      hospitalNameLocal: "",
      footerKo: "",
      footerEn: "",
      footerLocal: "",
      language: "mn",
      sortOrder: 999999,
      active: true,
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#edf0f3] bg-gray-50 p-4">
        <div className="mb-3 text-sm font-bold text-gray-900">
          인보이스 제목 / 템플릿 추가 · 수정
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <InputField
            label="템플릿 ID"
            value={form.templateId}
            disabled={!!form.templateId || !canManage || saving}
            placeholder="default_mn"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, templateId: value }))
            }
          />

          <InputField
            label="언어"
            value={form.language}
            disabled={!canManage || saving}
            placeholder="mn"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, language: value }))
            }
          />

          <InputField
            label="한국어 제목"
            value={form.titleKo}
            disabled={!canManage || saving}
            placeholder="수술 견적서"
            onChange={(value) => setForm((prev) => ({ ...prev, titleKo: value }))}
          />

          <InputField
            label="영어 제목"
            value={form.titleEn}
            disabled={!canManage || saving}
            placeholder="Surgery Quotation"
            onChange={(value) => setForm((prev) => ({ ...prev, titleEn: value }))}
          />

          <InputField
            label="현지어 제목"
            value={form.titleLocal}
            disabled={!canManage || saving}
            placeholder="Мэс заслын үнийн санал"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, titleLocal: value }))
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

          <InputField
            label="병원명 한국어"
            value={form.hospitalNameKo}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, hospitalNameKo: value }))
            }
          />

          <InputField
            label="병원명 영어"
            value={form.hospitalNameEn}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, hospitalNameEn: value }))
            }
          />

          <InputField
            label="병원명 현지어"
            value={form.hospitalNameLocal}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, hospitalNameLocal: value }))
            }
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3">
          <TextareaField
            label="하단 문구 한국어"
            value={form.footerKo}
            disabled={!canManage || saving}
            onChange={(value) => setForm((prev) => ({ ...prev, footerKo: value }))}
          />

          <TextareaField
            label="하단 문구 영어"
            value={form.footerEn}
            disabled={!canManage || saving}
            onChange={(value) => setForm((prev) => ({ ...prev, footerEn: value }))}
          />

          <TextareaField
            label="하단 문구 현지어"
            value={form.footerLocal}
            disabled={!canManage || saving}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, footerLocal: value }))
            }
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
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
              onClick={() => onSave(form)}
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
            <Th>ID</Th>
            <Th>언어</Th>
            <Th>제목</Th>
            <Th>병원명</Th>
            <Th>순서</Th>
            <Th>상태</Th>
            <Th>관리</Th>
          </tr>
        </thead>

        <tbody>
          {templates.length === 0 ? (
            <EmptyTableRow colSpan={7} text="등록된 템플릿이 없습니다." />
          ) : (
            templates.map((item) => (
              <tr key={item.id}>
                <Td>{item.templateId}</Td>
                <Td>{item.language}</Td>
                <Td>{item.titleKo}</Td>
                <Td>{item.hospitalNameKo || "-"}</Td>
                <Td>{item.sortOrder}</Td>
                <Td>{item.active ? "사용" : "비활성"}</Td>
                <Td>
                  <div className="flex gap-2">
                    <SmallButton onClick={() => fill(item)}>수정</SmallButton>
                    <SmallDangerButton
                      disabled={!canManage || saving || !item.active}
                      onClick={() => onDeactivate(item.templateId)}
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
