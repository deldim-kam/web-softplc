import React from 'react';
import type { LdElementType } from '../../types/plc';
import { PALETTE_GROUPS } from './constants';
import { Plus, Eye, EyeOff, Zap, Undo2, Redo2, AlertTriangle } from 'lucide-react';

interface LdToolbarProps {
  blockName: string;
  canUndo: boolean;
  canRedo: boolean;
  monitoring: boolean;
  isCoreRunning: boolean;
  isRloStale: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToggleMonitoring: () => void;
  onAddRung: () => void;
  onInsertElement: (type: LdElementType) => void;
}

export const LdToolbar: React.FC<LdToolbarProps> = React.memo(({
  blockName,
  canUndo,
  canRedo,
  monitoring,
  isCoreRunning,
  isRloStale,
  onUndo,
  onRedo,
  onToggleMonitoring,
  onAddRung,
  onInsertElement,
}) => {
  return (
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
              onClick={onUndo}
              disabled={!canUndo}
              className="p-1 rounded bg-[#2d2d30] hover:bg-[#3e3e42] disabled:opacity-40 text-white"
              title="Отменить (Ctrl+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="p-1 rounded bg-[#2d2d30] hover:bg-[#3e3e42] disabled:opacity-40 text-white"
              title="Повторить (Ctrl+Y)"
            >
              <Redo2 size={14} />
            </button>
          </div>

          {isRloStale && monitoring && isCoreRunning && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/60 border border-amber-500/50 text-amber-300 text-[11px]">
              <AlertTriangle size={12} /> Схема изменена — нажмите «Собрать и загрузить» для обновления RLO
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleMonitoring}
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
            onClick={onAddRung}
            className="flex items-center gap-1 px-3 py-1 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-xs font-medium transition"
          >
            <Plus size={14} /> Добавить цепь
          </button>
        </div>
      </div>

      {/* Декларативная палитра элементов по данным PALETTE_GROUPS */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[#333333] font-mono text-xs">
        {PALETTE_GROUPS.map((grp, gIdx) => (
          <React.Fragment key={grp.group}>
            {gIdx > 0 && <span className="text-[#52525b] mx-1">|</span>}
            <span className="text-[#a1a1aa] mr-1">{grp.group}:</span>
            {grp.items.map((item) => (
              <button
                key={item.type}
                onClick={() => onInsertElement(item.type)}
                className={`px-2 py-1 bg-[#2d2d30] hover:bg-[#094771] ${grp.colorClass} hover:text-white border border-[#3e3e42] rounded transition`}
              >
                {item.label}
              </button>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
});
