import React, { useState } from 'react';
import type { DataBlock, Variable, IecType, LiveDbSnapshot } from '../types/plc';
import { Plus, Trash2, Database, Zap, X, Check } from 'lucide-react';

interface DbEditorProps {
  dataBlock: DataBlock;
  onChange: (updated: DataBlock) => void;
  liveData: LiveDbSnapshot | null;
  isOnline: boolean;
}

const IEC_TYPES: IecType[] = ['BOOL', 'INT', 'DINT', 'REAL', 'TIME', 'WORD'];

export const DbEditor: React.FC<DbEditorProps> = ({ dataBlock, onChange, liveData, isOnline }) => {
  // Состояние модального окна Force
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
    setForceVal(String(current !== undefined ? current : v.initValue));
  };

  const submitForce = async () => {
    if (!forcingVar) return;
    setIsSendingForce(true);
    try {
      await fetch('http://localhost:8080/api/force', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dbId: dataBlock.id,
          varName: forcingVar.variable.name,
          varType: forcingVar.variable.type,
          value: forceVal,
        }),
      });
      setForcingVar(null);
    } catch (err) {
      console.error('Ошибка форсирования:', err);
    } finally {
      setIsSendingForce(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] border border-[#2d2d30] relative">
      {/* Тулбар блока данных */}
      <div className="h-9 bg-[#252526] border-b border-[#2d2d30] px-3 flex items-center justify-between text-xs select-none">
        <div className="flex items-center gap-2">
          <Database size={14} className="text-[#007acc]" />
          <span className="font-semibold text-[#e1e1e1]">{dataBlock.name}</span>
          <span className="text-[#858585]">[DB{dataBlock.id} | {dataBlock.type}]</span>
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
              <th className="w-56 px-2 py-1.5 border-r border-[#3e3e42] font-normal">Имя переменной</th>
              <th className="w-32 px-2 py-1.5 border-r border-[#3e3e42] font-normal">Тип данных</th>
              <th className="w-36 px-2 py-1.5 border-r border-[#3e3e42] font-normal">Начальное значение</th>
              {isOnline && (
                <th className="w-40 px-2 py-1.5 border-r border-[#3e3e42] font-normal text-[#4ec9b0] bg-[#252526]">
                  Online значение (Force)
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
              return (
                <tr 
                  key={idx} 
                  className="hover:bg-[#2a2d2e] group"
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
                      className="w-full bg-transparent px-1.5 py-0.5 rounded text-[#9cdcfe] outline-none focus:bg-[#3c3c3c] focus:ring-1 focus:ring-[#007acc]"
                    />
                  </td>
                  <td className="px-1 py-0.5 border-r border-[#2d2d30]">
                    <select
                      value={v.type}
                      onChange={(e) => handleUpdate(idx, 'type', e.target.value as IecType)}
                      className="w-full bg-[#252526] px-1 py-0.5 text-[#4ec9b0] rounded outline-none border border-transparent focus:border-[#007acc]"
                    >
                      {IEC_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-0.5 border-r border-[#2d2d30]">
                    <input
                      type="text"
                      value={v.initValue}
                      onChange={(e) => handleUpdate(idx, 'initValue', e.target.value)}
                      className="w-full bg-transparent px-1.5 py-0.5 rounded text-[#b5cea8] outline-none focus:bg-[#3c3c3c] focus:ring-1 focus:ring-[#007acc]"
                    />
                  </td>
                  {isOnline && (
                    <td 
                      className="px-2 py-1 border-r border-[#2d2d30] bg-[#1e2420] cursor-pointer hover:bg-[#223326] transition"
                      onClick={() => openForceModal(v)}
                      title="Кликните для принудительной записи (Force Value)"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[#4ec9b0] font-bold">
                          {liveVal !== undefined ? String(liveVal) : '---'}
                        </span>
                        <Zap size={12} className="text-[#858585] group-hover:text-amber-400 opacity-60 group-hover:opacity-100" />
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
                      className="w-full bg-transparent px-1.5 py-0.5 rounded text-[#6a9955] outline-none font-sans focus:bg-[#3c3c3c] focus:ring-1 focus:ring-[#007acc]"
                      placeholder="Добавить комментарий..."
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button
                      onClick={() => handleDelete(idx)}
                      className="text-[#858585] hover:text-[#f14c4c] opacity-0 group-hover:opacity-100 transition"
                      title="Удалить"
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

      {/* Модальное окно Force Value */}
      {forcingVar && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center z-50">
          <div className="bg-[#252526] border border-[#3e3e42] rounded-lg shadow-2xl w-96 overflow-hidden text-xs">
            <div className="bg-[#2d2d30] px-4 py-2.5 border-b border-[#3e3e42] flex justify-between items-center select-none">
              <div className="flex items-center gap-2 text-amber-400 font-semibold font-mono">
                <Zap size={14} />
                <span>Modify / Force Value</span>
              </div>
              <button 
                onClick={() => setForcingVar(null)}
                className="text-[#858585] hover:text-white"
              >
                <X size={15} />
              </button>
            </div>

            <div className="p-4 space-y-3 font-mono">
              <div className="flex justify-between py-1 border-b border-[#333333]">
                <span className="text-[#858585]">Переменная:</span>
                <span className="text-[#9cdcfe] font-bold">"{dataBlock.name}".{forcingVar.variable.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#333333]">
                <span className="text-[#858585]">Тип данных:</span>
                <span className="text-[#4ec9b0]">{forcingVar.variable.type}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#333333]">
                <span className="text-[#858585]">Текущее значение:</span>
                <span className="text-emerald-400">{String(forcingVar.currentVal)}</span>
              </div>

              <div className="pt-2">
                <label className="block text-[#858585] mb-1.5 font-sans">Новое форсированное значение:</label>
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
                    onKeyDown={(e) => e.key === 'Enter' && submitForce()}
                    className="w-full bg-[#1e1e1e] border border-[#3e3e42] focus:border-[#007acc] px-3 py-1.5 rounded text-white outline-none"
                    placeholder="Введите значение..."
                  />
                )}
              </div>
            </div>

            <div className="bg-[#1e1e1e] px-4 py-2.5 border-t border-[#3e3e42] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setForcingVar(null)}
                className="px-3 py-1 bg-[#2d2d30] hover:bg-[#3e3e42] text-[#cccccc] rounded transition"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={submitForce}
                disabled={isSendingForce}
                className="flex items-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium transition"
              >
                <Check size={14} />
                {isSendingForce ? 'Запись...' : 'Применить Force'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
