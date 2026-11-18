import React, { useState, useLayoutEffect, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';

export interface MenuItemSpec {
  label: string;
  shortcut?: string;
  colorClass?: string;
  dividerBefore?: boolean;
  onClick?: () => void;
  submenu?: MenuItemSpec[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  header?: string;
  items: MenuItemSpec[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, header, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  const [openSubIdx, setOpenSubIdx] = useState<number | null>(null);

  // Точное измерение реальной высоты и ширины меню после рендера
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clampedLeft = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const clampedTop = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    setPos({ left: clampedLeft, top: clampedTop });
  }, [x, y, items]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 9999 }}
      className="w-64 bg-[#252526] border border-[#45454a] rounded-md shadow-2xl py-1.5 text-xs font-sans text-[#e4e4e7] select-none"
    >
      {header && (
        <div className="px-3 py-1 text-[10px] font-mono text-[#a1a1aa] border-b border-[#333338] truncate">
          {header}
        </div>
      )}

      {items.map((item, idx) => (
        <div
          key={idx}
          onMouseEnter={() => setOpenSubIdx(item.submenu ? idx : null)}
          className={`relative ${item.dividerBefore ? 'mt-1 pt-1 border-t border-[#333338]' : ''}`}
        >
          <button
            type="button"
            onClick={() => {
              if (item.onClick) {
                item.onClick();
                onClose();
              }
            }}
            className={`w-full px-3 py-1.5 text-left hover:bg-[#094771] flex items-center justify-between transition ${
              item.colorClass || ''
            }`}
          >
            <span>{item.label}</span>
            {item.submenu ? (
              <ChevronRight size={13} className="text-[#a1a1aa]" />
            ) : (
              item.shortcut && <span className="text-[10px] text-[#a1a1aa]">{item.shortcut}</span>
            )}
          </button>

          {/* Выпадающее подменю для выбора любого типа элемента из палитры */}
          {item.submenu && openSubIdx === idx && (
            <div
              style={{
                left: pos.left + 256 + 210 > window.innerWidth ? -205 : '100%',
                top: 0,
              }}
              className="absolute w-52 bg-[#252526] border border-[#45454a] rounded-md shadow-2xl py-1 z-50 max-h-80 overflow-y-auto"
            >
              {item.submenu.map((sub, sIdx) => (
                <button
                  key={sIdx}
                  type="button"
                  onClick={() => {
                    sub.onClick?.();
                    onClose();
                  }}
                  className={`w-full px-3 py-1.5 text-left hover:bg-[#094771] flex items-center justify-between font-mono ${
                    sub.colorClass || ''
                  }`}
                >
                  <span>{sub.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>,
    document.body
  );
};
