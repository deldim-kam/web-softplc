import React from 'react';
import type { LdRung as LdRungType, LdElement, LiveDbSnapshot, ForceEntry } from '../../types/plc';
import { WIRE_Y, isBoxType, isCoilType, isContactType, canHaveParallel } from './constants';
import { LdContact } from './LdContact';
import { LdBox } from './LdBox';
import { Trash2, ArrowLeft, ArrowRight, GitBranch } from 'lucide-react';

interface LdRungProps {
  blockName: string;
  rung: LdRungType;
  rIdx: number;
  isRungSelected: boolean;
  selectedElIdx: number | null;
  monitoring: boolean;
  isCoreRunning: boolean;
  liveData: LiveDbSnapshot;
  rloStatus: boolean[];
  compiledRloMap: Record<string, number>;
  activeForces: Record<string, ForceEntry>;
  allTagsMap: Record<string, string>;
  shortLabelMap: Record<string, string>;
  onSelectRung: (rIdx: number) => void;
  onSelectElement: (rIdx: number, eIdx: number) => void;
  onRenameRung: (rIdx: number, title: string) => void;
  onDeleteRung: (rIdx: number) => void;
  onMoveElement: (rIdx: number, eIdx: number, dir: -1 | 1) => void;
  onAddParallel: (rIdx: number, eIdx: number) => void;
  onRemoveElement: (rIdx: number, eIdx: number) => void;
  onUpdateElement: (rIdx: number, eIdx: number, patch: Partial<LdElement>) => void;
  onContextMenu: (
    e: React.MouseEvent,
    targetType: 'ELEMENT' | 'PARALLEL' | 'RUNG',
    rIdx: number,
    elIdx?: number,
    parIdx?: number
  ) => void;
}

export const LdRung: React.FC<LdRungProps> = React.memo(({
  blockName,
  rung,
  rIdx,
  isRungSelected,
  selectedElIdx,
  monitoring,
  isCoreRunning,
  liveData,
  rloStatus,
  compiledRloMap,
  activeForces,
  allTagsMap,
  shortLabelMap,
  onSelectRung,
  onSelectElement,
  onRenameRung,
  onDeleteRung,
  onMoveElement,
  onAddParallel,
  onRemoveElement,
  onUpdateElement,
  onContextMenu,
}) => {
  const getRloForId = (id: string): boolean => {
    if (!isCoreRunning || !monitoring) return false;
    const slot = compiledRloMap[`${blockName}:${id}`];
    return slot ? Boolean(rloStatus[slot]) : false;
  };

  const lastEl = rung.elements[rung.elements.length - 1];
  const endWireHot = lastEl
    ? getRloForId(lastEl.id) || Boolean(lastEl.parallel?.some((p) => getRloForId(p.id)))
    : false;

  return (
    <div
      onClick={() => onSelectRung(rIdx)}
      onContextMenu={(e) => onContextMenu(e, 'RUNG', rIdx)}
      className={`border rounded-md transition ${
        isRungSelected
          ? 'border-[#3b82f6] bg-[#1c1c1f] ring-1 ring-[#3b82f6]/50 shadow-lg'
          : 'border-[#2d2d30] bg-[#18181b]'
      }`}
    >
      <div className="px-3 py-1.5 bg-[#252526] border-b border-[#2d2d30] flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1">
          <span
            className={`px-2 py-0.5 font-mono text-xs rounded font-bold select-none ${
              isRungSelected ? 'bg-[#2563eb] text-white' : 'bg-[#3f3f46] text-[#d4d4d8]'
            }`}
          >
            NW {rIdx + 1}
          </span>
          <input
            type="text"
            value={rung.title}
            onChange={(e) => onRenameRung(rIdx, e.target.value)}
            className="bg-transparent text-xs text-white font-medium outline-none focus:bg-[#333333] px-2 py-0.5 rounded w-full max-w-xl"
          />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeleteRung(rIdx);
          }}
          className="text-[#a1a1aa] hover:text-rose-400 p-1 transition"
          title="Удалить цепь"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="px-4 pt-7 pb-5 overflow-x-auto flex items-stretch min-h-[160px] font-mono">
        <div
          className={`w-1.5 rounded-full shrink-0 ${
            isCoreRunning && monitoring ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]' : 'bg-[#71717a]'
          }`}
        />

        {rung.elements.length === 0 ? (
          <div className="flex items-start flex-1">
            <div
              style={{ marginTop: WIRE_Y - 1 }}
              className="h-[2.5px] w-full bg-[#333338] relative flex items-center justify-center"
            >
              <span className="bg-[#18181b] px-3 text-xs text-[#a1a1aa] italic">
                Цепь пуста — нажмите ПКМ или выберите элемент на панели сверху
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-start flex-1 min-w-max">
            {rung.elements.map((el, eIdx) => {
              const prevEl = eIdx > 0 ? rung.elements[eIdx - 1] : null;
              const wireInHot =
                isCoreRunning &&
                monitoring &&
                (eIdx === 0
                  ? true
                  : Boolean(
                      prevEl &&
                        (getRloForId(prevEl.id) || prevEl.parallel?.some((p) => getRloForId(p.id)))
                    ));

              const mainOutHot = getRloForId(el.id);
              const parHotList = (el.parallel || []).map((p) => getRloForId(p.id));
              const cellOutHot = mainOutHot || parHotList.some(Boolean);

              const isElSelected = isRungSelected && selectedElIdx === eIdx;
              const tagType1 = allTagsMap[el.operand1];
              const typeMismatch =
                (isContactType(el.type) || isCoilType(el.type)) && Boolean(tagType1) && tagType1 !== 'BOOL';
              const isTrailingCoil = isCoilType(el.type) && eIdx === rung.elements.length - 1;

              return (
                <React.Fragment key={el.id}>
                  {isTrailingCoil && (
                    <div
                      style={{ marginTop: WIRE_Y - 1 }}
                      className={`flex-1 min-w-[32px] h-[2.5px] ${
                        wireInHot ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-[#71717a]'
                      }`}
                    />
                  )}

                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectElement(rIdx, eIdx);
                    }}
                    onContextMenu={(e) => onContextMenu(e, 'ELEMENT', rIdx, eIdx)}
                    className={`flex flex-col items-center relative group rounded transition ${
                      isElSelected ? 'ring-2 ring-sky-400 bg-sky-950/15' : ''
                    }`}
                  >
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 h-5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition z-20 bg-[#252526] border border-[#3e3e42] px-1 rounded shadow-md">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMoveElement(rIdx, eIdx, -1);
                        }}
                        className="p-0.5 hover:bg-[#3e3e42] text-white rounded"
                      >
                        <ArrowLeft size={11} />
                      </button>
                      {canHaveParallel(el.type) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddParallel(rIdx, eIdx);
                          }}
                          className="px-1 bg-indigo-700 hover:bg-indigo-600 text-white rounded text-[10px] flex items-center gap-0.5"
                        >
                          <GitBranch size={10} /> +OR
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMoveElement(rIdx, eIdx, 1);
                        }}
                        className="p-0.5 hover:bg-[#3e3e42] text-white rounded"
                      >
                        <ArrowRight size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveElement(rIdx, eIdx);
                        }}
                        className="p-0.5 hover:bg-rose-700 text-rose-300 hover:text-white rounded"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>

                    {!isBoxType(el.type) ? (
                      <LdContact
                        el={el}
                        wireInHot={wireInHot}
                        mainOutHot={mainOutHot}
                        parHotList={parHotList}
                        liveVal1={liveData[el.operand1]}
                        isCoreRunning={isCoreRunning}
                        typeMismatch={typeMismatch}
                        tagType1={tagType1}
                        isForcedMain={Boolean(activeForces[el.operand1]?.active)}
                        forcedParList={(el.parallel || []).map((p) => Boolean(activeForces[p.operand1]?.active))}
                        shortLabelMap={shortLabelMap}
                        onUpdate={(patch) => onUpdateElement(rIdx, eIdx, patch)}
                        onParallelContextMenu={(e, pIdx) => onContextMenu(e, 'PARALLEL', rIdx, eIdx, pIdx)}
                      />
                    ) : (
                      <LdBox
                        el={el}
                        wireInHot={wireInHot}
                        cellOutHot={cellOutHot}
                        val1={liveData[el.operand1]}
                        val2={el.operand2 ? liveData[el.operand2] : undefined}
                        val3={el.operand3 ? liveData[el.operand3] : undefined}
                        f1={Boolean(activeForces[el.operand1]?.active)}
                        f2={Boolean(el.operand2 && activeForces[el.operand2]?.active)}
                        f3={Boolean(el.operand3 && activeForces[el.operand3]?.active)}
                        isCoreRunning={isCoreRunning}
                        shortLabelMap={shortLabelMap}
                        onUpdate={(patch) => onUpdateElement(rIdx, eIdx, patch)}
                      />
                    )}
                  </div>
                </React.Fragment>
              );
            })}

            <div
              style={{ marginTop: WIRE_Y - 1 }}
              className={`flex-1 min-w-[28px] h-[2.5px] ${
                endWireHot ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-[#71717a]'
              }`}
            />
          </div>
        )}

        <div className={`w-1.5 rounded-full shrink-0 ${endWireHot ? 'bg-emerald-500/80' : 'bg-[#71717a]'}`} />
      </div>
    </div>
  );
});
