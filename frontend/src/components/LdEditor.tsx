import React, { useState, useMemo, useCallback, useRef } from 'react';
import type { DataBlock, LiveDbSnapshot, LdElementType, ForceEntry } from '../types/plc';
import { PALETTE_GROUPS, canHaveParallel } from './ld/constants';
import {
  createElement,
  cloneElementWithNewIds,
  insertElementInRungs,
  updateElementInRungs,
  removeElementFromRungs,
  moveElementInRungs,
  addParallelToElement,
  insertRungAt,
  duplicateRungAt,
  moveRungInList,
} from './ld/model';
import { useLdProgram } from './ld/useLdProgram';
import { LdToolbar } from './ld/LdToolbar';
import { LdRung } from './ld/LdRung';
import { ContextMenu } from './ld/ContextMenu';
import type { MenuItemSpec } from './ld/ContextMenu';

interface LdEditorProps {
  blockName: string;
  code: string;
  datablocks: DataBlock[];
  liveData: LiveDbSnapshot;
  rloStatus: boolean[];
  compiledRloMap?: Record<string, number>;
  isCoreRunning: boolean;
  activeForces?: Record<string, ForceEntry>;
  onForceTag?: (fullTag: string, value: string, active: boolean) => void;
  onChange: (newJsonCode: string) => void;
}

export const LdEditor: React.FC<LdEditorProps> = ({
  blockName,
  code,
  datablocks,
  liveData,
  rloStatus,
  compiledRloMap = {},
  isCoreRunning,
  activeForces = {},
  onForceTag,
  onChange,
}) => {
  const { rungs, commitRungs, undo, redo, canUndo, canRedo, clipboardEl, setClipboardEl } = useLdProgram(
    code,
    onChange
  );

  const [selectedRungIdx, setSelectedRungIdx] = useState<number>(0);
  const [selectedElIdx, setSelectedElIdx] = useState<number | null>(null);
  const [monitoring, setMonitoring] = useState<boolean>(true);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    targetType: 'ELEMENT' | 'PARALLEL' | 'RUNG';
    rungIdx: number;
    elIdx?: number;
    parIdx?: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const { boolTags, numericTags, allTagsMap, shortLabelMap } = useMemo(() => {
    const bTags: string[] = [];
    const nTags: string[] = [];
    const tMap: Record<string, string> = {};
    const counts: Record<string, number> = {};

    datablocks.forEach((db) =>
      db.variables.forEach((v) => {
        counts[v.name] = (counts[v.name] || 0) + 1;
      })
    );

    const sMap: Record<string, string> = {};
    datablocks.forEach((db) =>
      db.variables.forEach((v) => {
        const full = `"${db.name}".${v.name}`;
        tMap[full] = v.type;
        sMap[full] = counts[v.name] > 1 ? `${db.name}.${v.name}` : v.name;
        if (v.type === 'BOOL') bTags.push(full);
        else nTags.push(full);
      })
    );
    return { boolTags: bTags, numericTags: nTags, allTagsMap: tMap, shortLabelMap: sMap };
  }, [datablocks]);

  const defaultBool = boolTags[0] || '"Line_Params".Line_Enable';
  const defaultNum = numericTags[0] || '"Line_Params".Target_Speed';

  // Проверка: есть ли в схеме элементы, ещё не попавшие в скомпилированную карту RLO
  const isRloStale = useMemo(() => {
    for (const r of rungs) {
      for (const el of r.elements) {
        if (!compiledRloMap[`${blockName}:${el.id}`]) return true;
      }
    }
    return false;
  }, [rungs, compiledRloMap, blockName]);

  const handleInsertElementAt = useCallback(
    (rIdx: number, pos: number, type: LdElementType) => {
      const newEl = createElement(type, defaultBool, defaultNum);
      commitRungs(insertElementInRungs(rungs, rIdx, pos, newEl));
      setSelectedRungIdx(rIdx);
      setSelectedElIdx(pos);
    },
    [rungs, defaultBool, defaultNum, commitRungs]
  );

  const handleToolbarInsert = useCallback(
    (type: LdElementType) => {
      const rIdx = Math.min(selectedRungIdx, Math.max(0, rungs.length - 1));
      const len = rungs[rIdx]?.elements.length || 0;
      const pos = selectedElIdx !== null ? selectedElIdx + 1 : len;
      handleInsertElementAt(rIdx, pos, type);
    },
    [selectedRungIdx, selectedElIdx, rungs, handleInsertElementAt]
  );

  // Открытие контекстного меню: проверяем выделение текста ТОЛЬКО внутри input/textarea
  const handleOpenContextMenu = useCallback(
    (
      e: React.MouseEvent,
      targetType: 'ELEMENT' | 'PARALLEL' | 'RUNG',
      rungIdx: number,
      elIdx?: number,
      parIdx?: number
    ) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA') {
        const inp = tgt as HTMLInputElement;
        if (inp.selectionStart !== null && inp.selectionEnd !== null && inp.selectionStart !== inp.selectionEnd) {
          return; // Внутри input выделен фрагмент текста — оставляем нативное меню
        }
      }
      e.preventDefault();
      e.stopPropagation();
      setSelectedRungIdx(rungIdx);
      if (elIdx !== undefined) setSelectedElIdx(elIdx);
      setCtxMenu({ x: e.clientX, y: e.clientY, targetType, rungIdx, elIdx, parIdx });
    },
    []
  );

  // Генерация подменю со всеми типами элементов из PALETTE_GROUPS
  const buildPaletteSubmenu = (onPick: (t: LdElementType) => void): MenuItemSpec[] =>
    PALETTE_GROUPS.flatMap((grp) =>
      grp.items.map((item) => ({
        label: `${grp.group}: ${item.label}`,
        colorClass: grp.colorClass,
        onClick: () => onPick(item.type),
      }))
    );

  const menuSpec = useMemo((): { header: string; items: MenuItemSpec[] } | null => {
    if (!ctxMenu) return null;
    const { targetType, rungIdx, elIdx, parIdx } = ctxMenu;

    if (targetType === 'ELEMENT' && elIdx !== undefined) {
      const el = rungs[rungIdx]?.elements[elIdx];
      if (!el) return null;
      const items: MenuItemSpec[] = [
        {
          label: 'Вставить элемент перед...',
          submenu: buildPaletteSubmenu((t) => handleInsertElementAt(rungIdx, elIdx, t)),
        },
        {
          label: 'Вставить элемент после...',
          submenu: buildPaletteSubmenu((t) => handleInsertElementAt(rungIdx, elIdx + 1, t)),
        },
      ];

      if (canHaveParallel(el.type)) {
        items.push({
          label: 'Добавить параллельную ветку OR',
          colorClass: 'text-indigo-300',
          onClick: () =>
            commitRungs(addParallelToElement(rungs, rungIdx, elIdx, 'NO', defaultBool, defaultNum)),
        });
      }

      if (onForceTag && el.operand1.startsWith('"')) {
        const isBool = allTagsMap[el.operand1] === 'BOOL';
        if (isBool) {
          items.push(
            {
              label: 'Force TRUE (1)',
              colorClass: 'text-emerald-300',
              dividerBefore: true,
              onClick: () => onForceTag(el.operand1, 'true', true),
            },
            {
              label: 'Force FALSE (0)',
              colorClass: 'text-rose-300',
              onClick: () => onForceTag(el.operand1, 'false', true),
            }
          );
        } else {
          items.push({
            label: 'Задать значение Force...',
            colorClass: 'text-amber-300',
            dividerBefore: true,
            onClick: () => {
              const v = window.prompt(`Задать Force для ${el.operand1}:`, '1500');
              if (v !== null) onForceTag(el.operand1, v, true);
            },
          });
        }
        if (activeForces[el.operand1]?.active) {
          items.push({
            label: 'Снять Force (Unforce)',
            colorClass: 'text-rose-400 font-bold',
            onClick: () => onForceTag(el.operand1, '', false),
          });
        }
      }

      items.push(
        {
          label: 'Копировать',
          shortcut: 'Ctrl+C',
          dividerBefore: true,
          onClick: () => setClipboardEl(cloneElementWithNewIds(el)),
        },
        {
          label: 'Вырезать',
          shortcut: 'Ctrl+X',
          onClick: () => {
            setClipboardEl(cloneElementWithNewIds(el));
            commitRungs(removeElementFromRungs(rungs, rungIdx, elIdx));
          },
        }
      );

      if (clipboardEl) {
        items.push({
          label: 'Вставить после',
          shortcut: 'Ctrl+V',
          onClick: () =>
            commitRungs(insertElementInRungs(rungs, rungIdx, elIdx + 1, cloneElementWithNewIds(clipboardEl))),
        });
      }

      items.push(
        {
          label: 'Дублировать элемент',
          shortcut: 'Ctrl+D',
          onClick: () => commitRungs(insertElementInRungs(rungs, rungIdx, elIdx + 1, cloneElementWithNewIds(el))),
        },
        {
          label: 'Сдвинуть влево',
          dividerBefore: true,
          onClick: () => {
            const res = moveElementInRungs(rungs, rungIdx, elIdx, -1);
            commitRungs(res.rungs);
            setSelectedElIdx(res.newIdx);
          },
        },
        {
          label: 'Сдвинуть вправо',
          onClick: () => {
            const res = moveElementInRungs(rungs, rungIdx, elIdx, 1);
            commitRungs(res.rungs);
            setSelectedElIdx(res.newIdx);
          },
        },
        {
          label: 'Удалить элемент',
          shortcut: 'Del',
          colorClass: 'text-rose-400',
          onClick: () => commitRungs(removeElementFromRungs(rungs, rungIdx, elIdx)),
        }
      );

      return { header: `${el.type} (${shortLabelMap[el.operand1] || el.operand1})`, items };
    }

    if (targetType === 'PARALLEL' && elIdx !== undefined && parIdx !== undefined) {
      const el = rungs[rungIdx]?.elements[elIdx];
      return {
        header: `Параллельная ветка OR #${parIdx + 1}`,
        items: [
          {
            label: 'Добавить ещё одну ветку OR ниже',
            onClick: () =>
              commitRungs(addParallelToElement(rungs, rungIdx, elIdx, 'NO', defaultBool, defaultNum)),
          },
          {
            label: 'Удалить эту ветку OR',
            colorClass: 'text-rose-400',
            onClick: () => {
              if (!el?.parallel) return;
              const nextPar = el.parallel.filter((_, i) => i !== parIdx);
              commitRungs(updateElementInRungs(rungs, rungIdx, elIdx, { parallel: nextPar }));
            },
          },
        ],
      };
    }

    const rLen = rungs[rungIdx]?.elements.length || 0;
    return {
      header: `Цепь NW ${rungIdx + 1}`,
      items: [
        {
          label: 'Добавить элемент в цепь...',
          submenu: buildPaletteSubmenu((t) => handleInsertElementAt(rungIdx, rLen, t)),
        },
        {
          label: 'Вставить новую цепь выше',
          dividerBefore: true,
          onClick: () => commitRungs(insertRungAt(rungs, rungIdx)),
        },
        {
          label: 'Вставить новую цепь ниже',
          onClick: () => commitRungs(insertRungAt(rungs, rungIdx + 1)),
        },
        {
          label: 'Дублировать цепь',
          onClick: () => commitRungs(duplicateRungAt(rungs, rungIdx)),
        },
        {
          label: 'Переместить цепь вверх',
          onClick: () => commitRungs(moveRungInList(rungs, rungIdx, -1).rungs),
        },
        {
          label: 'Переместить цепь вниз',
          onClick: () => commitRungs(moveRungInList(rungs, rungIdx, 1).rungs),
        },
        {
          label: 'Удалить цепь',
          colorClass: 'text-rose-400',
          dividerBefore: true,
          onClick: () => commitRungs(rungs.filter((_, i) => i !== rungIdx)),
        },
      ],
    };
  }, [
    ctxMenu,
    rungs,
    defaultBool,
    defaultNum,
    allTagsMap,
    activeForces,
    shortLabelMap,
    clipboardEl,
    onForceTag,
    handleInsertElementAt,
    commitRungs,
    setClipboardEl,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      setCtxMenu({
        x: rect ? rect.left + 220 : 300,
        y: rect ? rect.top + 150 : 200,
        targetType: selectedElIdx !== null ? 'ELEMENT' : 'RUNG',
        rungIdx: selectedRungIdx,
        elIdx: selectedElIdx ?? undefined,
      });
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }

    if (selectedElIdx === null) return;
    const el = rungs[selectedRungIdx]?.elements[selectedElIdx];
    if (!el) return;

    if (e.key === 'Delete') {
      e.preventDefault();
      commitRungs(removeElementFromRungs(rungs, selectedRungIdx, selectedElIdx));
      setSelectedElIdx(null);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      setClipboardEl(cloneElementWithNewIds(el));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      setClipboardEl(cloneElementWithNewIds(el));
      commitRungs(removeElementFromRungs(rungs, selectedRungIdx, selectedElIdx));
      setSelectedElIdx(null);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboardEl) {
      e.preventDefault();
      commitRungs(
        insertElementInRungs(rungs, selectedRungIdx, selectedElIdx + 1, cloneElementWithNewIds(clipboardEl))
      );
      setSelectedElIdx(selectedElIdx + 1);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      commitRungs(insertElementInRungs(rungs, selectedRungIdx, selectedElIdx + 1, cloneElementWithNewIds(el)));
      setSelectedElIdx(selectedElIdx + 1);
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="bg-[#1e1e1e] border border-[#2d2d30] flex flex-col h-full overflow-hidden outline-none"
    >
      <datalist id="plc-bool-tags">
        {boolTags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="plc-num-tags">
        {numericTags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <LdToolbar
        blockName={blockName}
        canUndo={canUndo}
        canRedo={canRedo}
        monitoring={monitoring}
        isCoreRunning={isCoreRunning}
        isRloStale={isRloStale}
        onUndo={undo}
        onRedo={redo}
        onToggleMonitoring={() => setMonitoring((p) => !p)}
        onAddRung={() => commitRungs(insertRungAt(rungs, rungs.length))}
        onInsertElement={handleToolbarInsert}
      />

      <div className="flex-1 overflow-y-auto p-3 space-y-4 bg-[#141416]">
        {rungs.map((rung, rIdx) => (
          <LdRung
            key={rung.id}
            blockName={blockName}
            rung={rung}
            rIdx={rIdx}
            isRungSelected={rIdx === selectedRungIdx}
            selectedElIdx={rIdx === selectedRungIdx ? selectedElIdx : null}
            monitoring={monitoring}
            isCoreRunning={isCoreRunning}
            liveData={liveData}
            rloStatus={rloStatus}
            compiledRloMap={compiledRloMap}
            activeForces={activeForces}
            allTagsMap={allTagsMap}
            shortLabelMap={shortLabelMap}
            onSelectRung={(idx) => {
              setSelectedRungIdx(idx);
              setSelectedElIdx(null);
            }}
            onSelectElement={(rI, eI) => {
              setSelectedRungIdx(rI);
              setSelectedElIdx(eI);
            }}
            onRenameRung={(idx, title) =>
              commitRungs(rungs.map((r, i) => (i === idx ? { ...r, title } : r)))
            }
            onDeleteRung={(idx) => commitRungs(rungs.filter((_, i) => i !== idx))}
            onMoveElement={(rI, eI, dir) => {
              const res = moveElementInRungs(rungs, rI, eI, dir);
              commitRungs(res.rungs);
              setSelectedElIdx(res.newIdx);
            }}
            onAddParallel={(rI, eI) =>
              commitRungs(addParallelToElement(rungs, rI, eI, 'NO', defaultBool, defaultNum))
            }
            onRemoveElement={(rI, eI) => {
              commitRungs(removeElementFromRungs(rungs, rI, eI));
              setSelectedElIdx(null);
            }}
            onUpdateElement={(rI, eI, patch) => commitRungs(updateElementInRungs(rungs, rI, eI, patch))}
            onContextMenu={handleOpenContextMenu}
          />
        ))}
      </div>

      {ctxMenu && menuSpec && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          header={menuSpec.header}
          items={menuSpec.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
};
