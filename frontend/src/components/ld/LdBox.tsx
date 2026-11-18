import React from 'react';
import type { LdElement } from '../../types/plc';
import { TAG_H, PIN_ROW_H, WIRE_Y } from './constants';
import { SmartTagInput } from './LdContact';

const OperandRow: React.FC<{
  label: string;
  labelClass?: string;
  value: string;
  listId: string;
  liveVal: any;
  isCoreRunning: boolean;
  isForced: boolean;
  shortLabelMap: Record<string, string>;
  borderTop?: boolean;
  onChange: (val: string) => void;
}> = ({
  label,
  labelClass = 'text-[#a1a1aa]',
  value,
  listId,
  liveVal,
  isCoreRunning,
  isForced,
  shortLabelMap,
  borderTop = false,
  onChange,
}) => (
  <div className={`flex items-center gap-1.5 ${borderTop ? 'pt-1 border-t border-[#333338]' : ''}`}>
    <span className={`w-12 text-[11px] shrink-0 ${labelClass}`}>{label}</span>
    <SmartTagInput
      value={value}
      listId={listId}
      shortLabelMap={shortLabelMap}
      isForced={isForced}
      className="flex-1 py-0.5"
      onChange={onChange}
    />
    <span className="w-16 text-right text-[11px] text-emerald-300 font-bold truncate shrink-0">
      {isCoreRunning && liveVal !== undefined ? `=${String(liveVal)}` : ''}
    </span>
  </div>
);

interface LdBoxProps {
  el: LdElement;
  wireInHot: boolean;
  cellOutHot: boolean;
  val1: any;
  val2: any;
  val3: any;
  f1: boolean;
  f2: boolean;
  f3: boolean;
  isCoreRunning: boolean;
  shortLabelMap: Record<string, string>;
  onUpdate: (patch: Partial<LdElement>) => void;
}

export const LdBox: React.FC<LdBoxProps> = ({
  el,
  wireInHot,
  cellOutHot,
  val1,
  val2,
  val3,
  f1,
  f2,
  f3,
  isCoreRunning,
  shortLabelMap,
  onUpdate,
}) => {
  const in1Label =
    el.type === 'TON' || el.type === 'TOF' ? 'PT(ms):' : el.type === 'CTU' || el.type === 'CTD' ? 'CU/CD:' : 'IN1:';
  const in2Label = el.type === 'CTU' || el.type === 'CTD' ? 'PV:' : 'IN2:';

  return (
    <div className="flex items-start">
      <svg width="16" height={TAG_H + PIN_ROW_H} viewBox="0 0 16 76" className="block shrink-0">
        <line
          x1="0"
          y1={WIRE_Y}
          x2="16"
          y2={WIRE_Y}
          stroke={wireInHot ? '#10b981' : '#71717a'}
          strokeWidth="2.5"
        />
      </svg>

      <div
        className={`w-[260px] rounded border bg-[#222225] overflow-hidden shadow-md ${
          cellOutHot ? 'border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.2)]' : 'border-[#45454a]'
        }`}
      >
        <div
          style={{ height: TAG_H }}
          className="px-2.5 bg-[#2d2d32] border-b border-[#3e3e42] flex justify-between items-center text-xs font-bold text-amber-300"
        >
          <span>{el.type}</span>
          <span className="text-[10px] text-[#a1a1aa] font-normal">FBD/LD Box</span>
        </div>

        <div
          style={{ height: PIN_ROW_H }}
          className="px-2.5 bg-[#1b1b1e] border-b border-[#2e2e34] flex items-center justify-between text-xs font-bold"
        >
          <span className={wireInHot ? 'text-emerald-400' : 'text-[#71717a]'}>● EN</span>
          <div className={`flex-1 mx-3 h-[2px] ${cellOutHot ? 'bg-emerald-500/80' : 'bg-[#3f3f46]'}`} />
          <span className={cellOutHot ? 'text-emerald-400' : 'text-[#71717a]'}>ENO ●</span>
        </div>

        <div className="p-2 space-y-1.5 text-xs">
          <OperandRow
            label={in1Label}
            value={el.operand1}
            listId={el.type === 'CTU' || el.type === 'CTD' ? 'plc-bool-tags' : 'plc-num-tags'}
            liveVal={val1}
            isCoreRunning={isCoreRunning}
            isForced={f1}
            shortLabelMap={shortLabelMap}
            onChange={(val) => onUpdate({ operand1: val })}
          />

          {el.operand2 !== undefined && (
            <OperandRow
              label={in2Label}
              value={el.operand2}
              listId="plc-num-tags"
              liveVal={val2}
              isCoreRunning={isCoreRunning}
              isForced={f2}
              shortLabelMap={shortLabelMap}
              onChange={(val) => onUpdate({ operand2: val })}
            />
          )}

          {el.operand3 !== undefined && (
            <OperandRow
              label="OUT:"
              labelClass="text-amber-400 font-bold"
              value={el.operand3}
              listId={el.type === 'TON' || el.type === 'TOF' ? 'plc-bool-tags' : 'plc-num-tags'}
              liveVal={val3}
              isCoreRunning={isCoreRunning}
              isForced={f3}
              shortLabelMap={shortLabelMap}
              borderTop
              onChange={(val) => onUpdate({ operand3: val })}
            />
          )}
        </div>
      </div>

      <svg width="16" height={TAG_H + PIN_ROW_H} viewBox="0 0 16 76" className="block shrink-0">
        <line
          x1="0"
          y1={WIRE_Y}
          x2="16"
          y2={WIRE_Y}
          stroke={cellOutHot ? '#10b981' : '#71717a'}
          strokeWidth="2.5"
        />
      </svg>
    </div>
  );
};
