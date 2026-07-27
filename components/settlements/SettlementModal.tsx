
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
      <div className="fixed inset-0 z-[1100] bg-black/35 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[1101] flex max-h-[calc(100dvh-64px)] w-[760px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[30px] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.26)]">
        <div className="flex shrink-0 items-center justify-between bg-white px-5 pb-3 pt-5">
          <div>
            <div className="text-lg font-bold">정산 관리</div>
            <div className="mt-0.5 text-xs text-gray-500">{patientName}</div>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f6f7f5] text-xl leading-none text-[#667085]">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <SettlementPanel patientId={patientId} patientName={patientName} onMutated={onMutated} />
        </div>
      </div>
    </>
  );
}
