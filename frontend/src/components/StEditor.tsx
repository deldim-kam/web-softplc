import React, { useRef, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { DataBlock, Program, LiveDbSnapshot } from '../types/plc';
import { ST_LANGUAGE_ID, stLanguageConfig, stMonarchTokens } from '../editor/stLanguage';
import { Code2, BookOpen, Eye, EyeOff } from 'lucide-react';

interface StEditorProps {
  program: Program;
  datablocks: DataBlock[];
  liveData: LiveDbSnapshot | null;
  isOnline: boolean;
  onChange: (newCode: string) => void;
}

export const StEditor: React.FC<StEditorProps> = ({
  program,
  datablocks,
  liveData,
  isOnline,
  onChange,
}) => {
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const decorationsCollectionRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const [monitoringEnabled, setMonitoringEnabled] = useState(true);

  const handleEditorWillMount = (monaco: Monaco) => {
    monacoRef.current = monaco;

    if (!monaco.languages.getLanguages().some((l: any) => l.id === ST_LANGUAGE_ID)) {
      monaco.languages.register({ id: ST_LANGUAGE_ID });
      monaco.languages.setLanguageConfiguration(ST_LANGUAGE_ID, stLanguageConfig);
      monaco.languages.setMonarchTokensProvider(ST_LANGUAGE_ID, stMonarchTokens);

      monaco.languages.registerCompletionItemProvider(ST_LANGUAGE_ID, {
        triggerCharacters: ['.', '"'],
        provideCompletionItems: (_model: any, _position: any) => {
          const suggestions: any[] = [];
          datablocks.forEach((db) => {
            suggestions.push({
              label: `"${db.name}"`,
              kind: monaco.languages.CompletionItemKind.Struct,
              insertText: `"${db.name}"`,
              detail: `DataBlock DB${db.id}`,
            });
            db.variables.forEach((v) => {
              suggestions.push({
                label: `"${db.name}".${v.name}`,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: `"${db.name}".${v.name}`,
                detail: `${v.type} (DB${db.id})`,
              });
            });
          });
          return { suggestions };
        },
      });
    }
  };

  const handleEditorDidMount = (editorInstance: editor.IStandaloneCodeEditor) => {
    editorRef.current = editorInstance;
    decorationsCollectionRef.current = editorInstance.createDecorationsCollection();
  };

  // Механизм наложения декораций live-значений
  useEffect(() => {
    const editorInstance = editorRef.current;
    const monacoInstance = monacoRef.current;
    const decorationsCollection = decorationsCollectionRef.current;

    if (!editorInstance || !monacoInstance || !decorationsCollection) {
      return;
    }

    if (!monitoringEnabled || !isOnline || !liveData) {
      decorationsCollection.clear();
      return;
    }

    const model = editorInstance.getModel();
    if (!model) return;

    const newDecorations: editor.IModelDeltaDecoration[] = [];
    const regex = /"([a-zA-Z_]\w*)"\.([a-zA-Z_]\w*)/g;
    const lineCount = model.getLineCount();

    for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
      const lineContent = model.getLineContent(lineNum);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(lineContent)) !== null) {
        const varName = match[2];
        const val = liveData[varName];

        if (val !== undefined) {
          const startCol = match.index + 1;
          const endCol = startCol + match[0].length;

          let cssClass = 'monaco-inline-value monaco-inline-value-num';
          let displayStr = String(val);

          if (typeof val === 'boolean') {
            cssClass = val
              ? 'monaco-inline-value monaco-inline-value-bool-true'
              : 'monaco-inline-value monaco-inline-value-bool-false';
            displayStr = val ? 'TRUE' : 'FALSE';
          } else if (typeof val === 'number') {
            displayStr = Number.isInteger(val) ? val.toString() : val.toFixed(1);
          }

          newDecorations.push({
            range: new monacoInstance.Range(lineNum, startCol, lineNum, endCol),
            options: {
              after: {
                content: ` [= ${displayStr}]`,
                inlineClassName: cssClass,
              },
            },
          });
        }
      }
    }

    decorationsCollection.set(newDecorations);
  }, [liveData, isOnline, monitoringEnabled, program.code]);

  return (
    <div className="bg-[#1e1e1e] border border-[#2d2d30] flex flex-col h-full overflow-hidden">
      <div className="h-9 bg-[#252526] border-b border-[#2d2d30] px-3 flex items-center justify-between text-xs select-none">
        <div className="flex items-center gap-2">
          <Code2 size={15} className="text-[#4ec9b0]" />
          <span className="font-semibold text-[#e1e1e1]">{program.name}</span>
          <span className="text-[#858585] font-mono">[{program.language}]</span>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setMonitoringEnabled((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition font-mono border ${
              monitoringEnabled && isOnline
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50 shadow-sm'
                : 'bg-[#2d2d30] text-[#858585] border-[#3e3e42] hover:text-[#cccccc]'
            }`}
          >
            {monitoringEnabled && isOnline ? (
              <>
                <Eye size={13} className="text-emerald-400" />
                <span>Monitoring: ON</span>
              </>
            ) : (
              <>
                <EyeOff size={13} />
                <span>Monitoring: OFF</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-1.5 text-[#858585]">
            <BookOpen size={13} />
            <span>Ctrl+Space: IntelliSense</span>
          </div>
        </div>
      </div>

      <div className="flex-1 w-full overflow-hidden">
        <Editor
          height="100%"
          language={ST_LANGUAGE_ID}
          theme="vs-dark"
          value={program.code}
          onChange={(val) => onChange(val || '')}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            wordWrap: 'on',
          }}
        />
      </div>
    </div>
  );
};
