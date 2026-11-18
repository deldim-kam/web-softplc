import React, { useState, useMemo } from 'react';
import type { DataBlock, LiveDbSnapshot, LdProgramData, LdRung, LdElement, LdElementType } from '../types/plc';
import { Plus, Trash2, Eye, EyeOff, Zap, Undo2, Redo2, ArrowLeft, ArrowRight, GitBranch } from 'lucide-react';

interface LdEditorProps {
  blockName: string;
  code: string;
  datablocks: DataBlock[];
  liveData: LiveDbSnapshot;
  rloStatus: boolean[];
  isCoreRunning: boolean;
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

export const LdEditor: React.FC<LdEditorProps> = ({
  blockName,
  code,
  datablocks,
  liveData,
  rloStatus,
  isCoreRunning,
  onChange,
}) => {
  const [selectedRungIdx, setSelectedRungIdx] = useState<number>(0);
  const [selectedElIdx, setSelectedElIdx] = useState<number | null>(null);
  const [monitoring, setMonitoring] = useState<boolean>(true);
  const [history, setHistory] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  const ldData: LdProgramData = useMemo(() => {
    try {
      const parsed = JSON.parse(code);
      if (parsed && Array.isArray(parsed.rungs)) return parsed;
    } catch {
      // Fallback
    }
    return DEFAULT_LD;
  }, [code]);

  // Разделение тегов по типам (BOOL отдельно от числовых для защиты от привязки REAL к контакту)
  const { boolTags, numericTags, allTagsMap } = useMemo(() => {
    const bTags: string[] = [];
    const nTags: string[] = [];
    const tMap: Record<string, string> = {};
    datablocks.forEach((db) => {
      db.variables.forEach((v) => {
        const full = `"${db.name}".${v.name}`;
        tMap[full] = v.type;
        if (v.type === 'BOOL') bTags.push(full);
        else nTags.push(full);
      });
    });
    return { boolTags: bTags, numericTags: nTags, allTagsMap: tMap };
  }, [datablocks]);

  const commitRungs = (newRungs: LdRung[]) => {
    setHistory((prev) => [...prev.slice(-25), code]);
    setRedoStack([]);
    onChange(JSON.stringify({ rungs: newRungs }, null, 2));
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack((r) => [code, ...r]);
    setHistory((h) => h.slice(0, -1));
    onChange(prev);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setHistory((h) => [...h, code]);
    setRedoStack((r) => r.slice(1));
    onChange(next);
  };

  const addRung = () => {
    const nextNum = ldData.rungs.length + 1;
    const newRung: LdRung = {
      id: `rung_${Date.now()}`,
      title: `Цепь ${nextNum}: Новая логическая цепь`,
      elements: [],
    };
    const updated = [...ldData.rungs, newRung];
    commitRungs(updated);
    setSelectedRungIdx(updated.length - 1);
    setSelectedElIdx(null);
  };

  const deleteRung = (idx: number) => {
    const updated = ldData.rungs.filter((_, i) => i !== idx);
    commitRungs(updated);
    setSelectedRungIdx(Math.max(0, updated.length - 1));
    setSelectedElIdx(null);
  };

  const isContactType = (t: LdElementType) => ['NO', 'NC', 'P_TRIG', 'N_TRIG'].includes(t);
  const isCoilType = (t: LdElementType) => ['COIL', 'COIL_SET', 'COIL_RESET', 'COIL_INV'].includes(t);
  const isBoxType = (t: LdElementType) => !isContactType(t) && !isCoilType(t);

  const insertElement = (type: LdElementType) => {
    if (ldData.rungs.length === 0) return;
    const rIdx = Math.min(selectedRungIdx, ldData.rungs.length - 1);
    const defaultBool = boolTags[0] || '"Line_Params".Line_Enable';
    const defaultNum = numericTags[0] || '"Line_Params".Target_Speed';

    const newEl: LdElement = {
      id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      type,
      operand1: ['TON', 'TOF'].includes(type)
        ? '1000'
        : isContactType(type) || isCoilType(type) || ['CTU', 'CTD'].includes(type)
        ? defaultBool
        : defaultNum,
      operand2: ['CMP_EQ', 'CMP_NE', 'CMP_GT', 'CMP_LT', 'CMP_GE', 'CMP_LE', 'ADD', 'SUB', 'MUL', 'DIV'].includes(type)
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

    const updated = ldData.rungs.map((r, i) => {
      if (i !== rIdx) return r;
      const els = [...r.elements];
      if (selectedElIdx !== null && selectedElIdx >= 0 && selectedElIdx < els.length) {
        els.splice(selectedElIdx + 1, 0, newEl);
      } else {
        els.push(newEl);
      }
      return { ...r, elements: els };
    });

    commitRungs(updated);
  };

  // Добавление параллельного контакта (OR-ветки) к выбранному контакту
  const addParallelBranch = (rungIdx: number, elIdx: number) => {
    const defaultBool = boolTags[0] || '"Line_Params".Line_Enable';
    const updated = ldData.rungs.map((r, rI) => {
      if (rI !== rungIdx) return r;
      const newEls = r.elements.map((el, eI) => {
        if (eI !== elIdx) return el;
        const par = el.parallel ? [...el.parallel] : [];
        par.push({
          id: `par_${Date.now()}`,
          type: 'NO',
          operand1: defaultBool,
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

  // Единая SVG-отрисовка контакта + его параллельных OR-веток (без магических пикселей)
  const renderContactCellSvg = (el: LdElement, wireInHot: boolean, wireOutHot: boolean) => {
    const hasParallel = el.parallel && el.parallel.length > 0;
    const svgHeight = hasParallel ? 48 + el.parallel!.length * 46 : 48;
    const inColor = wireInHot ? '#10b981' : '#71717a';
    const outColor = wireOutHot ? '#10b981' : '#71717a';
    const symColor = wireOutHot ? '#34d399' : '#38bdf8';

    const drawSymbolAtY = (type: LdElementType, y: number, color: string) => {
      let ch = '';
      if (type === 'P_TRIG') ch = 'P';
      if (type === 'N_TRIG') ch = 'N';
      return (
        <g key={`${type}_${y}`}>
          <line x1="0" y1={y} x2="64" y2={y} stroke={inColor} strokeWidth="2.5" />
          <line x1="96" y1={y} x2="160" y2={y} stroke={outColor} strokeWidth="2.5" />
          <line x1="64" y1={y - 12} x2="64" y2={y + 12} stroke={color} strokeWidth="2.5" />
          <line x1="96" y1={y - 12} x2="96" y2={y + 12} stroke={color} strokeWidth="2.5" />
          {type === 'NC' && <line x1="68" y1={y + 10} x2="92" y2={y - 10} stroke={color} strokeWidth="2.2" />}
          {ch && (
            <text x="80" y={y + 4} textAnchor="middle" fill={color} fontSize="12" fontWeight="bold">
              {ch}
            </text>
          )}
        </g>
      );
    };

    if (isCoilType(el.type)) {
      let ch = '';
      if (el.type === 'COIL_SET') ch = 'S';
      if (el.type === 'COIL_RESET') ch = 'R';
      if (el.type === 'COIL_INV') ch = '/';
      const cColor = wireOutHot ? '#34d399' : '#fb923c';
      return (
        <svg width="160" height="48" viewBox="0 0 160 48" className="block">
          <line x1="0" y1="24" x2="58" y2="24" stroke={inColor} strokeWidth="2.5" />
          <line x1="102" y1="24" x2="160" y2="24" stroke={outColor} strokeWidth="2.5" />
          <path d="M 68 10 A 14 14 0 0 0 68 38" fill="none" stroke={cColor} strokeWidth="2.5" />
          <path d="M 92 10 A 14 14 0 0 1 92 38" fill="none" stroke={cColor} strokeWidth="2.5" />
          {ch && (
            <text x="80" y="28" textAnchor="middle" fill={cColor} fontSize="13" fontWeight="bold">
              {ch}
            </text>
          )}
        </svg>
      );
    }

    return (
      <svg width="160" height={svgHeight} viewBox={`0 0 160 ${svgHeight}`} className="block">
        {drawSymbolAtY(el.type, 24, symColor)}
        {hasParallel &&
          el.parallel!.map((par, pIdx) => {
            const py = 24 + (pIdx + 1) * 44;
            return (
              <g key={par.id}>
                {/* Вертикальные стойки параллельного шунта OR */}
                <line x1="18" y1="24" x2="18" y2={py} stroke={inColor} strokeWidth="2.2" />
                <line x1="142" y1="24" x2="142" y2={py} stroke={outColor} strokeWidth="2.2" />
                <line x1="18" y1={py} x2="64" y2={py} stroke={inColor} strokeWidth="2.2" />
                <line x1="96" y1={py} x2="142" y2={py} stroke={outColor} strokeWidth="2.2" />
                <line x1="64" y1={py - 11} x2="64" y2={py + 11} stroke={symColor} strokeWidth="2.2" />
                <line x1="96" y1={py - 11} x2="96" y2={py + 11} stroke={symColor} strokeWidth="2.2" />
                {par.type === 'NC' && <line x1="68" y1={py + 9} x2="92" y2={py - 9} stroke={symColor} strokeWidth="2" />}
              </g>
            );
          })}
      </svg>
    );
  };

  return (
    <div className="bg-[#1e1e1e] border border-[#2d2d30] flex flex-col h-full overflow-hidden">
      <datalist id="plc-bool-tags">
        {boolTags.map((t) => <option key={t} value={t} />)}
      </datalist>
      <datalist id="plc-num-tags">
        {numericTags.map((t) => <option key={t} value={t} />)}
      </datalist>

      {/* Тулбар и палитра элементов LD */}
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
                title="Отменить (Undo)"
              >
                <Undo2 size={14} />
              </button>
              <button
                onClick={handleRedo}
                disabled={redoStack.length === 0}
                className="p-1 rounded bg-[#2d2d30] hover:bg-[#3e3e42] disabled:opacity-40 text-white"
                title="Повторить (Redo)"
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
              onClick={addRung}
              className="flex items-center gap-1 px-3 py-1 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-xs font-medium transition"
            >
              <Plus size={14} /> Добавить цепь (Network)
            </button>
          </div>
        </div>

        {/* Палитра элементов с корректными наименованиями CTU / CTD */}
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
              onClick={() => insertElement(item.t)}
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
              onClick={() => insertElement(item.t)}
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
              onClick={() => insertElement(t)}
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
              onClick={() => insertElement(item.t)}
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
              onClick={() => insertElement(t)}
              className="px-2 py-1 bg-[#2d2d30] hover:bg-[#094771] text-emerald-300 hover:text-white border border-[#3e3e42] rounded transition"
            >
              [{t}]
            </button>
          ))}
        </div>
      </div>

      {/* Список цепей (Networks) */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 bg-[#141416]">
        {ldData.rungs.map((rung, rIdx) => {
          const isRungSelected = rIdx === selectedRungIdx;

          return (
            <div
              key={rung.id}
              onClick={() => setSelectedRungIdx(rIdx)}
              className={`border rounded-md transition ${
                isRungSelected
                  ? 'border-[#3b82f6] bg-[#1c1c1f] ring-1 ring-[#3b82f6]/40'
                  : 'border-[#2d2d30] bg-[#18181b]'
              }`}
            >
              {/* Заголовок цепи */}
              <div className="px-3 py-2 bg-[#252526] border-b border-[#2d2d30] flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1">
                  <span
                    className={`px-2 py-0.5 font-mono text-xs rounded font-bold ${
                      isRungSelected ? 'bg-[#2563eb] text-white' : 'bg-[#3f3f46] text-[#d4d4d8]'
                    }`}
                  >
                    Цепь {rIdx + 1} {isRungSelected ? '● АКТИВНА' : ''}
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

              {/* Сетка элементов цепи с единой SVG-координатой шины */}
              <div className="p-4 overflow-x-auto flex items-stretch min-h-[150px] font-mono">
                {/* Левая силовая шина L+ */}
                <div
                  className={`w-1.5 rounded-full shrink-0 ${
                    isCoreRunning && monitoring ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]' : 'bg-[#71717a]'
                  }`}
                />

                {rung.elements.length === 0 ? (
                  <div className="flex items-center justify-center flex-1 text-xs text-[#a1a1aa] italic">
                    Цепь пуста — нажмите на любой элемент в панели сверху для вставки в Цепь {rIdx + 1}
                  </div>
                ) : (
                  <div className="flex items-start flex-1 min-w-max">
                    {rung.elements.map((el, eIdx) => {
                      const rloKey = (rIdx * 16 + eIdx + 1) % 255;
                      const prevRloKey = eIdx === 0 ? 0 : (rIdx * 16 + eIdx) % 255;
                      const wireInHot =
                        isCoreRunning && monitoring && (eIdx === 0 ? true : Boolean(rloStatus[prevRloKey]));
                      const wireOutHot = isCoreRunning && monitoring && Boolean(rloStatus[rloKey]);
                      const isElSelected = isRungSelected && selectedElIdx === eIdx;

                      const val1 = liveData[el.operand1];
                      const val2 = el.operand2 ? liveData[el.operand2] : undefined;
                      const val3 = el.operand3 ? liveData[el.operand3] : undefined;

                      // Проверка типа операнда для контактов и катушек
                      const tagType1 = allTagsMap[el.operand1];
                      const typeMismatch =
                        (isContactType(el.type) || isCoilType(el.type)) &&
                        tagType1 &&
                        tagType1 !== 'BOOL';

                      return (
                        <div
                          key={el.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRungIdx(rIdx);
                            setSelectedElIdx(eIdx);
                          }}
                          className={`flex flex-col items-center relative group px-0.5 rounded transition ${
                            isElSelected ? 'ring-1 ring-sky-400 bg-sky-950/20' : ''
                          }`}
                        >
                          {/* Панель управления позицией, шунтом OR и удалением */}
                          <div className="h-5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition z-10">
                            <button
                              type="button"
                              onClick={() => moveElement(rIdx, eIdx, -1)}
                              className="px-1 bg-[#2d2d30] hover:bg-[#3e3e42] text-white rounded text-[10px]"
                              title="Сдвинуть влево"
                            >
                              <ArrowLeft size={10} />
                            </button>
                            {isContactType(el.type) && (
                              <button
                                type="button"
                                onClick={() => addParallelBranch(rIdx, eIdx)}
                                className="px-1.5 bg-indigo-800 hover:bg-indigo-600 text-white rounded text-[10px] flex items-center gap-0.5"
                                title="Добавить параллельную ветку (OR)"
                              >
                                <GitBranch size={10} /> +OR
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => moveElement(rIdx, eIdx, 1)}
                              className="px-1 bg-[#2d2d30] hover:bg-[#3e3e42] text-white rounded text-[10px]"
                              title="Сдвинуть вправо"
                            >
                              <ArrowRight size={10} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeElement(rIdx, eIdx)}
                              className="px-1 bg-rose-800 hover:bg-rose-600 text-white rounded text-[10px]"
                              title="Удалить элемент"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>

                          {!isBoxType(el.type) ? (
                            /* КОНТАКТЫ (С ПАРАЛЛЕЛЬНЫМИ ШУНТАМИ OR) И КАТУШКИ */
                            <div className="flex flex-col items-center w-[160px]">
                              <input
                                list="plc-bool-tags"
                                value={el.operand1}
                                onChange={(e) => updateElement(rIdx, eIdx, { operand1: e.target.value })}
                                className={`w-[148px] text-center text-xs bg-[#1e1e1e] border rounded px-1.5 py-0.5 outline-none truncate ${
                                  typeMismatch
                                    ? 'border-rose-500 text-rose-400'
                                    : 'border-[#333337] focus:border-[#3b82f6] text-[#9cdcfe]'
                                }`}
                                title={typeMismatch ? `Ошибка типа: контакт требует BOOL, выбран ${tagType1}` : el.operand1}
                              />

                              {renderContactCellSvg(el, wireInHot, wireOutHot)}

                              <div className="flex items-center gap-1.5 text-[11px] text-[#a1a1aa]">
                                <span>{el.type}</span>
                                {isCoreRunning && val1 !== undefined && (
                                  <span className="px-1.5 py-0.2 rounded bg-[#27272a] text-emerald-300 font-bold">
                                    ={String(val1)}
                                  </span>
                                )}
                              </div>

                              {/* Редактирование тегов параллельных веток OR */}
                              {el.parallel &&
                                el.parallel.map((par, pIdx) => (
                                  <div key={par.id} className="mt-1 flex items-center gap-1 w-[148px]">
                                    <select
                                      value={par.type}
                                      onChange={(e) => {
                                        const newPar = el.parallel!.map((p, i) =>
                                          i === pIdx ? { ...p, type: e.target.value as LdElementType } : p
                                        );
                                        updateElement(rIdx, eIdx, { parallel: newPar });
                                      }}
                                      className="bg-[#252526] text-sky-300 text-[10px] rounded px-1 py-0.5"
                                    >
                                      <option value="NO">NO</option>
                                      <option value="NC">NC</option>
                                    </select>
                                    <input
                                      list="plc-bool-tags"
                                      value={par.operand1}
                                      onChange={(e) => {
                                        const newPar = el.parallel!.map((p, i) =>
                                          i === pIdx ? { ...p, operand1: e.target.value } : p
                                        );
                                        updateElement(rIdx, eIdx, { parallel: newPar });
                                      }}
                                      className="w-full text-[11px] bg-[#1e1e1e] border border-[#333337] rounded px-1 py-0.5 text-[#9cdcfe]"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newPar = el.parallel!.filter((_, i) => i !== pIdx);
                                        updateElement(rIdx, eIdx, { parallel: newPar });
                                      }}
                                      className="text-rose-400 hover:text-rose-300"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                            </div>
                          ) : (
                            /* ФУНКЦИОНАЛЬНЫЕ БЛОКИ (TON, TOF, CTU, CTD, CMP, MATH) */
                            <div className="flex items-start mt-[12px]">
                              <svg width="16" height="48" viewBox="0 0 16 48">
                                <line
                                  x1="0"
                                  y1="24"
                                  x2="16"
                                  y2="24"
                                  stroke={wireInHot ? '#10b981' : '#71717a'}
                                  strokeWidth="2.5"
                                />
                              </svg>

                              <div
                                className={`w-[215px] rounded border bg-[#222225] overflow-hidden ${
                                  wireOutHot ? 'border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'border-[#45454a]'
                                }`}
                              >
                                <div className="px-2.5 py-1 bg-[#2d2d32] border-b border-[#3e3e42] flex justify-between items-center text-xs font-bold text-amber-300">
                                  <span>{el.type}</span>
                                  <span className="text-[10px] text-emerald-400">EN → ENO</span>
                                </div>

                                <div className="p-2 space-y-1.5 text-xs">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-[#a1a1aa] text-[11px]">
                                      {['TON', 'TOF'].includes(el.type) ? 'PT(ms):' : ['CTU', 'CTD'].includes(el.type) ? 'IN:' : 'IN1:'}
                                    </span>
                                    <input
                                      list={['CTU', 'CTD'].includes(el.type) ? 'plc-bool-tags' : 'plc-num-tags'}
                                      value={el.operand1}
                                      onChange={(e) => updateElement(rIdx, eIdx, { operand1: e.target.value })}
                                      className="w-[140px] bg-[#161618] border border-[#333337] px-1.5 py-0.5 rounded text-[#9cdcfe] outline-none"
                                    />
                                  </div>
                                  {isCoreRunning && val1 !== undefined && (
                                    <div className="text-right text-[11px] text-emerald-300">= {String(val1)}</div>
                                  )}

                                  {el.operand2 !== undefined && (
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="text-[#a1a1aa] text-[11px]">
                                        {['CTU', 'CTD'].includes(el.type) ? 'PV:' : 'IN2:'}
                                      </span>
                                      <input
                                        list="plc-num-tags"
                                        value={el.operand2}
                                        onChange={(e) => updateElement(rIdx, eIdx, { operand2: e.target.value })}
                                        className="w-[140px] bg-[#161618] border border-[#333337] px-1.5 py-0.5 rounded text-[#b5cea8] outline-none"
                                      />
                                    </div>
                                  )}
                                  {isCoreRunning && val2 !== undefined && (
                                    <div className="text-right text-[11px] text-emerald-300">= {String(val2)}</div>
                                  )}

                                  {el.operand3 !== undefined && (
                                    <div className="pt-1 border-t border-[#333337] flex items-center justify-between gap-1">
                                      <span className="text-amber-400 text-[11px] font-bold">OUT:</span>
                                      <input
                                        list={['TON', 'TOF'].includes(el.type) ? 'plc-bool-tags' : 'plc-num-tags'}
                                        value={el.operand3}
                                        onChange={(e) => updateElement(rIdx, eIdx, { operand3: e.target.value })}
                                        className="w-[140px] bg-[#161618] border border-[#333337] px-1.5 py-0.5 rounded text-amber-300 outline-none"
                                      />
                                    </div>
                                  )}
                                  {isCoreRunning && val3 !== undefined && (
                                    <div className="text-right text-[11px] text-amber-300 font-bold">= {String(val3)}</div>
                                  )}
                                </div>
                              </div>

                              <svg width="16" height="48" viewBox="0 0 16 48">
                                <line
                                  x1="0"
                                  y1="24"
                                  x2="16"
                                  y2="24"
                                  stroke={wireOutHot ? '#10b981' : '#71717a'}
                                  strokeWidth="2.5"
                                />
                              </svg>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Правая шина питания L- */}
                <div className="w-1.5 rounded-full bg-[#71717a] shrink-0 ml-auto" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
