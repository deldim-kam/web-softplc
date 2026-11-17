import React, { useState } from 'react';
import type { BlockType } from '../types/plc';
import { X, Check, Box, Cpu, FileCode, Database } from 'lucide-react';

interface NewBlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddProgramBlock: (block: { type: BlockType; number: number; name: string }) => void;
  onAddDataBlock: (db: { number: number; name: string; type: 'global' | 'instance' }) => void;
}

export const NewBlockModal: React.FC<NewBlockModalProps> = ({
  isOpen,
  onClose,
  onAddProgramBlock,
  onAddDataBlock,
}) => {
  const [category, setCategory] = useState<'OB' | 'FB' | 'FC' | 'DB'>('FC');
  const [number, setNumber] = useState(1);
  const [name, setName] = useState('Calc_Speed');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (category === 'DB') {
      onAddDataBlock({
        number,
        name: name.trim(),
        type: 'global',
      });
    } else {
      onAddProgramBlock({
        type: category,
        number,
        name: name.trim(),
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-50 select-none">
      <div className="bg-[#252526] border border-[#3e3e42] rounded-lg shadow-2xl w-[480px] overflow-hidden text-xs">
        
        {/* Заголовок */}
        <div className="bg-[#2d2d30] px-4 py-2.5 border-b border-[#3e3e42] flex justify-between items-center">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Box size={15} className="text-[#007acc]" />
            <span>Add new block (Добавить новый блок)</span>
          </div>
          <button onClick={onClose} className="text-[#858585] hover:text-white">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-4">
            {/* Выбор типа блока (Плитки TIA Portal Style) */}
            <div>
              <label className="block text-[#858585] mb-2 font-mono">Тип программного блока:</label>
              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => { setCategory('OB'); setName('Cyclic_Task'); }}
                  className={`p-2.5 rounded border flex flex-col items-center gap-1.5 transition ${
                    category === 'OB'
                      ? 'bg-[#094771] border-[#007acc] text-white'
                      : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585] hover:text-white'
                  }`}
                >
                  <Cpu size={20} className="text-[#4ec9b0]" />
                  <span className="font-bold">OB</span>
                  <span className="text-[10px] text-[#858585]">Organization</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setCategory('FB'); setName('Drive_Control'); }}
                  className={`p-2.5 rounded border flex flex-col items-center gap-1.5 transition ${
                    category === 'FB'
                      ? 'bg-[#094771] border-[#007acc] text-white'
                      : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585] hover:text-white'
                  }`}
                >
                  <FileCode size={20} className="text-[#c586c0]" />
                  <span className="font-bold">FB</span>
                  <span className="text-[10px] text-[#858585]">Func. Block</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setCategory('FC'); setName('Scale_Analog'); }}
                  className={`p-2.5 rounded border flex flex-col items-center gap-1.5 transition ${
                    category === 'FC'
                      ? 'bg-[#094771] border-[#007acc] text-white'
                      : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585] hover:text-white'
                  }`}
                >
                  <FileCode size={20} className="text-[#4ec9b0]" />
                  <span className="font-bold">FC</span>
                  <span className="text-[10px] text-[#858585]">Function</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setCategory('DB'); setName('Alarms_Data'); }}
                  className={`p-2.5 rounded border flex flex-col items-center gap-1.5 transition ${
                    category === 'DB'
                      ? 'bg-[#094771] border-[#007acc] text-white'
                      : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585] hover:text-white'
                  }`}
                >
                  <Database size={20} className="text-[#007acc]" />
                  <span className="font-bold">DB</span>
                  <span className="text-[10px] text-[#858585]">Data Block</span>
                </button>
              </div>
            </div>

            {/* Имя и номер */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[#858585] mb-1 font-mono">Номер ({category}):</label>
                <input
                  type="number"
                  min="1"
                  max="9999"
                  value={number}
                  onChange={(e) => setNumber(parseInt(e.target.value) || 1)}
                  className="w-full bg-[#1e1e1e] border border-[#3e3e42] focus:border-[#007acc] px-2.5 py-1.5 rounded text-white outline-none font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[#858585] mb-1 font-mono">Имя блока:</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#1e1e1e] border border-[#3e3e42] focus:border-[#007acc] px-2.5 py-1.5 rounded text-white outline-none font-mono"
                  placeholder="Например: Valve_Logic"
                />
              </div>
            </div>

            <div className="bg-[#1e1e1e] p-2.5 rounded border border-[#333333] text-[11px] text-[#858585]">
              {category === 'OB' && 'Организационный блок: вызывается ядром SoftPLC циклически (OB1 = Main cycle).'}
              {category === 'FB' && 'Функциональный блок: логика с внутренним состоянием, требует Instance DB при вызове.'}
              {category === 'FC' && 'Функция: алгоритм без памяти, принимает входы и рассчитывает выходы.'}
              {category === 'DB' && 'Глобальный блок данных: разделяемая память параметров технологического процесса.'}
            </div>
          </div>

          {/* Кнопки действий */}
          <div className="bg-[#1e1e1e] px-4 py-2.5 border-t border-[#3e3e42] flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 bg-[#2d2d30] hover:bg-[#3e3e42] text-[#cccccc] rounded transition"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-3 py-1 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded font-medium transition"
            >
              <Check size={14} />
              Создать блок
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
