import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type {
  DataBlock,
  LiveDbSnapshot,
  LdProgramData,
  LdRung,
  LdElement,
  LdElementType,
  ForceEntry,
} from '../types/plc';
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Zap,
  ZapOff,
  Undo2,
  Redo2,
  ArrowLeft,
  ArrowRight,
  GitBranch,
  Copy,
  Scissors,
  ClipboardPaste,
} from 'lucide-react';

// === ЕДИНЫЕ КОНСТАНТЫ ГЕОМЕТРИИ ЦЕПИ (ИСКЛЮЧАЮТ СТУПЕНЬКИ ПРОВОДА) ===
const TAG_H = 28; // Высота строки тега над контактом И высота шапки функционального блока
const PIN_ROW_H = 48; // Высота SVG контакта/катушки И высота строки EN/ENO у блока
const WIRE_Y = TAG_H + PIN_ROW_H / 2; // 28 + 24 = 52px — Единая ось провода от верха ячейки
const BRANCH_STEP_Y = TAG_H + PIN_ROW_H; // 76px — Полная высота одной параллельной ветки OR

interface LdEditorProps {
  blockName: string;
  code: string;
  datablocks: DataBlock[];
  liveData: LiveDbSnapshot;
  rloStatus: boolean[];
  isCoreRunning: boolean;
  activeForces?: Record<string, ForceEntry>;
  onForceTag?: (fullTag: string, value: string, active: boolean) => void;
  onChange: (newJsonCode: string) => void;
}

const DEFAULT_LD: LdProgramData = {
  rungs: [
    {
      id: 'rung_1',
      title: 'Цепь 1: Контроль разрешения линии и ограничение скорости',
      elements: [
        { id: 'el_1', type: 'NO', operand1: '"Line_Params".Line_Enable' },
        { id: 'el_2', type: 'CMP_GE', operand1: '"Line_Params".Target_Speed', operand2: '3000.0' },
        { id: 'el_3', type: 'ADD', operand1: '100', operand2: '1', operand3: '"Line_Params".Error_Code' },
      ],
    },
  ],
};

// Компонент умного поля тега: без фокуса показывает короткое имя (или DB.Var при коллизии), при фокусе — полный тег
const SmartTagInput: React.FC<{
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

interface ContextMenuState {
  x: number;
  y: number;
  targetType: 'ELEMENT' | 'PARALLEL' | 'RUNG';
  rungIdx: number;
  elIdx?: number;
  parIdx?: number;
}

export const LdEditor: React.FC<LdEditorProps> = ({
  blockName,
  code,
  datablocks,
  liveData,
  rloStatus,
  isCoreRunning,
  activeForces = {},
  onForceTag,
  onChange,
}) => {
  const [selectedRungIdx, setSelectedRungIdx] = useState<number>(0);
  const [selectedElIdx, setSelectedElIdx] = useState<number | null>(null);
  const [monitoring, setMonitoring] = useState<boolean>(true);
  const [history, setHistory] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [clipboardEl, setClipboardEl] = useState<LdElement | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuElRef = useRef<HTMLDivElement | null>(null);

  // Мемоизированный колбэк ref для портала контекстного меню (предотвращает сброс при ререндере)
  const setPortalMenuRef = useCallback((node: HTMLDivElement | null) => {
    menuElRef.current = node;
  }, []);

  const ldData: LdProgramData = useMemo(() => {
    try {
      const parsed = JSON.parse(code);
      if (parsed && Array.isArray(parsed.rungs)) return parsed;
    } catch {
      // Fallback
    }
    return DEFAULT_LD;
  }, [code]);

  // Построение списков тегов и карты коротких имён (если имя уникально -> Var, если в нескольких DB -> DB.Var)
  const { boolTags, numericTags, allTagsMap, shortLabelMap } = useMemo(() => {
    const bTags: string[] = [];
    const nTags: string[] = [];
    const tMap: Record<string, string> = {};
    const nameCounts: Record<string, number> = {};

    datablocks.forEach((db) => {
      db.variables.forEach((v) => {
        nameCounts[v.name] = (nameCounts[v.name] || 0) + 1;
      });
    });

    const sMap: Record<string, string> = {};
    datablocks.forEach((db) => {
      db.variables.forEach((v) => {
        const full = `"${db.name}".${v.name}`;
        tMap[full] = v.type;
        sMap[full] = nameCounts[v.name] > 1 ? `${db.name}.${v.name}` : v.name;
        if (v.type === 'BOOL') bTags.push(full);
        else nTags.push(full);
      });
    });
    return { boolTags: bTags, numericTags: nTags, allTagsMap: tMap, shortLabelMap: sMap };
  }, [datablocks]);

  // Детерминированная сквозная карта RLO (1-в-1 повторяет счётчик компилятора Go)
  const rloMap = useMemo(() => {
    const mainMap: Record<string, number> = {};
    const parMap: Record<string, number[]> = {};
    const rungLastMainRlo: Record<number, number> = {};
    let seq = 1;
    const next = () => {
      const id = seq;
      if (seq < 1020) seq++;
      return id;
    };

    ldData.rungs.forEach((rung, rIdx) => {
      let lastId = 0;
      rung.elements.forEach((el, eIdx) => {
        const key = `${rIdx}_${eIdx}`;
        const mId = next();
        mainMap[key] = mId;
        lastId = mId;
        const pIds: number[] = [];
        (el.parallel || []).forEach(() => {
          pIds.push(next());
        });
        parMap[key] = pIds;
      });
      rungLastMainRlo[rIdx] = lastId;
    });

    return { mainMap, parMap, rungLastMainRlo };
  }, [ldData]);

  const commitRungs = useCallback(
    (newRungs: LdRung[]) => {
      setHistory((prev) => [...prev.slice(-30), code]);
      setRedoStack([]);
      onChange(JSON.stringify({ rungs: newRungs }, null, 2));
    },
    [code, onChange]
  );

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack((r) => [code, ...r]);
    setHistory((h) => h.slice(0, -1));
    onChange(prev);
  }, [history, code, onChange]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setHistory((h) => [...h, code]);
    setRedoStack((r) => r.slice(1));
    onChange(next);
  }, [redoStack, code, onChange]);

  const isContactType = (t: LdElementType) => ['NO', 'NC', 'P_TRIG', 'N_TRIG'].includes(t);
  const isCmpType = (t: LdElementType) =>
    ['CMP_EQ', 'CMP_NE', 'CMP_GT', 'CMP_LT', 'CMP_GE', 'CMP_LE'].includes(t);
  const canHaveParallel = (t: LdElementType) => isContactType(t) || isCmpType(t);
  const isCoilType = (t: LdElementType) => ['COIL', 'COIL_SET', 'COIL_RESET', 'COIL_INV'].includes(t);
  const isBoxType = (t: LdElementType) => !isContactType(t) && !isCoilType(t);

  const createDefaultElement = useCallback(
    (type: LdElementType): LdElement => {
      const defaultBool = boolTags[0] || '"Line_Params".Line_Enable';
      const defaultNum = numericTags[0] || '"Line_Params".Target_Speed';
      return {
        id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type,
        operand1: ['TON', 'TOF'].includes(type)
          ? '1000'
          : isContactType(type) || isCoilType(type) || ['CTU', 'CTD'].includes(type)
          ? defaultBool
          : defaultNum,
        operand2: [
          'CMP_EQ',
          'CMP_NE',
          'CMP_GT',
          'CMP_LT',
          'CMP_GE',
          'CMP_LE',
          'ADD',
          'SUB',
          'MUL',
          'DIV',
        ].includes(type)
          ? '100.0'
          : ['CTU', 'CTD'].includes(type)
          ? '10'
          : undefined,
        operand3: ['ADD', 'SUB', 'MUL', 'DIV', 'CTU', 'CTD'].includes(type)
          ? defaultNum
          : ['TON', 'TOF'].includes(type)
          ? defaultBool
          : undefined,
      };
    },
    [boolTags, numericTags]
  );

  const insertElementAt = useCallback(
    (rungIdx: number, insertPos: number, type: LdElementType) => {
      if (ldData.rungs.length === 0) return;
      const newEl = createDefaultElement(type);
      const updated = ldData.rungs.map((r, i) => {
        if (i !== rungIdx) return r;
        const els = [...r.elements];
        const clamped = Math.max(0, Math.min(els.length, insertPos));
        els.splice(clamped, 0, newEl);
        return { ...r, elements: els };
      });
      commitRungs(updated);
      setSelectedRungIdx(rungIdx);
      setSelectedElIdx(insertPos);
    },
    [ldData.rungs, createDefaultElement, commitRungs]
  );

  const insertElementToolbar = (type: LdElementType) => {
    const rIdx = Math.min(selectedRungIdx, Math.max(0, ldData.rungs.length - 1));
    const currentEls = ldData.rungs[rIdx]?.elements || [];
    const pos = selectedElIdx !== null ? selectedElIdx + 1 : currentEls.length;
    insertElementAt(rIdx, pos, type);
  };

  const addRungAt = (pos: number) => {
    const nextNum = ldData.rungs.length + 1;
    const newRung: LdRung = {
      id: `rung_${Date.now()}`,
      title: `Цепь ${nextNum}: Логическая цепь`,
      elements: [],
    };
    const updated = [...ldData.rungs];
    updated.splice(pos, 0, newRung);
    commitRungs(updated);
    setSelectedRungIdx(pos);
    setSelectedElIdx(null);
  };

  const duplicateRung = (rIdx: number) => {
    const src = ldData.rungs[rIdx];
    if (!src) return;
    const copy: LdRung = JSON.parse(JSON.stringify(src));
    copy.id = `rung_${Date.now()}`;
    copy.title = `${src.title} (Копия)`;
    const updated = [...ldData.rungs];
    updated.splice(rIdx + 1, 0, copy);
    commitRungs(updated);
    setSelectedRungIdx(rIdx + 1);
  };

  const moveRung = (rIdx: number, dir: -1 | 1) => {
    const target = rIdx + dir;
    if (target < 0 || target >= ldData.rungs.length) return;
    const updated = [...ldData.rungs];
    const [item] = updated.splice(rIdx, 1);
    updated.splice(target, 0, item);
    commitRungs(updated);
    setSelectedRungIdx(target);
  };

  const deleteRung = (idx: number) => {
    const updated = ldData.rungs.filter((_, i) => i !== idx);
    commitRungs(updated);
    setSelectedRungIdx(Math.max(0, updated.length - 1));
    setSelectedElIdx(null);
  };

  const addParallelBranch = (rungIdx: number, elIdx: number, branchType: LdElementType = 'NO') => {
    const defaultBool = boolTags[0] || '"Line_Params".Line_Enable';
    const defaultNum = numericTags[0] || '"Line_Params".Target_Speed';
    const updated = ldData.rungs.map((r, rI) => {
      if (rI !== rungIdx) return r;
      const newEls = r.elements.map((el, eI) => {
        if (eI !== elIdx || !canHaveParallel(el.type)) return el;
        const par = el.parallel ? [...el.parallel] : [];
        par.push({
          id: `par_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          type: branchType,
          operand1: isCmpType(branchType) ? defaultNum : defaultBool,
          operand2: isCmpType(branchType) ? '100.0' : undefined,
        });
        return { ...el, parallel: par };
      });
      return { ...r, elements: newEls };
    });
    commitRungs(updated);
  };

  const moveElement = (rungIdx: number, elIdx: number, dir: -1 | 1) => {
    const updated = ldData.rungs.map((r, rI) => {
      if (rI !== rungIdx) return r;
      const target = elIdx + dir;
      if (target < 0 || target >= r.elements.length) return r;
      const els = [...r.elements];
      const [item] = els.splice(elIdx, 1);
      els.splice(target, 0, item);
      return { ...r, elements: els };
    });
    commitRungs(updated);
    setSelectedElIdx(elIdx + dir);
  };

  const duplicateElement = (rungIdx: number, elIdx: number) => {
    const el = ldData.rungs[rungIdx]?.elements[elIdx];
    if (!el) return;
    const copy: LdElement = JSON.parse(JSON.stringify(el));
    copy.id = `el_${Date.now()}`;
    const updated = ldData.rungs.map((r, rI) => {
      if (rI !== rungIdx) return r;
      const els = [...r.elements];
      els.splice(elIdx + 1, 0, copy);
      return { ...r, elements: els };
    });
    commitRungs(updated);
    setSelectedElIdx(elIdx + 1);
  };

  const updateElement = (rungIdx: number, elIdx: number, patch: Partial<LdElement>) => {
    const updated = ldData.rungs.map((r, rI) => {
      if (rI !== rungIdx) return r;
      return {
        ...r,
        elements: r.elements.map((el, eI) => (eI === elIdx ? { ...el, ...patch } : el)),
      };
    });
    commitRungs(updated);
  };

  const removeElement = (rungIdx: number, elIdx: number) => {
    const updated = ldData.rungs.map((r, rI) => {
      if (rI !== rungIdx) return r;
      return { ...r, elements: r.elements.filter((_, eI) => eI !== elIdx) };
    });
    commitRungs(updated);
    setSelectedElIdx(null);
  };

  // Закрытие контекстного меню по Esc, клику вне, скроллу и ресайзу
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (menuElRef.current && !menuElRef.current.contains(e.target as Node)) {
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [ctxMenu]);

  // Горячие клавиши редактора: Del, Ctrl+C/X/V/D, Shift+F10 / ContextMenu
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const activeTag = document.activeElement?.tagName.toLowerCase();
    if (activeTag === 'input' || activeTag === 'select' || activeTag === 'textarea') {
      return;
    }

    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      const x = rect ? rect.left + 220 : 300;
      const y = rect ? rect.top + 160 : 220;
      setCtxMenu({
        x,
        y,
        targetType: selectedElIdx !== null ? 'ELEMENT' : 'RUNG',
        rungIdx: selectedRungIdx,
        elIdx: selectedElIdx ?? undefined,
      });
      return;
    }

    if (selectedElIdx === null) return;
    const currentEl = ldData.rungs[selectedRungIdx]?.elements[selectedElIdx];
    if (!currentEl) return;

    if (e.key === 'Delete') {
      e.preventDefault();
      removeElement(selectedRungIdx, selectedElIdx);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      setClipboardEl(JSON.parse(JSON.stringify(currentEl)));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      setClipboardEl(JSON.parse(JSON.stringify(currentEl)));
      removeElement(selectedRungIdx, selectedElIdx);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboardEl) {
      e.preventDefault();
      const copy: LdElement = JSON.parse(JSON.stringify(clipboardEl));
      copy.id = `el_${Date.now()}`;
      const updated = ldData.rungs.map((r, rI) => {
        if (rI !== selectedRungIdx) return r;
        const els = [...r.elements];
        els.splice(selectedElIdx + 1, 0, copy);
        return { ...r, elements: els };
      });
      commitRungs(updated);
      setSelectedElIdx(selectedElIdx + 1);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateElement(selectedRungIdx, selectedElIdx);
    }
  };

  // Открытие контекстного меню с проверкой выделенного текста в input
  const openContextMenu = (
    e: React.MouseEvent,
    targetType: 'ELEMENT' | 'PARALLEL' | 'RUNG',
    rungIdx: number,
    elIdx?: number,
    parIdx?: number
  ) => {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) {
      return; // Оставляем нативное меню браузера, если выделен текст
    }
    e.preventDefault();
    e.stopPropagation();

    setSelectedRungIdx(rungIdx);
    if (elIdx !== undefined) setSelectedElIdx(elIdx);

    const menuW = 250;
    const menuH = 320;
    const clampedX = Math.max(8, Math.min(e.clientX, window.innerWidth - menuW - 8));
    const clampedY = Math.max(8, Math.min(e.clientY, window.innerHeight - menuH - 8));

    setCtxMenu({
      x: clampedX,
      y: clampedY,
      targetType,
      rungIdx,
      elIdx,
      parIdx,
    });
  };

  // SVG одного контакта или катушки (строго 160 x 48, провод на y = 24)
  const renderSingleSymbolSvg = (
    type: LdElementType,
    wireInHot: boolean,
    wireOutHot: boolean,
    isParallelChild = false,
    isLastParallel = false
  ) => {
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
    if (isCmpType(type)) {
      ch = type.replace('CMP_', '');
    }

    return (
      <svg width="160" height={PIN_ROW_H} viewBox="0 0 160 48" className="block overflow-visible shrink-0">
        {!isParallelChild ? (
          <>
            <line x1="0" y1="24" x2="62" y2="24" stroke={inColor} strokeWidth="2.5" />
            <line x1="98" y1="24" x2="160" y2="24" stroke={outColor} strokeWidth="2.5" />
          </>
        ) : (
          <>
            {/* Вертикальные стойки параллельного шунта OR, поднимающиеся на BRANCH_STEP_Y (76px) к предыдущему уровню */}
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

      {/* Верхняя панель и палитра элементов LD */}
      <div className="bg-[#252526] border-b border-[#2d2d30] p-2.5 flex flex-col gap-2 select-none">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Zap size={15} className="text-amber-400" />
              <span className="font-semibold text-white text-sm">{blockName}</span>
              <span className="text-[#a1a1aa] font-mono">[LD / Релейно-контактная схема]</span>
            </div>

            <div className="flex items-center gap-1 border-l border-[#3e3e42] pl-3">
              <button
                onClick={handleUndo}
                disabled={history.length === 0}
                className="p-1 rounded bg-[#2d2d30] hover:bg-[#3e3e42] disabled:opacity-40 text-white"
                title="Отменить (Ctrl+Z)"
              >
                <Undo2 size={14} />
              </button>
              <button
                onClick={handleRedo}
                disabled={redoStack.length === 0}
                className="p-1 rounded bg-[#2d2d30] hover:bg-[#3e3e42] disabled:opacity-40 text-white"
                title="Повторить (Ctrl+Y)"
              >
                <Redo2 size={14} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setMonitoring((p) => !p)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono border transition ${
                monitoring && isCoreRunning
                  ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/50'
                  : 'bg-[#2d2d30] text-[#a1a1aa] border-[#3e3e42]'
              }`}
            >
              {monitoring && isCoreRunning ? <Eye size={14} className="text-emerald-400" /> : <EyeOff size={14} />}
              <span>Мониторинг RLO: {monitoring && isCoreRunning ? 'ВКЛ' : 'ВЫКЛ'}</span>
            </button>

            <button
              onClick={() => addRungAt(ldData.rungs.length)}
              className="flex items-center gap-1 px-3 py-1 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-xs font-medium transition"
            >
              <Plus size={14} /> Добавить цепь
            </button>
          </div>
        </div>

        {/* Палитра компонентов LD */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[#333333] font-mono text-xs">
          <span className="text-[#a1a1aa] mr-1">Контакты:</span>
          {([
            { t: 'NO', l: '┤ ├ NO' },
            { t: 'NC', l: '┤/├ NC' },
            { t: 'P_TRIG', l: '┤P├ P_TRIG' },
            { t: 'N_TRIG', l: '┤N├ N_TRIG' },
          ] as { t: LdElementType; l: string }[]).map((item) => (
            <button
              key={item.t}
              onClick={() => insertElementToolbar(item.t)}
              className="px-2 py-1 bg-[#2d2d30] hover:bg-[#094771] text-sky-300 hover:text-white border border-[#3e3e42] rounded transition"
            >
              {item.l}
            </button>
          ))}

          <span className="text-[#52525b] mx-1">|</span>
          <span className="text-[#a1a1aa] mr-1">Катушки:</span>
          {([
            { t: 'COIL', l: '( ) Coil' },
            { t: 'COIL_SET', l: '(S) Set' },
            { t: 'COIL_RESET', l: '(R) Reset' },
            { t: 'COIL_INV', l: '(/) Inv' },
          ] as { t: LdElementType; l: string }[]).map((item) => (
            <button
              key={item.t}
              onClick={() => insertElementToolbar(item.t)}
              className="px-2 py-1 bg-[#2d2d30] hover:bg-[#094771] text-orange-300 hover:text-white border border-[#3e3e42] rounded transition"
            >
              {item.l}
            </button>
          ))}

          <span className="text-[#52525b] mx-1">|</span>
          <span className="text-[#a1a1aa] mr-1">Таймеры / Счётчики:</span>
          {(['TON', 'TOF', 'CTU', 'CTD'] as LdElementType[]).map((t) => (
            <button
              key={t}
              onClick={() => insertElementToolbar(t)}
              className="px-2 py-1 bg-[#2d2d30] hover:bg-[#094771] text-amber-300 hover:text-white border border-[#3e3e42] rounded transition"
            >
              [{t}]
            </button>
          ))}

          <span className="text-[#52525b] mx-1">|</span>
          <span className="text-[#a1a1aa] mr-1">Сравнение:</span>
          {([
            { t: 'CMP_EQ', l: '==' },
            { t: 'CMP_NE', l: '!=' },
            { t: 'CMP_GT', l: '>' },
            { t: 'CMP_LT', l: '<' },
            { t: 'CMP_GE', l: '>=' },
            { t: 'CMP_LE', l: '<=' },
          ] as { t: LdElementType; l: string }[]).map((item) => (
            <button
              key={item.t}
              onClick={() => insertElementToolbar(item.t)}
              className="px-2 py-1 bg-[#2d2d30] hover:bg-[#094771] text-purple-300 hover:text-white border border-[#3e3e42] rounded transition"
            >
              [{item.l}]
            </button>
          ))}

          <span className="text-[#52525b] mx-1">|</span>
          <span className="text-[#a1a1aa] mr-1">Арифметика:</span>
          {(['ADD', 'SUB', 'MUL', 'DIV'] as LdElementType[]).map((t) => (
            <button
              key={t}
              onClick={() => insertElementToolbar(t)}
              className="px-2 py-1 bg-[#2d2d30] hover:bg-[#094771] text-emerald-300 hover:text-white border border-[#3e3e42] rounded transition"
            >
              [{t}]
            </button>
          ))}
        </div>
      </div>

      {/* Рабочая область цепей */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 bg-[#141416]">
        {ldData.rungs.map((rung, rIdx) => {
          const isRungSelected = rIdx === selectedRungIdx;
          const endRloIdx = rloMap.rungLastMainRlo[rIdx] || 0;
          const endWireHot = isCoreRunning && monitoring && (endRloIdx === 0 ? false : Boolean(rloStatus[endRloIdx]));

          return (
            <div
              key={rung.id}
              onClick={() => {
                setSelectedRungIdx(rIdx);
                setSelectedElIdx(null);
              }}
              onContextMenu={(e) => openContextMenu(e, 'RUNG', rIdx)}
              className={`border rounded-md transition ${
                isRungSelected
                  ? 'border-[#3b82f6] bg-[#1c1c1f] ring-1 ring-[#3b82f6]/50 shadow-lg'
                  : 'border-[#2d2d30] bg-[#18181b]'
              }`}
            >
              {/* Заголовок цепи (без двусмысленной метки АКТИВНА) */}
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
                    onChange={(e) => {
                      const updated = ldData.rungs.map((r, i) =>
                        i === rIdx ? { ...r, title: e.target.value } : r
                      );
                      commitRungs(updated);
                    }}
                    className="bg-transparent text-xs text-white font-medium outline-none focus:bg-[#333333] px-2 py-0.5 rounded w-full max-w-xl"
                  />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteRung(rIdx);
                  }}
                  className="text-[#a1a1aa] hover:text-rose-400 p-1 transition"
                  title="Удалить цепь"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Полотно электрической цепи: верхний отступ pt-7 под панель быстрых действий, ось провода ровно на WIRE_Y = 52px */}
              <div className="px-4 pt-7 pb-5 overflow-x-auto flex items-stretch min-h-[160px] font-mono">
                {/* Левая силовая шина L+ */}
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
                      const mapKey = `${rIdx}_${eIdx}`;
                      const mainRloIdx = rloMap.mainMap[mapKey] || 0;
                      const parRloList = rloMap.parMap[mapKey] || [];
                      const prevKey = `${rIdx}_${eIdx - 1}`;
                      const prevRloIdx = eIdx === 0 ? 0 : rloMap.mainMap[prevKey] || 0;

                      const wireInHot =
                        isCoreRunning && monitoring && (eIdx === 0 ? true : Boolean(rloStatus[prevRloIdx]));
                      const mainOutHot = isCoreRunning && monitoring && Boolean(rloStatus[mainRloIdx]);
                      const anyParHot =
                        isCoreRunning &&
                        monitoring &&
                        parRloList.some((pId) => Boolean(rloStatus[pId]));
                      const cellOutHot = mainOutHot || anyParHot;

                      const isElSelected = isRungSelected && selectedElIdx === eIdx;

                      const val1 = liveData[el.operand1];
                      const val2 = el.operand2 ? liveData[el.operand2] : undefined;
                      const val3 = el.operand3 ? liveData[el.operand3] : undefined;

                      const tagType1 = allTagsMap[el.operand1];
                      const typeMismatch =
                        (isContactType(el.type) || isCoilType(el.type)) &&
                        Boolean(tagType1) &&
                        tagType1 !== 'BOOL';

                      // Если последним элементом стоит катушка, растягиваем провод перед ней до правого края
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

                          {/* Ячейка элемента: без горизонтальных padding (px-0), выделение через ring */}
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRungIdx(rIdx);
                              setSelectedElIdx(eIdx);
                            }}
                            onContextMenu={(e) => openContextMenu(e, 'ELEMENT', rIdx, eIdx)}
                            className={`flex flex-col items-center relative group rounded transition ${
                              isElSelected ? 'ring-2 ring-sky-400 bg-sky-950/15' : ''
                            }`}
                          >
                            {/* Всплывающая панель быстрых действий ВНЕ потока (absolute -top-6), не сдвигает провод! */}
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 h-5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition z-20 bg-[#252526] border border-[#3e3e42] px-1 rounded shadow-md">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveElement(rIdx, eIdx, -1);
                                }}
                                className="p-0.5 hover:bg-[#3e3e42] text-white rounded"
                                title="Сдвинуть влево"
                              >
                                <ArrowLeft size={11} />
                              </button>
                              {canHaveParallel(el.type) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    addParallelBranch(rIdx, eIdx, 'NO');
                                  }}
                                  className="px-1 bg-indigo-700 hover:bg-indigo-600 text-white rounded text-[10px] flex items-center gap-0.5"
                                  title="Добавить параллельную ветку OR"
                                >
                                  <GitBranch size={10} /> +OR
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveElement(rIdx, eIdx, 1);
                                }}
                                className="p-0.5 hover:bg-[#3e3e42] text-white rounded"
                                title="Сдвинуть вправо"
                              >
                                <ArrowRight size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeElement(rIdx, eIdx);
                                }}
                                className="p-0.5 hover:bg-rose-700 text-rose-300 hover:text-white rounded"
                                title="Удалить (Del)"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>

                            {!isBoxType(el.type) ? (
                              /* === 1. КОНТАКТЫ И КАТУШКИ + ИХ ПАРАЛЛЕЛЬНЫЕ ВЕТКИ OR === */
                              <div className="flex flex-col items-center w-[160px]">
                                {/* Строка тега строго высотой TAG_H = 28px */}
                                <div
                                  style={{ height: TAG_H }}
                                  className="w-full px-2 flex items-center justify-center"
                                >
                                  <SmartTagInput
                                    value={el.operand1}
                                    listId="plc-bool-tags"
                                    shortLabelMap={shortLabelMap}
                                    hasError={typeMismatch}
                                    errorTitle={
                                      typeMismatch
                                        ? `Ошибка типа: контакт требует BOOL, выбран ${tagType1}`
                                        : undefined
                                    }
                                    isForced={activeForces[el.operand1]?.active}
                                    className="w-full text-center py-0.5"
                                    onChange={(val) => updateElement(rIdx, eIdx, { operand1: val })}
                                  />
                                </div>

                                {/* SVG контакта/катушки высотой PIN_ROW_H = 48px (линия на y=24 -> 28+24 = 52px) */}
                                {renderSingleSymbolSvg(el.type, wireInHot, mainOutHot)}

                                {/* Подпись типа и живого значения под основным контактом */}
                                <div className="flex items-center gap-1.5 text-[11px] text-[#a1a1aa] -mt-1">
                                  <span>{el.type}</span>
                                  {isCoreRunning && val1 !== undefined && (
                                    <span className="px-1.5 rounded bg-[#27272a] text-emerald-300 font-bold">
                                      ={String(val1)}
                                    </span>
                                  )}
                                </div>

                                {/* Параллельные ветки OR: у КАЖДОЙ ветки поле тега стоит прямо над её собственным символом контакта! */}
                                {el.parallel &&
                                  el.parallel.map((par, pIdx) => {
                                    const parRloId = parRloList[pIdx] || 0;
                                    const parHot = isCoreRunning && monitoring && Boolean(rloStatus[parRloId]);
                                    const isLastPar = pIdx === el.parallel!.length - 1;

                                    return (
                                      <div
                                        key={par.id}
                                        onContextMenu={(e) =>
                                          openContextMenu(e, 'PARALLEL', rIdx, eIdx, pIdx)
                                        }
                                        className="flex flex-col items-center w-[160px] mt-1 relative group/par"
                                      >
                                        {/* Поле тега прямо над контактом параллельной ветки (высота TAG_H = 28px) */}
                                        <div
                                          style={{ height: TAG_H }}
                                          className="w-[126px] flex items-center gap-1 z-10"
                                        >
                                          <select
                                            value={par.type}
                                            onChange={(e) => {
                                              const nextPar = el.parallel!.map((p, i) =>
                                                i === pIdx
                                                  ? { ...p, type: e.target.value as LdElementType }
                                                  : p
                                              );
                                              updateElement(rIdx, eIdx, { parallel: nextPar });
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
                                            isForced={activeForces[par.operand1]?.active}
                                            className="flex-1 py-0.5 text-center"
                                            onChange={(val) => {
                                              const nextPar = el.parallel!.map((p, i) =>
                                                i === pIdx ? { ...p, operand1: val } : p
                                              );
                                              updateElement(rIdx, eIdx, { parallel: nextPar });
                                            }}
                                          />
                                        </div>

                                        {/* SVG контакта параллельной ветки с собственным RLO */}
                                        {renderSingleSymbolSvg(par.type, wireInHot, parHot, true, isLastPar)}
                                      </div>
                                    );
                                  })}
                              </div>
                            ) : (
                              /* === 2. ФУНКЦИОНАЛЬНЫЙ БЛОК: ШАПКА TAG_H (28px) + СТРОКА EN/ENO PIN_ROW_H (48px) === */
                              <div className="flex items-start">
                                {/* Левый подводящий провод строго на высоте WIRE_Y = 52px */}
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
                                    cellOutHot
                                      ? 'border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                                      : 'border-[#45454a]'
                                  }`}
                                >
                                  {/* Шапка блока ровно TAG_H = 28px */}
                                  <div
                                    style={{ height: TAG_H }}
                                    className="px-2.5 bg-[#2d2d32] border-b border-[#3e3e42] flex justify-between items-center text-xs font-bold text-amber-300"
                                  >
                                    <span>{el.type}</span>
                                    <span className="text-[10px] text-[#a1a1aa] font-normal">FBD/LD Box</span>
                                  </div>

                                  {/* Строка пинов EN ─── ENO ровно PIN_ROW_H = 48px (её середина 28+24 = 52px совпадает с WIRE_Y!) */}
                                  <div
                                    style={{ height: PIN_ROW_H }}
                                    className="px-2.5 bg-[#1b1b1e] border-b border-[#2e2e34] flex items-center justify-between text-xs font-bold"
                                  >
                                    <span className={wireInHot ? 'text-emerald-400' : 'text-[#71717a]'}>● EN</span>
                                    <div
                                      className={`flex-1 mx-3 h-[2px] ${
                                        cellOutHot ? 'bg-emerald-500/80' : 'bg-[#3f3f46]'
                                      }`}
                                    />
                                    <span className={cellOutHot ? 'text-emerald-400' : 'text-[#71717a]'}>ENO ●</span>
                                  </div>

                                  {/* Поля операндов: живое значение выводится в ТОЙ ЖЕ строке справа с фиксированной шириной */}
                                  <div className="p-2 space-y-1.5 text-xs">
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-12 text-[#a1a1aa] text-[11px] shrink-0">
                                        {['TON', 'TOF'].includes(el.type)
                                          ? 'PT(ms):'
                                          : ['CTU', 'CTD'].includes(el.type)
                                          ? 'CU/CD:'
                                          : 'IN1:'}
                                      </span>
                                      <SmartTagInput
                                        value={el.operand1}
                                        listId={['CTU', 'CTD'].includes(el.type) ? 'plc-bool-tags' : 'plc-num-tags'}
                                        shortLabelMap={shortLabelMap}
                                        isForced={activeForces[el.operand1]?.active}
                                        className="flex-1 py-0.5"
                                        onChange={(val) => updateElement(rIdx, eIdx, { operand1: val })}
                                      />
                                      <span className="w-16 text-right text-[11px] text-emerald-300 font-bold truncate shrink-0">
                                        {isCoreRunning && val1 !== undefined ? `=${String(val1)}` : ''}
                                      </span>
                                    </div>

                                    {el.operand2 !== undefined && (
                                      <div className="flex items-center gap-1.5">
                                        <span className="w-12 text-[#a1a1aa] text-[11px] shrink-0">
                                          {['CTU', 'CTD'].includes(el.type) ? 'PV:' : 'IN2:'}
                                        </span>
                                        <SmartTagInput
                                          value={el.operand2}
                                          listId="plc-num-tags"
                                          shortLabelMap={shortLabelMap}
                                          isForced={activeForces[el.operand2]?.active}
                                          className="flex-1 py-0.5"
                                          onChange={(val) => updateElement(rIdx, eIdx, { operand2: val })}
                                        />
                                        <span className="w-16 text-right text-[11px] text-emerald-300 font-bold truncate shrink-0">
                                          {isCoreRunning && val2 !== undefined ? `=${String(val2)}` : ''}
                                        </span>
                                      </div>
                                    )}

                                    {el.operand3 !== undefined && (
                                      <div className="pt-1 border-t border-[#333338] flex items-center gap-1.5">
                                        <span className="w-12 text-amber-400 text-[11px] font-bold shrink-0">OUT:</span>
                                        <SmartTagInput
                                          value={el.operand3}
                                          listId={['TON', 'TOF'].includes(el.type) ? 'plc-bool-tags' : 'plc-num-tags'}
                                          shortLabelMap={shortLabelMap}
                                          isForced={activeForces[el.operand3]?.active}
                                          className="flex-1 py-0.5"
                                          onChange={(val) => updateElement(rIdx, eIdx, { operand3: val })}
                                        />
                                        <span className="w-16 text-right text-[11px] text-amber-300 font-bold truncate shrink-0">
                                          {isCoreRunning && val3 !== undefined ? `=${String(val3)}` : ''}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Правый отводящий провод от ENO строго на высоте WIRE_Y = 52px */}
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
                            )}
                          </div>
                        </React.Fragment>
                      );
                    })}

                    {/* Замыкающий провод от последнего элемента до правой шины питания (на высоте WIRE_Y = 52px) */}
                    <div
                      style={{ marginTop: WIRE_Y - 1 }}
                      className={`flex-1 min-w-[28px] h-[2.5px] ${
                        endWireHot ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-[#71717a]'
                      }`}
                    />
                  </div>
                )}

                {/* Правая шина питания L- (без ml-auto, провод соединяется с ней напрямую) */}
                <div
                  className={`w-1.5 rounded-full shrink-0 ${
                    endWireHot ? 'bg-emerald-500/80' : 'bg-[#71717a]'
                  }`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* === ПОРТАЛ КОНТЕКСТНОГО МЕНЮ ПКМ (В document.body) === */}
      {ctxMenu &&
        createPortal(
          <div
            ref={setPortalMenuRef}
            style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
            className="w-64 bg-[#252526] border border-[#45454a] rounded-md shadow-2xl py-1.5 text-xs font-sans text-[#e4e4e7] select-none"
          >
            {ctxMenu.targetType === 'ELEMENT' && ctxMenu.elIdx !== undefined && (() => {
              const el = ldData.rungs[ctxMenu.rungIdx]?.elements[ctxMenu.elIdx];
              if (!el) return null;
              const isTagOperand = el.operand1.startsWith('"');
              const isBoolOperand = allTagsMap[el.operand1] === 'BOOL';

              return (
                <>
                  <div className="px-3 py-1 text-[10px] font-mono text-[#a1a1aa] border-b border-[#333338] truncate">
                    Элемент: {el.type} ({shortLabelMap[el.operand1] || el.operand1})
                  </div>

                  <button
                    onClick={() => {
                      insertElementAt(ctxMenu.rungIdx, ctxMenu.elIdx!, 'NO');
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-[#094771] flex items-center justify-between"
                  >
                    <span>Вставить контакт NO перед</span>
                    <span className="text-[10px] text-[#a1a1aa]">←</span>
                  </button>
                  <button
                    onClick={() => {
                      insertElementAt(ctxMenu.rungIdx, ctxMenu.elIdx! + 1, 'NO');
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-[#094771] flex items-center justify-between"
                  >
                    <span>Вставить контакт NO после</span>
                    <span className="text-[10px] text-[#a1a1aa]">→</span>
                  </button>

                  {canHaveParallel(el.type) && (
                    <button
                      onClick={() => {
                        addParallelBranch(ctxMenu.rungIdx, ctxMenu.elIdx!, 'NO');
                        setCtxMenu(null);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-[#094771] flex items-center gap-2 text-indigo-300"
                    >
                      <GitBranch size={13} /> Добавить параллельную OR-ветку
                    </button>
                  )}

                  {/* Секция быстрого Force из LD-редактора */}
                  {onForceTag && isTagOperand && (
                    <div className="my-1 pt-1 border-t border-[#333338]">
                      <div className="px-3 py-0.5 text-[10px] text-amber-400 font-semibold">
                        Управление Force (SHM):
                      </div>
                      {isBoolOperand ? (
                        <>
                          <button
                            onClick={() => {
                              onForceTag(el.operand1, 'true', true);
                              setCtxMenu(null);
                            }}
                            className="w-full px-3 py-1.5 text-left hover:bg-emerald-800/60 flex items-center gap-2 text-emerald-300"
                          >
                            <Zap size={13} /> Force TRUE (1)
                          </button>
                          <button
                            onClick={() => {
                              onForceTag(el.operand1, 'false', true);
                              setCtxMenu(null);
                            }}
                            className="w-full px-3 py-1.5 text-left hover:bg-rose-800/60 flex items-center gap-2 text-rose-300"
                          >
                            <Zap size={13} /> Force FALSE (0)
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            const val = window.prompt(`Задать значение Force для ${el.operand1}:`, '1500');
                            if (val !== null) onForceTag(el.operand1, val, true);
                            setCtxMenu(null);
                          }}
                          className="w-full px-3 py-1.5 text-left hover:bg-amber-800/60 flex items-center gap-2 text-amber-300"
                        >
                          <Zap size={13} /> Задать значение Force...
                        </button>
                      )}
                      {activeForces[el.operand1]?.active && (
                        <button
                          onClick={() => {
                            onForceTag(el.operand1, '', false);
                            setCtxMenu(null);
                          }}
                          className="w-full px-3 py-1.5 text-left hover:bg-rose-700 flex items-center gap-2 text-white"
                        >
                          <ZapOff size={13} /> Снять Force (Unforce)
                        </button>
                      )}
                    </div>
                  )}

                  <div className="my-1 pt-1 border-t border-[#333338]">
                    <button
                      onClick={() => {
                        setClipboardEl(JSON.parse(JSON.stringify(el)));
                        setCtxMenu(null);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-[#094771] flex items-center justify-between"
                    >
                      <span className="flex items-center gap-2"><Copy size={13} /> Копировать</span>
                      <span className="text-[10px] text-[#a1a1aa]">Ctrl+C</span>
                    </button>
                    <button
                      onClick={() => {
                        setClipboardEl(JSON.parse(JSON.stringify(el)));
                        removeElement(ctxMenu.rungIdx, ctxMenu.elIdx!);
                        setCtxMenu(null);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-[#094771] flex items-center justify-between"
                    >
                      <span className="flex items-center gap-2"><Scissors size={13} /> Вырезать</span>
                      <span className="text-[10px] text-[#a1a1aa]">Ctrl+X</span>
                    </button>
                    {clipboardEl && (
                      <button
                        onClick={() => {
                          const copy: LdElement = JSON.parse(JSON.stringify(clipboardEl));
                          copy.id = `el_${Date.now()}`;
                          const updated = ldData.rungs.map((r, rI) => {
                            if (rI !== ctxMenu.rungIdx) return r;
                            const els = [...r.elements];
                            els.splice(ctxMenu.elIdx! + 1, 0, copy);
                            return { ...r, elements: els };
                          });
                          commitRungs(updated);
                          setCtxMenu(null);
                        }}
                        className="w-full px-3 py-1.5 text-left hover:bg-[#094771] flex items-center justify-between"
                      >
                        <span className="flex items-center gap-2"><ClipboardPaste size={13} /> Вставить после</span>
                        <span className="text-[10px] text-[#a1a1aa]">Ctrl+V</span>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        duplicateElement(ctxMenu.rungIdx, ctxMenu.elIdx!);
                        setCtxMenu(null);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-[#094771] flex items-center justify-between"
                    >
                      <span>Дублировать элемент</span>
                      <span className="text-[10px] text-[#a1a1aa]">Ctrl+D</span>
                    </button>
                  </div>

                  <div className="my-1 pt-1 border-t border-[#333338]">
                    <button
                      onClick={() => {
                        moveElement(ctxMenu.rungIdx, ctxMenu.elIdx!, -1);
                        setCtxMenu(null);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-[#094771]"
                    >
                      Сдвинуть влево
                    </button>
                    <button
                      onClick={() => {
                        moveElement(ctxMenu.rungIdx, ctxMenu.elIdx!, 1);
                        setCtxMenu(null);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-[#094771]"
                    >
                      Сдвинуть вправо
                    </button>
                    <button
                      onClick={() => {
                        removeElement(ctxMenu.rungIdx, ctxMenu.elIdx!);
                        setCtxMenu(null);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-rose-700 text-rose-300 hover:text-white flex items-center justify-between"
                    >
                      <span>Удалить элемент</span>
                      <span className="text-[10px]">Del</span>
                    </button>
                  </div>
                </>
              );
            })()}

            {ctxMenu.targetType === 'PARALLEL' &&
              ctxMenu.elIdx !== undefined &&
              ctxMenu.parIdx !== undefined && (
                <>
                  <div className="px-3 py-1 text-[10px] font-mono text-[#a1a1aa] border-b border-[#333338]">
                    Параллельная ветка OR #{ctxMenu.parIdx + 1}
                  </div>
                  <button
                    onClick={() => {
                      addParallelBranch(ctxMenu.rungIdx, ctxMenu.elIdx!, 'NO');
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-[#094771]"
                  >
                    Добавить ещё одну ветку OR ниже
                  </button>
                  <button
                    onClick={() => {
                      const el = ldData.rungs[ctxMenu.rungIdx]?.elements[ctxMenu.elIdx!];
                      if (el && el.parallel) {
                        const nextPar = el.parallel.filter((_, i) => i !== ctxMenu.parIdx);
                        updateElement(ctxMenu.rungIdx, ctxMenu.elIdx!, { parallel: nextPar });
                      }
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-rose-700 text-rose-300 hover:text-white"
                  >
                    Удалить эту ветку OR
                  </button>
                </>
              )}

            {ctxMenu.targetType === 'RUNG' && (
              <>
                <div className="px-3 py-1 text-[10px] font-mono text-[#a1a1aa] border-b border-[#333338]">
                  Цепь NW {ctxMenu.rungIdx + 1}
                </div>
                <button
                  onClick={() => {
                    const len = ldData.rungs[ctxMenu.rungIdx]?.elements.length || 0;
                    insertElementAt(ctxMenu.rungIdx, len, 'NO');
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-[#094771]"
                >
                  Добавить контакт NO в цепь
                </button>
                <button
                  onClick={() => {
                    const len = ldData.rungs[ctxMenu.rungIdx]?.elements.length || 0;
                    insertElementAt(ctxMenu.rungIdx, len, 'COIL');
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-[#094771]"
                >
                  Добавить катушку COIL в цепь
                </button>
                <div className="my-1 pt-1 border-t border-[#333338]">
                  <button
                    onClick={() => {
                      addRungAt(ctxMenu.rungIdx);
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-[#094771]"
                  >
                    Вставить новую цепь выше
                  </button>
                  <button
                    onClick={() => {
                      addRungAt(ctxMenu.rungIdx + 1);
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-[#094771]"
                  >
                    Вставить новую цепь ниже
                  </button>
                  <button
                    onClick={() => {
                      duplicateRung(ctxMenu.rungIdx);
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-[#094771]"
                  >
                    Дублировать цепь
                  </button>
                  <button
                    onClick={() => {
                      moveRung(ctxMenu.rungIdx, -1);
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-[#094771]"
                  >
                    Переместить цепь вверх
                  </button>
                  <button
                    onClick={() => {
                      moveRung(ctxMenu.rungIdx, 1);
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-[#094771]"
                  >
                    Переместить цепь вниз
                  </button>
                  <button
                    onClick={() => {
                      deleteRung(ctxMenu.rungIdx);
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-rose-700 text-rose-300 hover:text-white"
                  >
                    Удалить цепь
                  </button>
                </div>
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
