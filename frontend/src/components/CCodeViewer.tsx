import React from 'react';
import Editor from '@monaco-editor/react';
import { FileCode2, RefreshCw, Lock } from 'lucide-react';

interface CCodeViewerProps {
  code: string;
  onRefresh: () => void;
}

export const CCodeViewer: React.FC<CCodeViewerProps> = ({ code, onRefresh }) => {
  return (
    <div className="bg-[#1e1e1e] border border-[#2d2d30] flex flex-col h-full overflow-hidden">
      {/* Тулбар просмотра */}
      <div className="h-9 bg-[#252526] border-b border-[#2d2d30] px-3 flex items-center justify-between text-xs select-none">
        <div className="flex items-center gap-2">
          <FileCode2 size={15} className="text-amber-400" />
          <span className="font-semibold text-[#e1e1e1]">logic.c</span>
          <span className="text-[#858585] font-mono">[Generated Monolithic RT-Cycle]</span>
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#333333] text-[#aaaaaa] text-[10px] font-mono">
            <Lock size={10} /> Read-Only
          </span>
        </div>

        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-[#2d2d30] hover:bg-[#3e3e42] text-[#cccccc] hover:text-white rounded text-xs transition font-mono border border-[#3e3e42]"
          title="Перечитать файл logic.c с диска"
        >
          <RefreshCw size={12} />
          <span>Обновить код</span>
        </button>
      </div>

      {/* Редактор Monaco с синтаксисом C */}
      <div className="flex-1 w-full overflow-hidden">
        <Editor
          height="100%"
          language="c"
          theme="vs-dark"
          value={code}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'off',
          }}
        />
      </div>
    </div>
  );
};
