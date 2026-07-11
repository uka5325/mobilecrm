
"use client";

import { SettlementPanel } from "./SettlementPanel";

type Props = {
  patientId: string;
  patientName: string;
  onClose: () => void;
  onMutated?: () => void;
};

export function SettlementModal({ patientId, patientName, onClose, onMutated }: Props) {
  return (
    <>
      <div className="fixed inset-0 z-[1100] bg-black/40" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[1101] flex max-h-[92vh] w-[760px] max-w-[calc(100vw-20px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <div className="text-lg font-bold">정산 관리</div>
            <div className="mt-0.5 text-xs text-gray-500">{patientName}</div>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <SettlementPanel patientId={patientId} patientName={patientName} onMutated={onMutated} />
        </div>
      </div>
    </>
  );
}
