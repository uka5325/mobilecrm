"use client";

export type InvoiceMenuState = {
  id: string;
  x: number;
  y: number;
} | null;

type Props = {
  invoiceMenu: InvoiceMenuState;
  onClose: () => void;
  onView: () => void;
  onDelete: () => void;
};

export function InvoiceContextMenu({ invoiceMenu, onClose, onView, onDelete }: Props) {
  if (!invoiceMenu) return null;

  return (
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div
        className="fixed z-[9999] w-[170px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 text-sm shadow-xl"
        style={{ left: invoiceMenu.x, top: invoiceMenu.y }}
      >
        <button
          type="button"
          onClick={onView}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
        >
          <span>📂</span>
          <span>인보이스 보기</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-red-600 hover:bg-red-50"
        >
          <span>🧹</span>
          <span>인보이스 삭제</span>
        </button>
      </div>
    </>
  );
}
