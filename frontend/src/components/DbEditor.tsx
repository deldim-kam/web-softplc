import React, { useState, useMemo } from 'react';
import type { DataBlock, Variable, IecType, LiveDbSnapshot, ForceEntry } from '../types/plc';
import { Plus, Trash2, Database, Zap, ZapOff, X, Check, AlertTriangle } from 'lucide-react';

interface DbEditorProps {
  dataBlock: DataBlock;
  onChange: (updated: DataBlock, renamedVar?: { oldName: string; newName: string }) => void;
  liveData: LiveDbSnapshot;
  isCoreRunning: boolean;
  activeForces: Record<string, ForceEntry>;
  onForceUpdate: (forces: Record<string, ForceEntry>, msg: string) => void;
}

const IEC_TYPES: IecType[] = ['BOOL', 'INT', 'DINT', 'REAL', 'TIME', 'WORD'];

export function getTypeByteSize(t: IecType): number {
  switch (t) {
    case 'BOOL': return 1;
    case 'INT':
    case 'WORD': return 2;
    case 'DINT':
    case 'REAL':
    case 'TIME': return 4;
  }
}

export function validateValueForType(val: string, t: IecType): string | null {
  const s = val.trim();
  if (!s) return 'Пустое значение';
  switch (t) {
    case 'BOOL':
      if (!['true', 'false', '1', '0', 'TRUE', 'FALSE'].includes(s)) return 'Ожидается TRUE / FALSE';
      return null;
    case 'INT': {
      const n = Number(s);
      if (!Number.isInteger(n) || n < -32768 || n > 32767) return 'Диапазон INT: -32768 .. 32767';
      return null;
    }
    case 'WORD': {
      const n = Number(s);
      if (!Number.isInteger(n) || n < 0 || n > 65535) return 'Диапазон WORD: 0 .. 65535';
      return null;
    }
    case 'DINT':
    case 'TIME': {
      const n = Number(s);
      if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) return 'Целое 32-бит (DINT)';
      return null;
    }
    case 'REAL': {
      const n = Number(s);
      if (Number.isNaN(n)) return 'Ожидается число с плавающей точкой (REAL)';
      return null;
    }
  }
}

export const DbEditor: React.FC<DbEditorProps> = ({
  dataBlock,
  onChange,
  liveData,
  isCoreRunning,
  activeForces,
  onForceUpdate,
}) => {
  const [forcingVar, setForcingVar] = useState<Variable | null>(null);
  const [forceVal, setForceVal] = useState<string>('');
  const [forceError, setForceError] = useState<string | null>(null);
  const [isSendingForce, setIsSendingForce] = useState(false);

  // Расчёт смещений (packed layout) и поиск дубликатов имён
  const { offsets, totalBytes, duplicateNames } = useMemo(() => {
    const offs: number[] = [];
    let acc = 0;
    const counts: Record<string, number> = {};
    dataBlock.variables.forEach((v) => {
      offs.push(acc);
      acc += getTypeByteSize(v.type);
      counts[v.name] = (counts[v.name] || 0) + 1;
    });
    const dups = new Set(Object.keys(counts).filter((k) => counts[k] > 1));
    return { offsets: offs, totalBytes: acc, duplicateNames: dups };
  }, [dataBlock.variables]);

  const handleAddVariable = () => {
    let idx = dataBlock.variables.length + 1;
    const existing = new Set(dataBlock.variables.map((v) => v.name));
    while (existing.has(`Param_${idx}`)) idx++;

    const newVar: Variable = {
      name: `Param_${idx}`,
      type: 'REAL',
      initValue: '0.0',
      retain: false,
      comment: '',
    };
    onChange({
      ...dataBlock,
      variables: [...dataBlock.variables, newVar],
    });
  };

  const handleUpdate = (index: number, field: keyof Variable, value: any) => {
    const oldVar = dataBlock.variables[index];
    const updatedVars = [...dataBlock.variables];
    updatedVars[index] = { ...oldVar, [field]: value };

    if (field === 'type') {
      const t = value as IecType;
      if (t === 'BOOL') updatedVars[index].initValue = 'false';
      else if (t === 'REAL') updatedVars[index].initValue = '0.0';
      else updatedVars[index].initValue = '0';
    }

    const renamed =
      field === 'name' && oldVar.name !== value
        ? { oldName: `"${dataBlock.name}".${oldVar.name}`, newName: `"${dataBlock.name}".${value}` }
        : undefined;

    onChange({ ...dataBlock, variables: updatedVars }, renamed);
  };

  const handleDelete = (index: number) => {
    onChange({
      ...dataBlock,
      variables: dataBlock.variables.filter((_, i) => i !== index),
    });
  };

  const openForceModal = (v: Variable) => {
    const fullKey = `"${dataBlock.name}".${v.name}`;
    const current = liveData[fullKey];
    const existing = activeForces[fullKey];
    setForcingVar(v);
    setForceError(null);
    setForceVal(existing?.active ? existing.value : String(current !== undefined ? current : v.initValue));
  };

  const sendForceCommand = async (v: Variable, value: string, active: boolean) => {
    if (active) {
      const err = validateValueForType(value, v.type);
      if (err) {
        setForceError(err);
        return;
      }
    }
    setIsSendingForce(true);
    try {
      const resp = await fetch('/api/force', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dbId: dataBlock.id,
          varName: v.name,
          value,
          active,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        onForceUpdate(data.forces || {}, data.message);
        setForcingVar(null);
      } else {
        setForceError(data.error || 'Ошибка применения Force');
      }
    } catch (err: any) {
      setForceError(err.message);
    } finally {
      setIsSendingForce(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] border border-[#2d2d30] relative">
      {/* Шапка редактора блока данных */}
      <div className="h-10 bg-[#252526] border-b border-[#2d2d30] px-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Database size={15} className="text-[#3b82f6]" />
            <span className="font-semibold text-white text-sm">{dataBlock.name}</span>
            <span className="text-[#a1a1aa] font-mono">
              [DB{dataBlock.id} | Packed Size: {totalBytes} B]
            </span>
          </div>
        </div>

        <button
          onClick={handleAddVariable}
          className="flex items-center gap-1.5 px-3 py-1 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-xs font-medium transition"
        >
          <Plus size={14} /> Добавить переменную
        </button>
      </div>

      {/* Таблица переменных с постоянной колонкой Online и колонками Offset/Size */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs font-mono text-left">
          <thead className="bg-[#2d2d30] text-[#e4e4e7] sticky top-0 z-10 select-none">
            <tr className="border-b border-[#3e3e42]">
              <th className="w-10 px-2 py-2 border-r border-[#3e3e42] text-center">#</th>
              <th className="w-24 px-2 py-2 border-r border-[#3e3e42]">Offset (B)</th>
              <th className="w-56 px-2 py-2 border-r border-[#3e3e42]">Имя переменной</th>
              <th className="w-28 px-2 py-2 border-r border-[#3e3e42]">Тип</th>
              <th className="w-36 px-2 py-2 border-r border-[#3e3e42]">Начальное (Init)</th>
              <th className="w-56 px-2 py-2 border-r border-[#3e3e42] bg-[#252526] text-emerald-400">
                Online / Force (SHM)
              </th>
              <th className="w-16 px-2 py-2 border-r border-[#3e3e42] text-center">Retain</th>
              <th className="px-2 py-2 border-r border-[#3e3e42]">Комментарий</th>
              <th className="w-10 px-2 py-2 text-center"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2d2d30]">
            {dataBlock.variables.map((v, idx) => {
              const fullKey = `"${dataBlock.name}".${v.name}`;
              const liveVal = liveData[fullKey];
              const isForced = activeForces[fullKey]?.active;
              const isDup = duplicateNames.has(v.name);
              const initErr = validateValueForType(v.initValue, v.type);
              const sz = getTypeByteSize(v.type);

              return (
                <tr
                  key={idx}
                  className={`group ${
                    isForced ? 'bg-amber-950/25 hover:bg-amber-950/40' : 'hover:bg-[#2a2d2e]'
                  }`}
                >
                  <td className="px-2 py-1.5 border-r border-[#2d2d30] text-center text-[#a1a1aa]">
                    {idx + 1}
                  </td>
                  <td className="px-2 py-1.5 border-r border-[#2d2d30] text-[#a1a1aa]">
                    +{offsets[idx]} <span className="text-[11px] text-[#71717a]">({sz}B)</span>
                  </td>
                  <td className="px-1.5 py-1 border-r border-[#2d2d30]">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={v.name}
                        onChange={(e) => handleUpdate(idx, 'name', e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && idx === dataBlock.variables.length - 1) {
                            handleAddVariable();
                          }
                        }}
                        className={`w-full bg-transparent px-1.5 py-0.5 rounded outline-none focus:bg-[#3c3c3c] ${
                          isDup ? 'text-rose-400 border border-rose-500' : 'text-[#9cdcfe]'
                        }`}
                      />
                      {isDup && (
                        <span title="Дубликат имени переменной!">
                          <AlertTriangle size={13} className="text-rose-400 shrink-0" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-1.5 py-1 border-r border-[#2d2d30]">
                    <select
                      value={v.type}
                      onChange={(e) => handleUpdate(idx, 'type', e.target.value as IecType)}
                      className="w-full bg-[#252526] px-1.5 py-1 text-[#4ec9b0] rounded outline-none border border-transparent focus:border-[#007acc]"
                    >
                      {IEC_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1.5 py-1 border-r border-[#2d2d30]">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={v.initValue}
                        onChange={(e) => handleUpdate(idx, 'initValue', e.target.value)}
                        className={`w-full bg-transparent px-1.5 py-0.5 rounded outline-none focus:bg-[#3c3c3c] ${
                          initErr ? 'text-rose-400 border border-rose-500' : 'text-[#b5cea8]'
                        }`}
                      />
                      {initErr && (
                        <span title={initErr}>
                          <AlertTriangle size={13} className="text-rose-400 shrink-0" />
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Постоянная колонка Online / Force */}
                  <td
                    onClick={() => openForceModal(v)}
                    className={`px-2.5 py-1.5 border-r border-[#2d2d30] cursor-pointer transition ${
                      isForced
                        ? 'bg-amber-900/40 hover:bg-amber-900/60'
                        : 'bg-[#1a221d] hover:bg-[#223027]'
                    }`}
                    title="Кликните для управления Force в разделяемой памяти"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {isForced && (
                          <span className="px-1.5 py-0.2 bg-amber-500 text-black font-extrabold rounded text-[10px]">
                            FORCED
                          </span>
                        )}
                        <span
                          className={`font-bold ${
                            !isCoreRunning
                              ? 'text-[#71717a]'
                              : isForced
                              ? 'text-amber-300'
                              : 'text-emerald-300'
                          }`}
                        >
                          {isCoreRunning && liveVal !== undefined ? String(liveVal) : 'OFFLINE'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        {isForced ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              sendForceCommand(v, '', false);
                            }}
                            className="flex items-center gap-1 px-1.5 py-0.5 bg-rose-700 hover:bg-rose-600 text-white rounded text-[10px] font-sans transition"
                          >
                            <ZapOff size={10} /> Unforce
                          </button>
                        ) : (
                          <span className="text-[10px] text-[#a1a1aa] group-hover:text-amber-300 flex items-center gap-0.5">
                            <Zap size={11} /> Force
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  <td className="px-2 py-1.5 border-r border-[#2d2d30] text-center">
                    <input
                      type="checkbox"
                      checked={v.retain}
                      onChange={(e) => handleUpdate(idx, 'retain', e.target.checked)}
                      className="cursor-pointer accent-[#0e639c]"
                    />
                  </td>
                  <td className="px-1.5 py-1 border-r border-[#2d2d30]">
                    <input
                      type="text"
                      value={v.comment || ''}
                      onChange={(e) => handleUpdate(idx, 'comment', e.target.value)}
                      className="w-full bg-transparent px-1.5 py-0.5 rounded text-[#86efac] outline-none font-sans focus:bg-[#3c3c3c]"
                      placeholder="Описание параметра..."
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      onClick={() => handleDelete(idx)}
                      className="text-[#a1a1aa] hover:text-rose-400 transition"
                      title="Удалить переменную"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Модальное окно Force с переключателем BOOL и валидацией диапазона */}
      {forcingVar && (
        <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50">
          <div className="bg-[#252526] border border-[#3e3e42] rounded-lg shadow-2xl w-[400px] overflow-hidden text-xs">
            <div className="bg-[#2d2d30] px-4 py-2.5 border-b border-[#3e3e42] flex justify-between items-center">
              <div className="flex items-center gap-2 text-amber-400 font-semibold">
                <Zap size={15} />
                <span>Форсирование в SHM (Мгновенно без GCC)</span>
              </div>
              <button onClick={() => setForcingVar(null)} className="text-[#a1a1aa] hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-3 font-mono">
              <div className="flex justify-between py-1 border-b border-[#333333]">
                <span className="text-[#a1a1aa]">Полный адрес:</span>
                <span className="text-[#9cdcfe] font-bold">"{dataBlock.name}".{forcingVar.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#333333]">
                <span className="text-[#a1a1aa]">Тип данных:</span>
                <span className="text-emerald-400 font-bold">{forcingVar.type} ({getTypeByteSize(forcingVar.type)} байт)</span>
              </div>

              <div className="pt-1">
                <label className="block text-[#d4d4d8] mb-1.5 font-sans">Задать удерживаемое значение:</label>
                {forcingVar.type === 'BOOL' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { setForceVal('true'); setForceError(null); }}
                      className={`py-2 rounded font-bold transition border ${
                        forceVal.toLowerCase() === 'true'
                          ? 'bg-emerald-600 border-emerald-400 text-white'
                          : 'bg-[#1e1e1e] border-[#3e3e42] text-[#a1a1aa] hover:text-white'
                      }`}
                    >
                      TRUE (1)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setForceVal('false'); setForceError(null); }}
                      className={`py-2 rounded font-bold transition border ${
                        forceVal.toLowerCase() === 'false'
                          ? 'bg-rose-700 border-rose-500 text-white'
                          : 'bg-[#1e1e1e] border-[#3e3e42] text-[#a1a1aa] hover:text-white'
                      }`}
                    >
                      FALSE (0)
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={forceVal}
                    autoFocus
                    onChange={(e) => {
                      setForceVal(e.target.value);
                      setForceError(validateValueForType(e.target.value, forcingVar.type));
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && sendForceCommand(forcingVar, forceVal, true)}
                    className="w-full bg-[#1e1e1e] border border-[#3e3e42] focus:border-amber-500 px-3 py-1.5 rounded text-white outline-none"
                  />
                )}
                {forceError && (
                  <div className="text-rose-400 text-[11px] font-sans mt-1.5 flex items-center gap-1">
                    <AlertTriangle size={12} /> {forceError}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-[#1e1e1e] px-4 py-2.5 border-t border-[#3e3e42] flex justify-between items-center">
              {activeForces[`"${dataBlock.name}".${forcingVar.name}`]?.active ? (
                <button
                  type="button"
                  onClick={() => sendForceCommand(forcingVar, '', false)}
                  disabled={isSendingForce}
                  className="flex items-center gap-1 px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white rounded transition"
                >
                  <ZapOff size={13} /> Снять Force
                </button>
              ) : <div />}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForcingVar(null)}
                  className="px-3 py-1.5 bg-[#2d2d30] hover:bg-[#3e3e42] text-[#e4e4e7] rounded transition"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => sendForceCommand(forcingVar, forceVal, true)}
                  disabled={isSendingForce || Boolean(forceError)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded font-medium transition"
                >
                  <Check size={14} /> Применить Force
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
