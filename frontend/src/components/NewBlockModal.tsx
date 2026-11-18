import React, { useState } from 'react';
import { X, Cpu, Database } from 'lucide-react';

interface NewBlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddProgramBlock: (block: { type: 'OB' | 'FB' | 'FC'; number: number; name: string; language: 'ST' | 'LD' }) => void;
  onAddDataBlock: (db: { number: number; name: string; type: 'global' | 'instance' }) => void;
}

export const NewBlockModal: React.FC<NewBlockModalProps> = ({
  isOpen,
  onClose,
  onAddProgramBlock,
  onAddDataBlock,
}) => {
  const [category, setCategory] = useState<'PROG' | 'DB'>('PROG');
  const [progType, setProgType] = useState<'OB' | 'FC' | 'FB'>('FC');
  const [language, setLanguage] = useState<'ST' | 'LD'>('LD');
  const [blockNum, setBlockNum] = useState<number>(2);
  const [blockName, setBlockName] = useState<string>('MotorControl');
  const [dbType, setDbType] = useState<'global' | 'instance'>('global');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockName.trim()) return;

    if (category === 'PROG') {
      onAddProgramBlock({
        type: progType,
        number: blockNum,
        name: blockName.trim(),
        language,
      });
    } else {
      onAddDataBlock({
        number: blockNum,
        name: blockName.trim(),
        type: dbType,
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center z-50 select-none">
      <div className="bg-[#252526] border border-[#3e3e42] rounded-lg shadow-2xl w-[440px] overflow-hidden text-xs">
        <div className="bg-[#2d2d30] px-4 py-3 border-b border-[#3e3e42] flex justify-between items-center">
          <span className="font-semibold text-white text-sm">Add new block (TIA Portal style)</span>
          <button onClick={onClose} className="text-[#858585] hover:text-white">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setCategory('PROG')}
              className={`flex items-center justify-center gap-2 py-2 rounded border font-medium transition ${
                category === 'PROG'
                  ? 'bg-[#094771] border-[#007acc] text-white'
                  : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585]'
              }`}
            >
              <Cpu size={15} /> Program Block (OB/FC/FB)
            </button>
            <button
              type="button"
              onClick={() => setCategory('DB')}
              className={`flex items-center justify-center gap-2 py-2 rounded border font-medium transition ${
                category === 'DB'
                  ? 'bg-[#094771] border-[#007acc] text-white'
                  : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585]'
              }`}
            >
              <Database size={15} /> Data Block (DB)
            </button>
          </div>

          {category === 'PROG' ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {(['OB', 'FC', 'FB'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setProgType(t)}
                    className={`py-2 rounded border font-mono font-bold transition ${
                      progType === t
                        ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                        : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-[#858585] mb-1.5">Язык программирования блока:</label>
                <div className="grid grid-cols-2 gap-2 font-mono">
                  <button
                    type="button"
                    onClick={() => setLanguage('LD')}
                    className={`py-2 px-3 rounded border font-bold transition ${
                      language === 'LD'
                        ? 'bg-amber-950/70 border-amber-500 text-amber-300'
                        : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585]'
                    }`}
                  >
                    ──┤ ├── LD (Ladder)
                  </button>
                  <button
                    type="button"
                    onClick={() => setLanguage('ST')}
                    className={`py-2 px-3 rounded border font-bold transition ${
                      language === 'ST'
                        ? 'bg-sky-950/70 border-sky-500 text-sky-300'
                        : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585]'
                    }`}
                  >
                    IF..THEN ST (SCL)
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDbType('global')}
                className={`py-2 rounded border transition ${
                  dbType === 'global'
                    ? 'bg-[#094771] border-[#007acc] text-white'
                    : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585]'
                }`}
              >
                Global DB
              </button>
              <button
                type="button"
                onClick={() => setDbType('instance')}
                className={`py-2 rounded border transition ${
                  dbType === 'instance'
                    ? 'bg-[#094771] border-[#007acc] text-white'
                    : 'bg-[#1e1e1e] border-[#3e3e42] text-[#858585]'
                }`}
              >
                Instance DB
              </button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[#858585] mb-1">Номер:</label>
              <input
                type="number"
                min={1}
                value={blockNum}
                onChange={(e) => setBlockNum(Number(e.target.value))}
                className="w-full bg-[#1e1e1e] border border-[#3e3e42] px-2.5 py-1.5 rounded text-white font-mono outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[#858585] mb-1">Имя блока:</label>
              <input
                type="text"
                value={blockName}
                onChange={(e) => setBlockName(e.target.value)}
                className="w-full bg-[#1e1e1e] border border-[#3e3e42] px-2.5 py-1.5 rounded text-white font-mono outline-none"
                placeholder="Например: SafetyInterlock"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[#333333]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-[#2d2d30] hover:bg-[#3e3e42] text-[#cccccc] rounded transition"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded font-medium transition"
            >
              Создать блок
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
