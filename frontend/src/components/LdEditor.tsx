import React, { useState, useMemo } from 'react';
import type { DataBlock, LiveDbSnapshot, LdProgramData, LdRung, LdElement, LdElementType } from '../types/plc';
import { Plus, Trash2, Eye, EyeOff, Zap } from 'lucide-react';

interface LdEditorProps {
  blockName: string;
  code: string;
  datablocks: DataBlock[];
  liveData: LiveDbSnapshot | null;
  isOnline: boolean;
  onChange: (newJsonCode: string) => void;
}

const DEFAULT_LD: LdProgramData = {
  rungs: [
    {
      id: 'rung_1',
      title: 'Network 1: Пуск и масштабирование скорости',
      elements: [
        { id: 'el_1', type: 'NO', operand1: '"Line_Params".Line_Enable' },
        { id: 'el_2', type: 'CMP_LE', operand1: '"Line_Params".Target_Speed', operand2: '3000.0' },
        { id: 'el_3', type: 'ADD', operand1: '1500.0', operand2: '500.0', operand3: '"Line_Params".Target_Speed' }
      ]
    }
  ]
};

export const LdEditor: React.FC<LdEditorProps> = ({
  blockName,
  code,
  datablocks,
  liveData,
  isOnline,
  onChange,
}) => {
  const [selectedRungIdx, setSelectedRungIdx] = useState<number>(0);
  const [monitoring, setMonitoring] = useState<boolean>(true);

  const ldData: LdProgramData = useMemo(() => {
    try {
      const parsed = JSON.parse(code);
      if (parsed && Array.isArray(parsed.rungs)) return parsed;
    } catch {
      // Fallback
    }
    return DEFAULT_LD;
  }, [code]);

  const availableTags = useMemo(() => {
    const tags: string[] = [];
    datablocks.forEach(db => {
      db.variables.forEach(v => {
        tags.push(`"${db.name}".${v.name}`);
      });
    });
    return tags;
  }, [datablocks]);

  const updateLd = (newRungs: LdRung[]) => {
    onChange(JSON.stringify({ rungs: newRungs }, null, 2));
  };

  const addRung = () => {
    const nextNum = ldData.rungs.length + 1;
    const newRung: LdRung = {
      id: `rung_${Date.now()}`,
      title: `Network ${nextNum}: Новая цепь`,
      elements: [],
    };
    const updated = [...ldData.rungs, newRung];
    updateLd(updated);
    setSelectedRungIdx(updated.length - 1);
  };

  const deleteRung = (idx: number) => {
    const updated = ldData.rungs.filter((_, i) => i !== idx);
    updateLd(updated);
    if (selectedRungIdx >= updated.length) {
      setSelectedRungIdx(Math.max(0, updated.length - 1));
    }
  };

  const addElementToSelectedRung = (type: LdElementType) => {
    if (ldData.rungs.length === 0) return;
    const targetIdx = Math.min(selectedRungIdx, ldData.rungs.length - 1);
    const defaultTag = availableTags[0] || '"Line_Params".Line_Enable';
    const defaultNumTag = availableTags.find(t => t.includes('Speed') || t.includes('Error')) || defaultTag;

    const newEl: LdElement = {
      id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      operand1: ['TON', 'TOF'].includes(type) ? '1000' : defaultTag,
      operand2: ['CMP_EQ', 'CMP_NE', 'CMP_GT', 'CMP_LT', 'CMP_GE', 'CMP_LE', 'ADD', 'SUB', 'MUL', 'DIV'].includes(type)
        ? '100.0'
        : ['CTU', 'CTD'].includes(type)
        ? '10'
        : undefined,
      operand3: ['ADD', 'SUB', 'MUL', 'DIV', 'TON', 'TOF', 'CTU', 'CTD'].includes(type)
        ? defaultNumTag
        : undefined,
    };

    const updated = ldData.rungs.map((r, i) =>
      i === targetIdx ? { ...r, elements: [...r.elements, newEl] } : r
    );
    updateLd(updated);
  };

  const updateElement = (rungIdx: number, elIdx: number, patch: Partial<LdElement>) => {
    const updated = ldData.rungs.map((r, rI) => {
      if (rI !== rungIdx) return r;
      const newEls = r.elements.map((el, eI) => (eI === elIdx ? { ...el, ...patch } : el));
      return { ...r, elements: newEls };
    });
    updateLd(updated);
  };

  const removeElement = (rungIdx: number, elIdx: number) => {
    const updated = ldData.rungs.map((r, rI) => {
      if (rI !== rungIdx) return r;
      return { ...r, elements: r.elements.filter((_, eI) => eI !== elIdx) };
    });
    updateLd(updated);
  };

  const getLiveVal = (operand?: string): any => {
    if (!operand || !liveData) return undefined;
    const match = operand.match(/"[^"]+"\.([a-zA-Z0-9_]+)/);
    const varName = match ? match[1] : operand;
    return liveData[varName];
  };

  const isElementActive = (el: LdElement): boolean => {
    if (!isOnline || !monitoring || !liveData) return false;
    const v1 = getLiveVal(el.operand1);
    const n1 = v1 !== undefined ? Number(v1) : Number(el.operand1);
    const v2 = getLiveVal(el.operand2);
    const n2 = v2 !== undefined ? Number(v2) : Number(el.operand2);

    switch (el.type) {
      case 'NO':
      case 'COIL':
      case 'COIL_SET':
        return Boolean(v1);
      case 'NC':
      case 'COIL_INV':
      case 'COIL_RESET':
        return v1 !== undefined ? !Boolean(v1) : false;
      case 'CMP_EQ': return n1 === n2;
      case 'CMP_NE': return n1 !== n2;
      case 'CMP_GT': return n1 > n2;
      case 'CMP_LT': return n1 < n2;
      case 'CMP_GE': return n1 >= n2;
      case 'CMP_LE': return n1 <= n2;
      default:
        return true;
    }
  };

  const isBoxBlock = (type: LdElementType) =>
    !['NO', 'NC', 'P_TRIG', 'N_TRIG', 'COIL', 'COIL_SET', 'COIL_RESET', 'COIL_INV'].includes(type);

  const isCoil = (type: LdElementType) =>
    ['COIL', 'COIL_SET', 'COIL_RESET', 'COIL_INV'].includes(type);

  // Отрисовка SVG контакта или катушки на единой линии (Y = 18 внутри SVG, что соответствует Y = 52px от верха элемента)
  const renderContactOrCoilSvg = (type: LdElementType, wireInHot: boolean, elemHot: boolean) => {
    const inColor = wireInHot ? '#10b981' : '#6e6e6e';
    const outColor = elemHot ? '#10b981' : '#6e6e6e';
    const symColor = elemHot ? '#34d399' : type.startsWith('COIL') ? '#ce9178' : '#4ec9b0';

    if (isCoil(type)) {
      let innerLetter = '';
      if (type === 'COIL_SET') innerLetter = 'S';
      if (type === 'COIL_RESET') innerLetter = 'R';
      if (type === 'COIL_INV') innerLetter = '/';

      return (
        <svg width="150" height="36" viewBox="0 0 150 36" className="overflow-visible">
          {/* Входящий провод слева до дуги катушки */}
          <line x1="0" y1="18" x2="54" y2="18" stroke={inColor} strokeWidth="2.5" />
          {/* Выходящий провод справа к шине */}
          <line x1="96" y1="18" x2="150" y2="18" stroke={outColor} strokeWidth="2.5" />
          {/* Левая дуга катушки ( */}
          <path d="M 63 5 A 14 14 0 0 0 63 31" fill="none" stroke={symColor} strokeWidth="2.5" strokeLinecap="round" />
          {/* Правая дуга катушки ) */}
          <path d="M 87 5 A 14 14 0 0 1 87 31" fill="none" stroke={symColor} strokeWidth="2.5" strokeLinecap="round" />
          {innerLetter && (
            <text x="75" y="23" textAnchor="middle" fill={symColor} fontSize="13" fontWeight="bold" fontFamily="monospace">
              {innerLetter}
            </text>
          )}
        </svg>
      );
    }

    // Контакты: NO, NC, P_TRIG, N_TRIG
    let innerChar = '';
    if (type === 'P_TRIG') innerChar = 'P';
    if (type === 'N_TRIG') innerChar = 'N';

    return (
      <svg width="150" height="36" viewBox="0 0 150 36" className="overflow-visible">
        {/* Входящий провод слева до левой губки контакта */}
        <line x1="0" y1="18" x2="62" y2="18" stroke={inColor} strokeWidth="2.5" />
        {/* Выходящий провод справа от правой губки контакта */}
        <line x1="88" y1="18" x2="150" y2="18" stroke={outColor} strokeWidth="2.5" />
        {/* Левая и правая вертикальные стойки контакта | | */}
        <line x1="62" y1="5" x2="62" y2="31" stroke={symColor} strokeWidth="2.5" strokeLinecap="round" />
        <line x1="88" y1="5" x2="88" y2="31" stroke={symColor} strokeWidth="2.5" strokeLinecap="round" />
        {/* Диагональная линия для нормально-замкнутого контакта NC */}
        {type === 'NC' && (
          <line x1="66" y1="28" x2="84" y2="8" stroke={symColor} strokeWidth="2.2" strokeLinecap="round" />
        )}
        {/* Буква P или N для фронтов */}
        {innerChar && (
          <text x="75" y="23" textAnchor="middle" fill={symColor} fontSize="13" fontWeight="bold" fontFamily="monospace">
            {innerChar}
          </text>
        )}
      </svg>
    );
  };

  const getBoxTitle = (type: LdElementType) => {
    switch (type) {
      case 'CMP_EQ': return '== (EQ)';
      case 'CMP_NE': return '!= (NE)';
      case 'CMP_GT': return '> (GT)';
      case 'CMP_LT': return '< (LT)';
      case 'CMP_GE': return '>= (GE)';
      case 'CMP_LE': return '<= (LE)';
      case 'CTU': return 'CMDUp (CTU)';
      case 'CTD': return 'CMDDoun (CTD)';
      default: return type;
    }
  };

  return (
    <div className="bg-[#1e1e1e] border border-[#2d2d30] flex flex-col h-full overflow-hidden select-none">
      <datalist id="plc-tags-list">
        {availableTags.map(t => <option key={t} value={t} />)}
      </datalist>

      {/* 1. Верхняя панель и палитра элементов LD */}
      <div className="bg-[#252526] border-b border-[#2d2d30] p-2 flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Zap size={15} className="text-amber-400" />
            <span className="font-semibold text-white">{blockName}</span>
            <span className="text-[#858585] font-mono">[LD / Ladder Diagram]</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setMonitoring(p => !p)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono border transition ${
                monitoring && isOnline
                  ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/50'
                  : 'bg-[#2d2d30] text-[#858585] border-[#3e3e42]'
              }`}
            >
              {monitoring && isOnline ? <Eye size={13} className="text-emerald-400" /> : <EyeOff size={13} />}
              <span>Power Flow: {monitoring && isOnline ? 'ON' : 'OFF'}</span>
            </button>

            <button
              onClick={addRung}
              className="flex items-center gap-1 px-2.5 py-1 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-xs font-medium transition"
            >
              <Plus size={13} /> Add Network
            </button>
          </div>
        </div>

        {/* Палитра компонентов LD */}
        <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-[#333333] font-mono text-[11px]">
          <span className="text-[#858585] mr-1 text-[10px] uppercase">Контакты:</span>
          {([
            { t: 'NO', l: '┤ ├ NO' },
            { t: 'NC', l: '┤/├ NC' },
            { t: 'P_TRIG', l: '┤P├ Pos' },
            { t: 'N_TRIG', l: '┤N├ Neg' },
          ] as { t: LdElementType; l: string }[]).map(item => (
            <button
              key={item.t}
              onClick={() => addElementToSelectedRung(item.t)}
              className="px-2 py-0.5 bg-[#2d2d30] hover:bg-[#094771] text-[#4ec9b0] hover:text-white border border-[#3e3e42] rounded transition"
            >
              {item.l}
            </button>
          ))}

          <span className="text-[#444444] mx-1">|</span>
          <span className="text-[#858585] mr-1 text-[10px] uppercase">Катушки:</span>
          {([
            { t: 'COIL', l: '( )' },
            { t: 'COIL_SET', l: '(S)' },
            { t: 'COIL_RESET', l: '(R)' },
            { t: 'COIL_INV', l: '(/)' },
          ] as { t: LdElementType; l: string }[]).map(item => (
            <button
              key={item.t}
              onClick={() => addElementToSelectedRung(item.t)}
              className="px-2 py-0.5 bg-[#2d2d30] hover:bg-[#094771] text-[#ce9178] hover:text-white border border-[#3e3e42] rounded transition"
            >
              {item.l}
            </button>
          ))}

          <span className="text-[#444444] mx-1">|</span>
          <span className="text-[#858585] mr-1 text-[10px] uppercase">Таймеры/Счет:</span>
          {([
            { t: 'TON', l: 'TON' },
            { t: 'TOF', l: 'TOF' },
            { t: 'CTU', l: 'CMDUp' },
            { t: 'CTD', l: 'CMDDoun' },
          ] as { t: LdElementType; l: string }[]).map(item => (
            <button
              key={item.t}
              onClick={() => addElementToSelectedRung(item.t)}
              className="px-2 py-0.5 bg-[#2d2d30] hover:bg-[#094771] text-[#dcdcaa] hover:text-white border border-[#3e3e42] rounded transition"
            >
              [{item.l}]
            </button>
          ))}

          <span className="text-[#444444] mx-1">|</span>
          <span className="text-[#858585] mr-1 text-[10px] uppercase">Сравнение:</span>
          {([
            { t: 'CMP_EQ', l: '==' },
            { t: 'CMP_NE', l: '!=' },
            { t: 'CMP_GT', l: '>' },
            { t: 'CMP_LT', l: '<' },
            { t: 'CMP_GE', l: '>=' },
            { t: 'CMP_LE', l: '<=' },
          ] as { t: LdElementType; l: string }[]).map(item => (
            <button
              key={item.t}
              onClick={() => addElementToSelectedRung(item.t)}
              className="px-2 py-0.5 bg-[#2d2d30] hover:bg-[#094771] text-[#c586c0] hover:text-white border border-[#3e3e42] rounded transition"
            >
              [{item.l}]
            </button>
          ))}

          <span className="text-[#444444] mx-1">|</span>
          <span className="text-[#858585] mr-1 text-[10px] uppercase">Математика:</span>
          {(['ADD', 'SUB', 'MUL', 'DIV'] as LdElementType[]).map(t => (
            <button
              key={t}
              onClick={() => addElementToSelectedRung(t)}
              className="px-2 py-0.5 bg-[#2d2d30] hover:bg-[#094771] text-[#9cdcfe] hover:text-white border border-[#3e3e42] rounded transition"
            >
              [{t}]
            </button>
          ))}
        </div>
      </div>

      {/* 2. Рабочая область цепей (Networks / Rungs) */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 bg-[#161617]">
        {ldData.rungs.map((rung, rIdx) => {
          const isSelected = rIdx === selectedRungIdx;
          let currentFlow = isOnline && monitoring;

          return (
            <div
              key={rung.id}
              onClick={() => setSelectedRungIdx(rIdx)}
              className={`border rounded-md transition ${
                isSelected
                  ? 'border-[#007acc] bg-[#1c1c1e] shadow-lg'
                  : 'border-[#2d2d30] bg-[#19191b] hover:border-[#3e3e42]'
              }`}
            >
              {/* Шапка Network */}
              <div className="px-3 py-1.5 bg-[#252526] border-b border-[#2d2d30] flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1">
                  <span className="px-1.5 py-0.5 bg-[#094771] text-white font-mono text-[10px] rounded font-bold">
                    NW {rIdx + 1}
                  </span>
                  <input
                    type="text"
                    value={rung.title}
                    onChange={(e) => {
                      const updated = ldData.rungs.map((r, i) =>
                        i === rIdx ? { ...r, title: e.target.value } : r
                      );
                      updateLd(updated);
                    }}
                    className="bg-transparent text-xs text-[#e1e1e1] font-medium outline-none focus:bg-[#333333] px-1.5 py-0.5 rounded w-full max-w-lg"
                  />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteRung(rIdx);
                  }}
                  className="text-[#858585] hover:text-rose-400 p-1 transition"
                  title="Удалить цепь (Network)"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Полотно электрической цепи: все элементы нанизаны на единую ось Y = 52px */}
              <div className="px-4 py-4 overflow-x-auto flex items-stretch min-h-[145px] font-mono">
                {/* Левая силовая шина L+ (Power Rail) */}
                <div
                  className={`w-1.5 rounded-full shrink-0 ${
                    isOnline && monitoring ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]' : 'bg-[#6e6e6e]'
                  }`}
                />

                {rung.elements.length === 0 ? (
                  <div className="flex items-center flex-1">
                    <div className="h-[2.5px] w-full bg-[#333333] relative flex items-center justify-center">
                      <span className="bg-[#1c1c1e] px-3 text-xs text-[#666666] italic">
                        Цепь пуста — выберите элементы в панели сверху для добавления в Network {rIdx + 1}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start flex-1 min-w-max">
                    {/* Стартовый сегмент провода от левой шины (на высоте Y = 52px) */}
                    <div
                      className={`w-4 h-[2.5px] mt-[51px] shrink-0 ${
                        isOnline && monitoring ? 'bg-emerald-400' : 'bg-[#6e6e6e]'
                      }`}
                    />

                    {rung.elements.map((el, eIdx) => {
                      const wireInHot = currentFlow;
                      const active = isElementActive(el);
                      if (!isCoil(el.type) && !active) {
                        currentFlow = false;
                      }
                      const wireOutHot = currentFlow;

                      const live1 = getLiveVal(el.operand1);
                      const live2 = getLiveVal(el.operand2);
                      const live3 = getLiveVal(el.operand3);

                      // Если это катушка и она последняя в цепи — растягиваем провод перед ней до правого края (как в классическом LD)
                      const isTrailingCoil = isCoil(el.type) && eIdx === rung.elements.length - 1;

                      return (
                        <React.Fragment key={el.id}>
                          {isTrailingCoil && (
                            <div
                              className={`flex-1 min-w-[32px] h-[2.5px] mt-[51px] ${
                                wireInHot ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-[#6e6e6e]'
                              }`}
                            />
                          )}

                          {!isBoxBlock(el.type) ? (
                            /* === КОНТАКТЫ И КАТУШКИ НА ЕДИНОЙ ЛИНИИ (БЕЗ ВНЕШНИХ КОРОБОК) === */
                            <div className="flex flex-col items-center w-[150px] shrink-0 group relative">
                              {/* Кнопка удаления при наведении */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeElement(rIdx, eIdx);
                                }}
                                className="absolute -top-2 right-2 bg-rose-800 hover:bg-rose-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition z-10"
                                title="Удалить элемент"
                              >
                                <Trash2 size={10} />
                              </button>

                              {/* 1. Надпись тега строго над символом контакта (высота 34px) */}
                              <div className="h-[34px] w-full px-1.5 flex items-end justify-center pb-1">
                                <input
                                  list="plc-tags-list"
                                  value={el.operand1}
                                  onChange={(e) => updateElement(rIdx, eIdx, { operand1: e.target.value })}
                                  title={el.operand1}
                                  className="w-full text-center text-[11px] text-[#9cdcfe] bg-transparent hover:bg-[#252526] focus:bg-[#252526] border border-transparent hover:border-[#3e3e42] focus:border-[#007acc] rounded px-1 py-0.5 outline-none transition truncate"
                                  placeholder="Tag..."
                                />
                              </div>

                              {/* 2. SVG-символ контакта/катушки, центр которого лежит ровно на оси Y = 52px (34 + 18 = 52) */}
                              <div className="h-[36px] w-[150px] flex items-center justify-center">
                                {renderContactOrCoilSvg(el.type, wireInHot, wireOutHot && active)}
                              </div>

                              {/* 3. Подпись типа и живого значения под контактом */}
                              <div className="flex items-center gap-1 text-[10px] text-[#777777] mt-0.5">
                                <span>{el.type}</span>
                                {isOnline && live1 !== undefined && (
                                  <span
                                    className={`px-1 rounded font-bold ${
                                      Boolean(live1)
                                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50'
                                        : 'bg-[#252526] text-[#999999]'
                                    }`}
                                  >
                                    ={String(live1)}
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            /* === ФУНКЦИОНАЛЬНЫЙ БЛОК FBD/LD С ЛИНИЕЙ EN -> ENO НА ВЫСОТЕ Y = 52px === */
                            <div className="flex items-start shrink-0 group relative">
                              {/* Входной провод в пин EN на высоте Y = 52px */}
                              <div
                                className={`w-4 h-[2.5px] mt-[51px] shrink-0 ${
                                  wireInHot ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-[#6e6e6e]'
                                }`}
                              />

                              {/* Корпус блока (смещен сверху на 14px так, чтобы строка EN/ENO оказалась ровно на Y = 52px) */}
                              <div
                                className={`mt-[14px] w-[210px] rounded border bg-[#222225] overflow-hidden shadow-md transition ${
                                  wireOutHot
                                    ? 'border-emerald-500/90 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                                    : 'border-[#45454a]'
                                }`}
                              >
                                {/* Заголовок блока (высота 24px) */}
                                <div className="h-[24px] bg-[#2d2d32] px-2.5 border-b border-[#3e3e42] flex items-center justify-between text-[11px] font-bold text-[#dcdcaa]">
                                  <span>{getBoxTitle(el.type)}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeElement(rIdx, eIdx);
                                    }}
                                    className="text-[#858585] hover:text-rose-400 transition"
                                    title="Удалить блок"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>

                                {/* Строка EN <---> ENO (центр этой строки: 14 + 24 + 14 = 52px — идеальное совпадение с линией цепи!) */}
                                <div className="h-[26px] px-2 bg-[#1b1b1d] border-b border-[#2e2e32] flex items-center justify-between text-[10px] font-bold">
                                  <span className={wireInHot ? 'text-emerald-400' : 'text-[#777777]'}>● EN</span>
                                  <div
                                    className={`flex-1 mx-2 border-t border-dashed ${
                                      wireOutHot ? 'border-emerald-500/70' : 'border-[#444444]'
                                    }`}
                                  />
                                  <span className={wireOutHot ? 'text-emerald-400' : 'text-[#777777]'}>ENO ●</span>
                                </div>

                                {/* Параметры блока (IN1, IN2, OUT) */}
                                <div className="p-2 space-y-1.5 text-[11px]">
                                  <div>
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="text-[#858585] text-[10px] shrink-0">
                                        {['TON', 'TOF'].includes(el.type) ? 'PT(ms):' : ['CTU', 'CTD'].includes(el.type) ? 'CU/CD:' : 'IN1:'}
                                      </span>
                                      <input
                                        list="plc-tags-list"
                                        value={el.operand1}
                                        title={el.operand1}
                                        onChange={(e) => updateElement(rIdx, eIdx, { operand1: e.target.value })}
                                        className="w-[145px] bg-[#161618] border border-[#333337] focus:border-[#007acc] px-1.5 py-0.5 rounded text-[#9cdcfe] outline-none truncate"
                                      />
                                    </div>
                                    {isOnline && live1 !== undefined && (
                                      <div className="text-right text-[10px] text-emerald-400">= {String(live1)}</div>
                                    )}
                                  </div>

                                  {el.operand2 !== undefined && (
                                    <div>
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="text-[#858585] text-[10px] shrink-0">
                                          {['CTU', 'CTD'].includes(el.type) ? 'PV:' : 'IN2:'}
                                        </span>
                                        <input
                                          list="plc-tags-list"
                                          value={el.operand2}
                                          title={el.operand2}
                                          onChange={(e) => updateElement(rIdx, eIdx, { operand2: e.target.value })}
                                          className="w-[145px] bg-[#161618] border border-[#333337] focus:border-[#007acc] px-1.5 py-0.5 rounded text-[#b5cea8] outline-none truncate"
                                        />
                                      </div>
                                      {isOnline && live2 !== undefined && (
                                        <div className="text-right text-[10px] text-emerald-400">= {String(live2)}</div>
                                      )}
                                    </div>
                                  )}

                                  {el.operand3 !== undefined && (
                                    <div className="pt-1 border-t border-[#2e2e32]">
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="text-amber-400 text-[10px] font-bold shrink-0">OUT →</span>
                                        <input
                                          list="plc-tags-list"
                                          value={el.operand3}
                                          title={el.operand3}
                                          onChange={(e) => updateElement(rIdx, eIdx, { operand3: e.target.value })}
                                          className="w-[145px] bg-[#161618] border border-[#333337] focus:border-amber-500 px-1.5 py-0.5 rounded text-amber-300 outline-none truncate"
                                        />
                                      </div>
                                      {isOnline && live3 !== undefined && (
                                        <div className="text-right text-[10px] text-amber-300 font-bold">= {String(live3)}</div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Выходной провод из пина ENO на высоте Y = 52px */}
                              <div
                                className={`w-4 h-[2.5px] mt-[51px] shrink-0 ${
                                  wireOutHot ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-[#6e6e6e]'
                                }`}
                              />
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Замыкающий провод от последнего элемента до правой шины питания */}
                    <div
                      className={`flex-1 min-w-[24px] h-[2.5px] mt-[51px] ${
                        currentFlow ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-[#6e6e6e]'
                      }`}
                    />
                  </div>
                )}

                {/* Правая шина питания L- (Neutral Rail) */}
                <div
                  className={`w-1.5 rounded-full shrink-0 ${
                    currentFlow ? 'bg-emerald-500/70' : 'bg-[#6e6e6e]'
                  }`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
