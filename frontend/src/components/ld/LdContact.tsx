import React, { useState } from 'react';
import type { LdElement, LdElementType } from '../../types/plc';
import { TAG_H, PIN_ROW_H, BRANCH_STEP_Y, isCoilType, isCmpType } from './constants';

export const SmartTagInput: React.FC<{
  value: string;
  listId: string;
  shortLabelMap: Record<string, string>;
  hasError?: boolean;
  errorTitle?: string;
  isForced?: boolean;
  className?: string;
  onChange: (val: string) => void;
}> = ({ value, listId, shortLabelMap, hasError, errorTitle, isForced, className = '', onChange }) => {
  const [focused, setFocused] = useState(false);
  const displayValue = focused ? value : shortLabelMap[value] || value.replace(/^"([^"]+)"\./, '$1.');

  return (
    <input
      list={listId}
      value={displayValue}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value)}
      title={errorTitle || `${value}${isForced ? ' [FORCED]' : ''}`}
      className={`text-xs font-mono rounded px-1.5 outline-none transition truncate border ${
        hasError
          ? 'bg-rose-950/40 border-rose-500 text-rose-300'
          : isForced
          ? 'bg-amber-950/60 border-amber-500 text-amber-300 font-bold'
          : focused
          ? 'bg-[#1e1e1e] border-[#3b82f6] text-white'
          : 'bg-[#18181b]/90 border-[#333338] hover:border-[#52525b] text-[#9cdcfe]'
      } ${className}`}
    />
  );
};

const SymbolSvg: React.FC<{
  type: LdElementType;
  wireInHot: boolean;
  wireOutHot: boolean;
  isParallelChild?: boolean;
  isLastParallel?: boolean;
}> = ({ type, wireInHot, wireOutHot, isParallelChild = false, isLastParallel = false }) => {
  const inColor = wireInHot ? '#10b981' : '#71717a';
  const outColor = wireOutHot ? '#10b981' : '#71717a';
  const symColor = wireOutHot ? '#34d399' : isCoilType(type) ? '#fb923c' : '#38bdf8';

  if (isCoilType(type)) {
    let ch = '';
    if (type === 'COIL_SET') ch = 'S';
    if (type === 'COIL_RESET') ch = 'R';
    if (type === 'COIL_INV') ch = '/';
    return (
      <svg width="160" height={PIN_ROW_H} viewBox="0 0 160 48" className="block shrink-0">
        <line x1="0" y1="24" x2="58" y2="24" stroke={inColor} strokeWidth="2.5" />
        <line x1="102" y1="24" x2="160" y2="24" stroke={outColor} strokeWidth="2.5" />
        <path d="M 68 10 A 14 14 0 0 0 68 38" fill="none" stroke={symColor} strokeWidth="2.5" />
        <path d="M 92 10 A 14 14 0 0 1 92 38" fill="none" stroke={symColor} strokeWidth="2.5" />
        {ch && (
          <text x="80" y="28" textAnchor="middle" fill={symColor} fontSize="13" fontWeight="bold">
            {ch}
          </text>
        )}
      </svg>
    );
  }

  let ch = '';
  if (type === 'P_TRIG') ch = 'P';
  if (type === 'N_TRIG') ch = 'N';
  if (isCmpType(type)) ch = type.replace('CMP_', '');

  return (
    <svg width="160" height={PIN_ROW_H} viewBox="0 0 160 48" className="block overflow-visible shrink-0">
      {!isParallelChild ? (
        <>
          <line x1="0" y1="24" x2="62" y2="24" stroke={inColor} strokeWidth="2.5" />
          <line x1="98" y1="24" x2="160" y2="24" stroke={outColor} strokeWidth="2.5" />
        </>
      ) : (
        <>
          <line x1="14" y1={24 - BRANCH_STEP_Y} x2="14" y2={isLastParallel ? 24 : 48} stroke={inColor} strokeWidth="2.2" />
          <line x1="146" y1={24 - BRANCH_STEP_Y} x2="146" y2={isLastParallel ? 24 : 48} stroke={outColor} strokeWidth="2.2" />
          <line x1="14" y1="24" x2="62" y2="24" stroke={inColor} strokeWidth="2.2" />
          <line x1="98" y1="24" x2="146" y2="24" stroke={outColor} strokeWidth="2.2" />
        </>
      )}

      <line x1="62" y1="11" x2="62" y2="37" stroke={symColor} strokeWidth="2.5" />
      <line x1="98" y1="11" x2="98" y2="37" stroke={symColor} strokeWidth="2.5" />
      {type === 'NC' && <line x1="66" y1="34" x2="94" y2="14" stroke={symColor} strokeWidth="2.2" />}
      {ch && (
        <text x="80" y="28" textAnchor="middle" fill={symColor} fontSize="11" fontWeight="bold">
          {ch}
        </text>
      )}
    </svg>
  );
};

interface LdContactProps {
  el: LdElement;
  wireInHot: boolean;
  mainOutHot: boolean;
  parHotList: boolean[];
  liveVal1: any;
  isCoreRunning: boolean;
  typeMismatch: boolean;
  tagType1?: string;
  isForcedMain: boolean;
  forcedParList: boolean[];
  shortLabelMap: Record<string, string>;
  onUpdate: (patch: Partial<LdElement>) => void;
  onParallelContextMenu: (e: React.MouseEvent, parIdx: number) => void;
}

export const LdContact: React.FC<LdContactProps> = ({
  el,
  wireInHot,
  mainOutHot,
  parHotList,
  liveVal1,
  isCoreRunning,
  typeMismatch,
  tagType1,
  isForcedMain,
  forcedParList,
  shortLabelMap,
  onUpdate,
  onParallelContextMenu,
}) => {
  return (
    <div className="flex flex-col items-center w-[160px]">
      <div style={{ height: TAG_H }} className="w-full px-2 flex items-center justify-center">
        <SmartTagInput
          value={el.operand1}
          listId="plc-bool-tags"
          shortLabelMap={shortLabelMap}
          hasError={typeMismatch}
          errorTitle={typeMismatch ? `Ошибка типа: контакт требует BOOL, выбран ${tagType1}` : undefined}
          isForced={isForcedMain}
          className="w-full text-center py-0.5"
          onChange={(val) => onUpdate({ operand1: val })}
        />
      </div>

      <SymbolSvg type={el.type} wireInHot={wireInHot} wireOutHot={mainOutHot} />

      <div className="flex items-center gap-1.5 text-[11px] text-[#a1a1aa] -mt-1">
        <span>{el.type}</span>
        {isCoreRunning && liveVal1 !== undefined && (
          <span className="px-1.5 rounded bg-[#27272a] text-emerald-300 font-bold">={String(liveVal1)}</span>
        )}
      </div>

      {el.parallel?.map((par, pIdx) => {
        const isLastPar = pIdx === el.parallel!.length - 1;
        return (
          <div
            key={par.id}
            onContextMenu={(e) => onParallelContextMenu(e, pIdx)}
            className="flex flex-col items-center w-[160px] mt-1 relative"
          >
            <div style={{ height: TAG_H }} className="w-[128px] flex items-center gap-1 z-10">
              <select
                value={par.type}
                onChange={(e) => {
                  const nextPar = el.parallel!.map((p, i) =>
                    i === pIdx ? { ...p, type: e.target.value as LdElementType } : p
                  );
                  onUpdate({ parallel: nextPar });
                }}
                className="bg-[#252526] border border-[#3e3e42] text-sky-300 text-[10px] rounded px-1 py-0.5 outline-none"
              >
                <option value="NO">NO</option>
                <option value="NC">NC</option>
                <option value="P_TRIG">P</option>
                <option value="N_TRIG">N</option>
              </select>
              <SmartTagInput
                value={par.operand1}
                listId="plc-bool-tags"
                shortLabelMap={shortLabelMap}
                isForced={Boolean(forcedParList[pIdx])}
                className="flex-1 py-0.5 text-center"
                onChange={(val) => {
                  const nextPar = el.parallel!.map((p, i) => (i === pIdx ? { ...p, operand1: val } : p));
                  onUpdate({ parallel: nextPar });
                }}
              />
            </div>

            <SymbolSvg
              type={par.type}
              wireInHot={wireInHot}
              wireOutHot={Boolean(parHotList[pIdx])}
              isParallelChild
              isLastParallel={isLastPar}
            />
          </div>
        );
      })}
    </div>
  );
};
