import React, { useRef, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { DataBlock, Program, LiveDbSnapshot, ProgramBlock, ForceEntry, DiagnosticItem } from '../types/plc';
import { ST_LANGUAGE_ID, stLanguageConfig, stMonarchTokens } from '../editor/stLanguage';
import { Code2, BookOpen, Eye, EyeOff } from 'lucide-react';

interface StEditorProps {
  program: Program;
  datablocks: DataBlock[];
  programBlocks?: ProgramBlock[];
  liveData: LiveDbSnapshot;
  isCoreRunning: boolean;
  activeForces?: Record<string, ForceEntry>;
  diagnostics?: DiagnosticItem[];
  revealLine?: number | null;
  onChange: (newCode: string) => void;
}

export const StEditor: React.FC<StEditorProps> = ({
  program,
  datablocks,
  programBlocks = [],
  liveData,
  isCoreRunning,
  activeForces = {},
  diagnostics = [],
  revealLine,
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
        triggerCharacters: ['.', '"', '('],
        provideCompletionItems: () => {
          const suggestions: any[] = [];
          datablocks.forEach((db) => {
            db.variables.forEach((v) => {
              suggestions.push({
                label: `"${db.name}".${v.name}`,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: `"${db.name}".${v.name}`,
                detail: `${v.type} (DB${db.id})`,
              });
            });
          });
          programBlocks.filter((b) => b.blockType !== 'OB').forEach((pb) => {
            suggestions.push({
              label: `"${pb.name}"()`,
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: `"${pb.name}"();`,
              detail: `${pb.blockType} [${pb.language}]`,
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

  // Переход к строке при клике в панели Problems
  useEffect(() => {
    if (revealLine && editorRef.current) {
      editorRef.current.revealLineInCenter(revealLine);
      editorRef.current.setPosition({ lineNumber: revealLine, column: 1 });
      editorRef.current.focus();
    }
  }, [revealLine]);

  // Установка красных волнистых подчёркиваний через setModelMarkers
  useEffect(() => {
    const editorInstance = editorRef.current;
    const monacoInstance = monacoRef.current;
    if (!editorInstance || !monacoInstance) return;
    const model = editorInstance.getModel();
    if (!model) return;

    const blockDiags = diagnostics.filter((d) => d.blockName === program.name);
    const markers: editor.IMarkerData[] = blockDiags.map((d) => ({
      severity:
        d.severity === 'ERROR'
          ? monacoInstance.MarkerSeverity.Error
          : monacoInstance.MarkerSeverity.Warning,
      message: d.message,
      startLineNumber: d.line,
      startColumn: d.column || 1,
      endLineNumber: d.line,
      endColumn: 100,
    }));

    monacoInstance.editor.setModelMarkers(model, 'gcc-diagnostics', markers);
  }, [diagnostics, program.name, program.code]);

  // Инлайн-мониторинг по полному ключу "DB_Name".Var_Name
  useEffect(() => {
    const editorInstance = editorRef.current;
    const monacoInstance = monacoRef.current;
    const decorationsCollection = decorationsCollectionRef.current;

    if (!editorInstance || !monacoInstance || !decorationsCollection) return;

    if (!monitoringEnabled || !isCoreRunning) {
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
        const fullKey = `"${match[1]}".${match[2]}`;
        const val = liveData[fullKey];
        const isForced = activeForces[fullKey]?.active;

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

          if (isForced) {
            cssClass = 'monaco-inline-value monaco-inline-value-forced';
          }

          const prefix = isForced ? 'FORCED =' : '=';

          newDecorations.push({
            range: new monacoInstance.Range(lineNum, startCol, lineNum, endCol),
            options: {
              after: {
                content: ` [${prefix} ${displayStr}]`,
                inlineClassName: cssClass,
              },
            },
          });
        }
      }
    }

    decorationsCollection.set(newDecorations);
  }, [liveData, isCoreRunning, monitoringEnabled, program.code, activeForces]);

  return (
    <div className="bg-[#1e1e1e] border border-[#2d2d30] flex flex-col h-full overflow-hidden">
      <div className="h-10 bg-[#252526] border-b border-[#2d2d30] px-3 flex items-center justify-between text-xs select-none">
        <div className="flex items-center gap-2">
          <Code2 size={15} className="text-[#4ec9b0]" />
          <span className="font-semibold text-white text-sm">{program.name}</span>
          <span className="text-[#a1a1aa] font-mono">[ST / Structured Text]</span>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setMonitoringEnabled((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs transition font-mono border ${
              monitoringEnabled && isCoreRunning
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50'
                : 'bg-[#2d2d30] text-[#a1a1aa] border-[#3e3e42]'
            }`}
          >
            {monitoringEnabled && isCoreRunning ? (
              <>
                <Eye size={14} className="text-emerald-400" />
                <span>Мониторинг: ВКЛ</span>
              </>
            ) : (
              <>
                <EyeOff size={14} />
                <span>Мониторинг: ВЫКЛ</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-1.5 text-[#a1a1aa]">
            <BookOpen size={14} />
            <span>Ctrl+Space: Автодополнение</span>
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
