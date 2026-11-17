import React, { useState } from 'react';
import type { DataBlock, Variable, IecType, LiveDbSnapshot } from '../types/plc';
import { Plus, Trash2, Database, Zap, ZapOff, X, Check } from 'lucide-react';

export interface ForceEntry {
  active: boolean;
  value: string;
}

interface DbEditorProps {
  dataBlock: DataBlock;
  onChange: (updated: DataBlock) => void;
  liveData: LiveDbSnapshot | null;
  isOnline: boolean;
  activeForces: Record<string, ForceEntry>;
  onForceUpdate: (forces: Record<string, ForceEntry>, msg: string) => void;
}

const IEC_TYPES: IecType[] = ['BOOL', 'INT', 'DINT', 'REAL', 'TIME', 'WORD'];

export const DbEditor: React.FC<DbEditorProps> = ({
  dataBlock,
  onChange,
  liveData,
  isOnline,
  activeForces,
  onForceUpdate,
}) => {
  const [forcingVar, setForcingVar] = useState<{ variable: Variable; currentVal: any } | null>(null);
  const [forceVal, setForceVal] = useState<string>('');
  const [isSendingForce, setIsSendingForce] = useState(false);

  const handleAddVariable = () => {
    const newVar: Variable = {
      name: `Var_${dataBlock.variables.length + 1}`,
      type: 'REAL',
      initValue: '0.0',
      retain: false,
      comment: 'Технологический параметр',
    };
    onChange({
      ...dataBlock,
      variables: [...dataBlock.variables, newVar],
    });
  };

  const handleUpdate = (index: number, field: keyof Variable, value: any) => {
    const updatedVars = [...dataBlock.variables];
    updatedVars[index] = { ...updatedVars[index], [field]: value };
    onChange({ ...dataBlock, variables: updatedVars });
  };

  const handleDelete = (index: number) => {
    const updatedVars = dataBlock.variables.filter((_, i) => i !== index);
    onChange({ ...dataBlock, variables: updatedVars });
  };

  const openForceModal = (v: Variable) => {
    if (!isOnline) return;
    const current = liveData ? liveData[v.name] : v.initValue;
    setForcingVar({ variable: v, currentVal: current });
    const existing = activeForces[v.name];
    setForceVal(existing?.active ? existing.value : String(current !== undefined ? current : v.initValue));
  };

  const sendForceCommand = async (varName: string, value: string, active: boolean) => {
    setIsSendingForce(true);
    try {
      const resp = await fetch('http://localhost:8080/api/force', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dbId: dataBlock.id,
          varName,
          value,
          active,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        onForceUpdate(data.forces || {}, data.message);
      }
      setForcingVar(null);
    } catch (err) {
      console.error('Ошибка управления Force:', err);
    } finally {
      setIsSendingForce(false);
    }
  };

  const activeForceCount = Object.values(activeForces).filter(f => f.active).length;

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] border border-[#2d2d30] relative">
      {/* Тулбар блока данных */}
      <div className="h-9 bg-[#252526] border-b border-[#2d2d30] px-3 flex items-center justify-between text-xs select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Database size={14} className="text-[#007acc]" />
            <span className="font-semibold text-[#e1e1e1]">{dataBlock.name}</span>
            <span className="text-[#858585]">[DB{dataBlock.id} | {dataBlock.type}]</span>
          </div>

          {activeForceCount > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/50 text-amber-300 font-mono text-[11px] animate-pulse">
              <Zap size={12} className="text-amber-400" />
              <span>FORCE ACTIVE ({activeForceCount})</span>
            </div>
          )}
        </div>

        <button
          onClick={handleAddVariable}
          className="flex items-center gap-1 px-2.5 py-1 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-xs transition"
        >
          <Plus size={13} /> Добавить строку
        </button>
      </div>

      {/* Таблица Data Block */}
      <div className="flex-1 overflow-auto bg-[#1e1e1e]">
        <table className="w-full border-collapse text-xs font-mono text-left">
          <thead className="bg-[#2d2d30] text-[#cccccc] sticky top-0 select-none z-10">
            <tr className="border-b border-[#3e3e42]">
              <th className="w-10 px-2 py-1.5 border-r border-[#3e3e42] text-center font-normal">#</th>
              <th className="w-52 px-2 py-1.5 border-r border-[#3e3e42] font-normal">Имя переменной</th>
              <th className="w-28 px-2 py-1.5 border-r border-[#3e3e42] font-normal">Тип данных</th>
              <th className="w-32 px-2 py-1.5 border-r border-[#3e3e42] font-normal">Начальное</th>
              {isOnline && (
                <th className="w-52 px-2 py-1.5 border-r border-[#3e3e42] font-normal text-[#4ec9b0] bg-[#252526]">
                  Online / Force Status
                </th>
              )}
              <th className="w-16 px-2 py-1.5 border-r border-[#3e3e42] text-center font-normal">Retain</th>
              <th className="px-2 py-1.5 border-r border-[#3e3e42] font-normal">Комментарий</th>
              <th className="w-10 px-2 py-1.5 text-center font-normal"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2d2d30]">
            {dataBlock.variables.map((v, idx) => {
              const liveVal = liveData ? liveData[v.name] : undefined;
              const isForced = activeForces[v.name]?.active;

              return (
                <tr 
                  key={idx} 
                  className={`group ${isForced ? 'bg-amber-950/20 hover:bg-amber-950/30' : 'hover:bg-[#2a2d2e]'}`}
                  onDoubleClick={() => openForceModal(v)}
                >
                  <td className="px-2 py-1 border-r border-[#2d2d30] text-center text-[#858585] select-none">
                    {idx + 1}
                  </td>
                  <td className="px-1 py-0.5 border-r border-[#2d2d30]">
                    <input
                      type="text"
                      value={v.name}
                      onChange={(e) => handleUpdate(idx, 'name', e.target.value)}
                      className="w-full bg-transparent px-1.5 py-0.5 rounded text-[#9cdcfe] outline-none focus:bg-[#3c3c3c]"
                    />
                  </td>
                  <td className="px-1 py-0.5 border-r border-[#2d2d30]">
                    <select
                      value={v.type}
                      onChange={(e) => handleUpdate(idx, 'type', e.target.value as IecType)}
                      className="w-full bg-[#252526] px-1 py-0.5 text-[#4ec9b0] rounded outline-none"
                    >
                      {IEC_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-0.5 border-r border-[#2d2d30]">
                    <input
                      type="text"
                      value={v.initValue}
                      onChange={(e) => handleUpdate(idx, 'initValue', e.target.value)}
                      className="w-full bg-transparent px-1.5 py-0.5 rounded text-[#b5cea8] outline-none focus:bg-[#3c3c3c]"
                    />
                  </td>
                  {isOnline && (
                    <td 
                      className={`px-2 py-1 border-r border-[#2d2d30] cursor-pointer transition ${
                        isForced ? 'bg-amber-900/40 hover:bg-amber-900/60' : 'bg-[#1e2420] hover:bg-[#223326]'
                      }`}
                      onClick={() => openForceModal(v)}
                      title={isForced ? 'Переменная ФОРСИРОВАНА! Кликните для изменения или снятия Force' : 'Кликните для принудительной записи (Force)'}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          {isForced && (
                            <span className="px-1 py-0.2 bg-amber-500 text-black font-extrabold rounded text-[10px]">
                              F
                            </span>
                          )}
                          <span className={`font-bold ${isForced ? 'text-amber-300' : 'text-[#4ec9b0]'}`}>
                            {liveVal !== undefined ? String(liveVal) : '---'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          {isForced ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                sendForceCommand(v.name, '', false);
                              }}
                              className="flex items-center gap-0.5 px-1.5 py-0.5 bg-rose-800/80 hover:bg-rose-700 text-rose-100 rounded text-[10px] transition"
                              title="Снять форсирование (Unforce)"
                            >
                              <ZapOff size={10} /> Unforce
                            </button>
                          ) : (
                            <Zap size={12} className="text-[#858585] group-hover:text-amber-400 opacity-60 group-hover:opacity-100" />
                          )}
                        </div>
                      </div>
                    </td>
                  )}
                  <td className="px-2 py-1 border-r border-[#2d2d30] text-center">
                    <input
                      type="checkbox"
                      checked={v.retain}
                      onChange={(e) => handleUpdate(idx, 'retain', e.target.checked)}
                      className="cursor-pointer accent-[#0e639c]"
                    />
                  </td>
                  <td className="px-1 py-0.5 border-r border-[#2d2d30]">
                    <input
                      type="text"
                      value={v.comment || ''}
                      onChange={(e) => handleUpdate(idx, 'comment', e.target.value)}
                      className="w-full bg-transparent px-1.5 py-0.5 rounded text-[#6a9955] outline-none font-sans focus:bg-[#3c3c3c]"
                      placeholder="Добавить комментарий..."
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button
                      onClick={() => handleDelete(idx)}
                      className="text-[#858585] hover:text-[#f14c4c] opacity-0 group-hover:opacity-100 transition"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Модальное окно Force / Unforce */}
      {forcingVar && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center z-50">
          <div className="bg-[#252526] border border-[#3e3e42] rounded-lg shadow-2xl w-96 overflow-hidden text-xs">
            <div className="bg-[#2d2d30] px-4 py-2.5 border-b border-[#3e3e42] flex justify-between items-center select-none">
              <div className="flex items-center gap-2 text-amber-400 font-semibold font-mono">
                <Zap size={14} />
                <span>Force Value Control</span>
              </div>
              <button onClick={() => setForcingVar(null)} className="text-[#858585] hover:text-white">
                <X size={15} />
              </button>
            </div>

            <div className="p-4 space-y-3 font-mono">
              <div className="flex justify-between py-1 border-b border-[#333333]">
                <span className="text-[#858585]">Переменная:</span>
                <span className="text-[#9cdcfe] font-bold">"{dataBlock.name}".{forcingVar.variable.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#333333]">
                <span className="text-[#858585]">Режим Force:</span>
                {activeForces[forcingVar.variable.name]?.active ? (
                  <span className="text-amber-400 font-bold">ВКЛЮЧЁН (Удерживается циклом)</span>
                ) : (
                  <span className="text-[#858585]">ОТКЛЮЧЁН (Управляется программой)</span>
                )}
              </div>

              <div className="pt-1">
                <label className="block text-[#858585] mb-1.5 font-sans">Задать принудительное значение:</label>
                {forcingVar.variable.type === 'BOOL' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setForceVal('true')}
                      className={`py-1.5 rounded font-bold transition border ${
                        forceVal === 'true'
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585] hover:text-white'
                      }`}
                    >
                      TRUE
                    </button>
                    <button
                      type="button"
                      onClick={() => setForceVal('false')}
                      className={`py-1.5 rounded font-bold transition border ${
                        forceVal === 'false'
                          ? 'bg-rose-700 border-rose-600 text-white'
                          : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585] hover:text-white'
                      }`}
                    >
                      FALSE
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={forceVal}
                    autoFocus
                    onChange={(e) => setForceVal(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendForceCommand(forcingVar.variable.name, forceVal, true)}
                    className="w-full bg-[#1e1e1e] border border-[#3e3e42] focus:border-amber-500 px-3 py-1.5 rounded text-white outline-none"
                    placeholder="Введите число..."
                  />
                )}
              </div>
            </div>

            <div className="bg-[#1e1e1e] px-4 py-2.5 border-t border-[#3e3e42] flex justify-between items-center">
              {activeForces[forcingVar.variable.name]?.active ? (
                <button
                  type="button"
                  onClick={() => sendForceCommand(forcingVar.variable.name, '', false)}
                  disabled={isSendingForce}
                  className="flex items-center gap-1 px-2.5 py-1 bg-rose-800 hover:bg-rose-700 text-white rounded transition"
                >
                  <ZapOff size={13} /> Снять Force
                </button>
              ) : (
                <div />
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForcingVar(null)}
                  className="px-3 py-1 bg-[#2d2d30] hover:bg-[#3e3e42] text-[#cccccc] rounded transition"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => sendForceCommand(forcingVar.variable.name, forceVal, true)}
                  disabled={isSendingForce}
                  className="flex items-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium transition"
                >
                  <Check size={14} /> Включить Force
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
