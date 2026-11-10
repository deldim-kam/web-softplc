import React from 'react';
import { DataBlock, Variable, IecType, LiveDbSnapshot } from '../types/plc';
import { Plus, Trash2, Radio } from 'lucide-react';

interface DbEditorProps {
  dataBlock: DataBlock;
  onChange: (updated: DataBlock) => void;
  liveData: LiveDbSnapshot | null;
  isOnline: boolean;
}

const IEC_TYPES: IecType[] = ['BOOL', 'INT', 'DINT', 'REAL', 'TIME', 'WORD'];

export const DbEditor: React.FC<DbEditorProps> = ({ dataBlock, onChange, liveData, isOnline }) => {
  const handleAddVariable = () => {
    const newVar: Variable = {
      name: `Var_${dataBlock.variables.length + 1}`,
      type: 'REAL',
      initValue: '0.0',
      retain: false,
      comment: 'Новый технологический параметр',
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

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xl">
      <div className="px-5 py-4 bg-slate-800/80 border-b border-slate-700 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="bg-blue-600/20 text-blue-400 border border-blue-500/30 font-mono text-xs px-2.5 py-1 rounded">
            DB{dataBlock.id}
          </span>
          <h2 className="text-lg font-semibold text-slate-100">{dataBlock.name}</h2>
          <span className="text-xs text-slate-400 uppercase tracking-wider">({dataBlock.type})</span>
        </div>

        <button
          onClick={handleAddVariable}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm transition font-medium"
        >
          <Plus size={16} /> Добавить строку
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950/60 text-slate-400 font-mono text-xs border-b border-slate-800 uppercase">
            <tr>
              <th className="py-3 px-4 w-12 text-center">#</th>
              <th className="py-3 px-4">Имя переменной</th>
              <th className="py-3 px-4 w-32">Тип данных</th>
              <th className="py-3 px-4 w-32">Начальное</th>
              {isOnline && <th className="py-3 px-4 w-36 text-emerald-400">Online значение</th>}
              <th className="py-3 px-4 w-24 text-center">Retain</th>
              <th className="py-3 px-4">Комментарий</th>
              <th className="py-3 px-4 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {dataBlock.variables.map((v, idx) => {
              const liveValue = liveData ? liveData[v.name] : undefined;

              return (
                <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-2.5 px-4 text-center text-slate-500 text-xs">{idx + 1}</td>
                  <td className="py-2.5 px-4">
                    <input
                      type="text"
                      value={v.name}
                      onChange={(e) => handleUpdate(idx, 'name', e.target.value)}
                      className="bg-transparent border border-transparent hover:border-slate-700 focus:border-blue-500 focus:bg-slate-950 px-2 py-1 rounded w-full text-slate-200 outline-none"
                    />
                  </td>
                  <td className="py-2.5 px-4">
                    <select
                      value={v.type}
                      onChange={(e) => handleUpdate(idx, 'type', e.target.value as IecType)}
                      className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-300 outline-none w-full"
                    >
                      {IEC_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2.5 px-4">
                    <input
                      type="text"
                      value={v.initValue}
                      onChange={(e) => handleUpdate(idx, 'initValue', e.target.value)}
                      className="bg-transparent border border-transparent hover:border-slate-700 focus:border-blue-500 focus:bg-slate-950 px-2 py-1 rounded w-full text-slate-200 outline-none"
                    />
                  </td>
                  {isOnline && (
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2 bg-emerald-950/40 border border-emerald-800/50 px-2.5 py-1 rounded">
                        <Radio size={12} className="text-emerald-400 animate-pulse" />
                        <span className="text-emerald-300 font-semibold">
                          {liveValue !== undefined ? String(liveValue) : '---'}
                        </span>
                      </div>
                    </td>
                  )}
                  <td className="py-2.5 px-4 text-center">
                    <input
                      type="checkbox"
                      checked={v.retain}
                      onChange={(e) => handleUpdate(idx, 'retain', e.target.checked)}
                      className="rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-0 cursor-pointer"
                    />
                  </td>
                  <td className="py-2.5 px-4">
                    <input
                      type="text"
                      value={v.comment || ''}
                      onChange={(e) => handleUpdate(idx, 'comment', e.target.value)}
                      className="bg-transparent border border-transparent hover:border-slate-700 focus:border-blue-500 focus:bg-slate-950 px-2 py-1 rounded w-full text-slate-400 outline-none font-sans text-xs"
                      placeholder="Описание..."
                    />
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <button
                      onClick={() => handleDelete(idx)}
                      className="text-slate-500 hover:text-rose-400 transition"
                      title="Удалить переменную"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
