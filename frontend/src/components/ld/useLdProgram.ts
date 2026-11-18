import { useState, useMemo, useCallback } from 'react';
import type { LdProgramData, LdRung, LdElement } from '../../types/plc';
import { DEFAULT_LD } from './constants';

export function useLdProgram(code: string, onChange: (newJsonCode: string) => void) {
  const [history, setHistory] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [clipboardEl, setClipboardEl] = useState<LdElement | null>(null);

  const ldData: LdProgramData = useMemo(() => {
    try {
      const parsed = JSON.parse(code);
      if (parsed && Array.isArray(parsed.rungs)) return parsed;
    } catch {
      // Fallback
    }
    return DEFAULT_LD;
  }, [code]);

  const commitRungs = useCallback(
    (newRungs: LdRung[]) => {
      setHistory((prev) => [...prev.slice(-30), code]);
      setRedoStack([]);
      onChange(JSON.stringify({ rungs: newRungs }, null, 2));
    },
    [code, onChange]
  );

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack((r) => [code, ...r]);
    setHistory((h) => h.slice(0, -1));
    onChange(prev);
  }, [history, code, onChange]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setHistory((h) => [...h, code]);
    setRedoStack((r) => r.slice(1));
    onChange(next);
  }, [redoStack, code, onChange]);

  return {
    rungs: ldData.rungs,
    commitRungs,
    undo,
    redo,
    canUndo: history.length > 0,
    canRedo: redoStack.length > 0,
    clipboardEl,
    setClipboardEl,
  };
}
