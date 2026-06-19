"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import { getStaffByUid, listenCurrentUser } from "@/lib/auth";
import type { StaffUser } from "@/lib/auth";
import {
  calculateInvoiceTotals,
  getOrCreateInvoiceDraft,
  type InvoiceDiscount,
  type InvoiceItemSnapshot,
  type InvoiceRecord,
  updateInvoice,
} from "@/lib/invoices";
import { calcCommissionBase, calcCommission, type PaymentMethod } from "@/lib/commissionUtils";
import { getStaffListForSettings, type SettingsStaffRecord } from "@/lib/settings";

function formatMoney(value: number) {
  const n = Number(value || 0);
  return n.toLocaleString("ko-KR");
}

function parseMoney(value: string) {
  const n = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function getParamValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function getCategoryLabel(items: InvoiceItemSnapshot[], categoryId: string) {
  const found = items.find((item) => item.categoryId === categoryId);
  return found?.categoryLocal || found?.categoryKo || categoryId;
}

export default function InvoiceEditPage() {
  const params = useParams();
  const router = useRouter();

  const reservationDocId = getParamValue(params.reservationId);

  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);

  const [items, setItems] = useState<InvoiceItemSnapshot[]>([]);
  const [discounts, setDiscounts] = useState<InvoiceDiscount[]>([]);
  const [depositAmount, setDepositAmount] = useState(0);
  const [memo, setMemo] = useState("");
  const [internalMemo, setInternalMemo] = useState("");
  const [status, setStatus] = useState<"draft" | "confirmed" | "void">(
    "draft"
  );

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [cardAmount, setCardAmount] = useState(0);
  const [cashAmount, setCashAmount] = useState(0);
  const [commissionRate, setCommissionRate] = useState<number | "">("");
  const [commissionStaffUid, setCommissionStaffUid] = useState("");
  const [commissionStaffName, setCommissionStaffName] = useState("");
  const [staffList, setStaffList] = useState<SettingsStaffRecord[]>([]);

  const [loadingUser, setLoadingUser] = useState(true);
  const [loadingInvoice, setLoadingInvoice] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const unsubscribe = listenCurrentUser(async (user: User | null) => {
      if (!user) {
        setLoadingUser(false);
        return;
      }

      const staff = await getStaffByUid(user.uid);
      setCurrentUser(staff);
      setLoadingUser(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function loadInvoice() {
      if (!currentUser || !reservationDocId) return;

      setLoadingInvoice(true);
      setMessage("");

      try {
        const result = await getOrCreateInvoiceDraft(
          reservationDocId,
          currentUser,
          "template_mn"
        );

        if (!result.success || !result.invoice) {
          setMessage(result.message || "인보이스를 불러오지 못했습니다.");
          return;
        }

        const loaded = result.invoice;

        setInvoice(loaded);
        setItems(loaded.items || []);
        setDiscounts(loaded.discounts || []);
        setDepositAmount(loaded.depositAmount || 0);
        setMemo(loaded.memo || "");
        setInternalMemo(loaded.internalMemo || "");
        setStatus(loaded.status || "draft");
        setPaymentMethod(loaded.paymentMethod || "");
        setCardAmount(loaded.cardAmount || 0);
        setCashAmount(loaded.cashAmount || 0);
        setCommissionRate(loaded.commissionRate ?? "");
        setCommissionStaffUid(loaded.commissionStaffUid || "");
        setCommissionStaffName(loaded.commissionStaffName || "");
      } catch (error) {
        console.error(error);
        setMessage("인보이스 로딩 중 오류가 발생했습니다.");
      } finally {
        setLoadingInvoice(false);
      }
    }

    loadInvoice();
  }, [currentUser, reservationDocId]);

  useEffect(() => {
    getStaffListForSettings().then((list) => {
      setStaffList(list.filter((s) => s.active && (s.role === "admin" || s.role === "coordinator")));
    }).catch(() => {});
  }, []);

  const totals = useMemo(() => {
    return calculateInvoiceTotals(items, discounts, depositAmount);
  }, [items, discounts, depositAmount]);

  const commissionCalc = useMemo(() => {
    if (!paymentMethod || commissionRate === "") return null;
    const base = calcCommissionBase(totals.finalTotal, paymentMethod as PaymentMethod, cardAmount, cashAmount);
    const amount = calcCommission(base, Number(commissionRate));
    return { base, amount };
  }, [paymentMethod, totals.finalTotal, cardAmount, cashAmount, commissionRate]);

  const categoryOrder = useMemo(() => {
    const templateOrder = invoice?.templateSnapshot?.categoryOrder || [];
    const actualCategories = Array.from(
      new Set(items.map((item) => item.categoryId).filter(Boolean))
    );

    return [
      ...templateOrder.filter((categoryId) =>
        actualCategories.includes(categoryId)
      ),
      ...actualCategories.filter(
        (categoryId) => !templateOrder.includes(categoryId)
      ),
    ];
  }, [invoice, items]);

  const groupedItems = useMemo(() => {
    const map: Record<string, InvoiceItemSnapshot[]> = {};

    items.forEach((item) => {
      if (!map[item.categoryId]) map[item.categoryId] = [];
      map[item.categoryId].push(item);
    });

    Object.keys(map).forEach((categoryId) => {
      map[categoryId].sort((a, b) => a.sortOrder - b.sortOrder);
    });

    return map;
  }, [items]);

  function updateItem(itemId: string, patch: Partial<InvoiceItemSnapshot>) {
    setItems((prev) =>
      prev.map((item) =>
        item.itemId === itemId
          ? {
              ...item,
              ...patch,
            }
          : item
      )
    );
  }

  function updateDiscount(
    discountId: string,
    patch: Partial<InvoiceDiscount>
  ) {
    setDiscounts((prev) =>
      prev.map((discount) =>
        discount.discountId === discountId
          ? {
              ...discount,
              ...patch,
            }
          : discount
      )
    );
  }

  async function handleSave() {
    if (!currentUser || !invoice) {
      setMessage("저장할 인보이스 정보를 찾을 수 없습니다.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const result = await updateInvoice(
        invoice.id,
        {
          items,
          discounts,
          depositAmount,
          memo,
          internalMemo,
          status,
          paymentMethod: paymentMethod || undefined,
          cardAmount: paymentMethod === "mixed" ? cardAmount : undefined,
          cashAmount: paymentMethod === "mixed" ? cashAmount : undefined,
          commissionRate: commissionRate !== "" ? Number(commissionRate) : undefined,
          commissionStaffUid: commissionStaffUid || undefined,
          commissionStaffName: commissionStaffName || undefined,
          commissionBase: commissionCalc?.base,
          commissionAmount: commissionCalc?.amount,
        },
        currentUser
      );

      if (!result.success || !result.invoice) {
        setMessage(result.message || "저장에 실패했습니다.");
        return;
      }

      const saved = result.invoice;

      setInvoice(saved);
      setItems(saved.items || []);
      setDiscounts(saved.discounts || []);
      setDepositAmount(saved.depositAmount || 0);
      setMemo(saved.memo || "");
      setInternalMemo(saved.internalMemo || "");
      setStatus(saved.status || "draft");
      setPaymentMethod(saved.paymentMethod || "");
      setCardAmount(saved.cardAmount || 0);
      setCashAmount(saved.cashAmount || 0);
      setCommissionRate(saved.commissionRate ?? "");
      setCommissionStaffUid(saved.commissionStaffUid || "");
      setCommissionStaffName(saved.commissionStaffName || "");

      setMessage("저장 완료");
      router.back();
    } catch (error) {
      console.error(error);
      setMessage("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (loadingUser || loadingInvoice) {
    return (
      <div className="rounded-xl border border-black/10 bg-white p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
        인보이스를 불러오는 중...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="rounded-xl border border-black/10 bg-white p-6 text-red-600">
        로그인 정보를 확인할 수 없습니다.
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="rounded-xl border border-black/10 bg-white p-6 text-red-600">
        {message || "인보이스 정보를 찾을 수 없습니다."}
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-28">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
        <div>
          <div className="text-xs font-bold text-[#1d9e75]">CRM INVOICE</div>
          <h1 className="mt-1 text-2xl font-bold text-[#1a1a1a]">
            {invoice.templateSnapshot?.invoiceTitle || "INVOICE"}
          </h1>
          <div className="mt-1 text-sm text-gray-500">
            {invoice.invoiceId}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => router.back()}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700"
          >
            ← 뒤로
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-black px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-4">
          <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
            <div className="text-center">
              <div className="text-sm font-semibold text-gray-700">
                {invoice.templateSnapshot?.clinicTitleKo}
              </div>
              <div className="mt-1 text-lg font-bold">
                {invoice.templateSnapshot?.mainTitle}
              </div>
            </div>
          </div>

          {invoice.sectionsSnapshot.map((section) => (
            <div
              key={section.sectionId}
              className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]"
              style={{
                background:
                  section.type === "benefit_box"
                    ? section.backgroundColor || "#fff7d6"
                    : undefined,
                borderColor:
                  section.type === "benefit_box"
                    ? section.borderColor || undefined
                    : undefined,
              }}
            >
              <div className="mb-3 text-sm font-bold text-[#1a1a1a]">
                {section.titleKo}
              </div>

              <div className="mb-3 text-sm font-semibold text-gray-700">
                {section.titleLocal}
              </div>

              <div className="space-y-2">
                {section.lines.map((line, index) => (
                  <div
                    key={`${section.sectionId}-${index}`}
                    className="rounded-xl bg-white/70 p-3 text-sm leading-6"
                  >
                    <div className="font-medium text-gray-800">
                      {line.local}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{line.ko}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
            <div className="mb-4 text-sm font-bold">환자 정보</div>

            <div className="grid grid-cols-[110px_1fr] gap-y-3 text-sm">
              <div className="text-gray-500">
                {invoice.templateSnapshot?.patientInfoLabels?.name || "이름"}
              </div>
              <div className="font-semibold">{invoice.patientName}</div>

              <div className="text-gray-500">
                {invoice.templateSnapshot?.patientInfoLabels?.birth ||
                  "생년월일"}
              </div>
              <div>{invoice.birthDisplay}</div>

              <div className="text-gray-500">
                {invoice.templateSnapshot?.patientInfoLabels?.doctor || "원장"}
              </div>
              <div>{invoice.doctors.join(", ")}</div>

              <div className="text-gray-500">국적</div>
              <div>{invoice.nationality}</div>

              <div className="text-gray-500">연락처</div>
              <div>{invoice.phone}</div>

              <div className="text-gray-500">상태</div>
              <div>
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as "draft" | "confirmed" | "void")
                  }
                  className="rounded-lg border px-3 py-1 text-sm"
                >
                  <option value="draft">draft</option>
                  <option value="confirmed">confirmed</option>
                  <option value="void">void</option>
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
            <div className="mb-4 text-sm font-bold">금액 요약</div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">정상가 합계</span>
                <b>{formatMoney(totals.regularTotal)} KRW</b>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-500">상담회가 합계</span>
                <b>{formatMoney(totals.eventTotal)} KRW</b>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-500">할인 합계</span>
                <b className="text-red-600">
                  -{formatMoney(totals.discountTotal)} KRW
                </b>
              </div>

              <div>
                <label className="text-xs text-gray-500">예약금</label>
                <input
                  value={depositAmount ? formatMoney(depositAmount) : ""}
                  onChange={(e) => setDepositAmount(parseMoney(e.target.value))}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-right text-sm"
                  placeholder="0"
                />
              </div>

              <div className="border-t pt-3">
                <div className="flex justify-between text-base">
                  <span className="font-bold">최종 수술비</span>
                  <b>{formatMoney(totals.finalTotal)} KRW</b>
                </div>

                <div className="mt-2 flex justify-between text-base">
                  <span className="font-bold">잔금</span>
                  <b className="text-[#1d9e75]">
                    {formatMoney(totals.balanceAmount)} KRW
                  </b>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">시술 / 수술 항목</div>
            <div className="mt-1 text-sm text-gray-500">
              체크박스 선택, 가격 직접 수정 후 저장할 수 있습니다.
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {categoryOrder.map((categoryId) => {
            const categoryItems = groupedItems[categoryId] || [];
            if (!categoryItems.length) return null;

            return (
              <div
                key={categoryId}
                className="overflow-hidden rounded-2xl border border-gray-200 bg-white"
              >
                <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 font-bold">
                  {getCategoryLabel(items, categoryId)}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] table-fixed text-sm">
                    <colgroup>
                      <col className="w-[60px]" />
                      <col className="w-[220px]" />
                      <col className="w-[170px]" />
                      <col className="w-[170px]" />
                      <col className="w-[90px]" />
                      <col className="w-[120px]" />
                    </colgroup>

                    <thead>
                      <tr className="border-b border-gray-200 text-xs text-gray-500">
                        <th className="px-3 py-2 text-center">선택</th>
                        <th className="px-3 py-2 text-left">항목</th>
                        <th className="px-3 py-2 text-right">
                          {invoice.templateSnapshot?.regularPriceLabel ||
                            "정상가"}
                        </th>
                        <th className="px-3 py-2 text-right">
                          {invoice.templateSnapshot?.eventPriceLabel ||
                            "상담회가"}
                        </th>
                        <th className="px-3 py-2 text-center">수량</th>
                        <th className="px-3 py-2 text-right">합계</th>
                      </tr>
                    </thead>

                    <tbody>
                      {categoryItems.map((item) => {
                        const regularValue =
                          item.customRegularPrice !== null
                            ? item.customRegularPrice
                            : item.finalRegularPrice;

                        const eventValue =
                          item.customEventPrice !== null
                            ? item.customEventPrice
                            : item.finalEventPrice;

                        const rowTotal = item.selected
                          ? eventValue * (item.quantity || 1)
                          : 0;

                        return (
                          <tr
                            key={item.itemId}
                            className="border-b border-gray-100 last:border-b-0"
                          >
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={item.selected}
                                onChange={(e) =>
                                  updateItem(item.itemId, {
                                    selected: e.target.checked,
                                  })
                                }
                                className="h-4 w-4"
                              />
                            </td>

                            <td className="px-3 py-3">
                              <div className="font-semibold">
                                {item.nameLocal || item.nameKo}
                              </div>
                              <div className="text-xs text-gray-500">
                                {item.nameKo}
                              </div>
                            </td>

                            <td className="px-3 py-3">
                              <input
                                value={formatMoney(regularValue)}
                                onChange={(e) =>
                                  updateItem(item.itemId, {
                                    customRegularPrice: parseMoney(
                                      e.target.value
                                    ),
                                  })
                                }
                                className="w-full rounded-lg border px-2 py-1 text-right"
                              />
                            </td>

                            <td className="px-3 py-3">
                              <input
                                value={formatMoney(eventValue)}
                                onChange={(e) =>
                                  updateItem(item.itemId, {
                                    customEventPrice: parseMoney(
                                      e.target.value
                                    ),
                                  })
                                }
                                className="w-full rounded-lg border px-2 py-1 text-right"
                              />
                            </td>

                            <td className="px-3 py-3">
                              <input
                                type="number"
                                min={1}
                                value={item.quantity}
                                onChange={(e) =>
                                  updateItem(item.itemId, {
                                    quantity: Math.max(
                                      Number(e.target.value || 1),
                                      1
                                    ),
                                  })
                                }
                                className="w-full rounded-lg border px-2 py-1 text-center"
                              />
                            </td>

                            <td className="px-3 py-3 text-right font-semibold">
                              {formatMoney(rowTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
        <div className="mb-4 text-lg font-bold">커미션 정보</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">결제 방법</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | "")}
              className="w-full rounded-xl border px-3 py-2 text-sm"
            >
              <option value="">선택</option>
              <option value="cash">현금</option>
              <option value="card">카드</option>
              <option value="mixed">혼합</option>
            </select>
          </div>

          {paymentMethod === "mixed" && (
            <>
              <div>
                <label className="mb-1 block text-xs text-gray-500">카드 금액</label>
                <input
                  value={cardAmount ? formatMoney(cardAmount) : ""}
                  onChange={(e) => setCardAmount(parseMoney(e.target.value))}
                  className="w-full rounded-xl border px-3 py-2 text-right text-sm"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">현금 금액</label>
                <input
                  value={cashAmount ? formatMoney(cashAmount) : ""}
                  onChange={(e) => setCashAmount(parseMoney(e.target.value))}
                  className="w-full rounded-xl border px-3 py-2 text-right text-sm"
                  placeholder="0"
                />
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-xs text-gray-500">담당 직원</label>
            <select
              value={commissionStaffUid}
              onChange={(e) => {
                const uid = e.target.value;
                setCommissionStaffUid(uid);
                const found = staffList.find((s) => s.uid === uid);
                setCommissionStaffName(found?.displayName || "");
              }}
              className="w-full rounded-xl border px-3 py-2 text-sm"
            >
              <option value="">선택</option>
              {staffList.map((s) => (
                <option key={s.uid} value={s.uid}>{s.displayName}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">커미션율 (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full rounded-xl border px-3 py-2 text-right text-sm"
              placeholder="예: 15"
            />
          </div>

          {commissionCalc && (
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="mb-1 block text-xs text-gray-500">커미션 계산 결과</label>
              <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">기준액</span>
                  <b>{formatMoney(commissionCalc.base)} KRW</b>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-gray-600">커미션 ({commissionRate}%)</span>
                  <b className="text-[#1d9e75]">{formatMoney(commissionCalc.amount)} KRW</b>
                </div>
                {paymentMethod === "card" && (
                  <div className="mt-1 text-xs text-gray-400">* 카드: VAT(10%) 제외 후 계산</div>
                )}
                {paymentMethod === "mixed" && (
                  <div className="mt-1 text-xs text-gray-400">* 혼합: 카드분 VAT 제외, 현금분 그대로</div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <div className="mb-4 text-lg font-bold">할인</div>

          <div className="space-y-3">
            {discounts.map((discount) => (
              <div key={discount.discountId} className="rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={discount.selected}
                    onChange={(e) =>
                      updateDiscount(discount.discountId, {
                        selected: e.target.checked,
                      })
                    }
                    className="h-4 w-4"
                  />

                  <div className="flex-1">
                    <div className="text-sm font-semibold">
                      {discount.labelLocal}
                    </div>
                    <div className="text-xs text-gray-500">
                      {discount.labelKo}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <select
                    value={discount.type}
                    onChange={(e) =>
                      updateDiscount(discount.discountId, {
                        type: e.target.value as "rate" | "amount",
                      })
                    }
                    className="rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="rate">%</option>
                    <option value="amount">금액</option>
                  </select>

                  <input
                    value={discount.value}
                    onChange={(e) =>
                      updateDiscount(discount.discountId, {
                        value: parseMoney(e.target.value),
                      })
                    }
                    className="rounded-lg border px-3 py-2 text-right text-sm"
                  />
                </div>

                <div className="mt-2 text-right text-sm text-red-600">
                  할인액: -
                  {formatMoney(
                    totals.discounts.find(
                      (d) => d.discountId === discount.discountId
                    )?.amount || 0
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <div className="mb-4 text-lg font-bold">메모</div>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500">고객 안내 메모</label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500">내부 메모</label>
              <textarea
                value={internalMemo}
                onChange={(e) => setInternalMemo(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="sticky bottom-0 z-20 rounded-t-2xl border border-black/10 bg-white p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="text-gray-500">최종 수술비 </span>
            <b>{formatMoney(totals.finalTotal)} KRW</b>
            <span className="mx-2 text-gray-300">|</span>
            <span className="text-gray-500">잔금 </span>
            <b className="text-[#1d9e75]">
              {formatMoney(totals.balanceAmount)} KRW
            </b>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-black px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "저장 중..." : "인보이스 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
