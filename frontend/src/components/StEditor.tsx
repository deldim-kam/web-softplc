import React, { useRef } from 'react';
import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { DataBlock, Program } from '../types/plc';
import { ST_LANGUAGE_ID, stLanguageConfig, stMonarchTokens } from '../editor/stLanguage';
import { Code2, BookOpen } from 'lucide-react';

interface StEditorProps {
  program: Program;
  datablocks: DataBlock[];
  onChange: (newCode: string) => void;
}

export const StEditor: React.FC<StEditorProps> = ({ program, datablocks, onChange }) => {
  const monacoRef = useRef<Monaco | null>(null);

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
              detail: `DataBlock DB${db.id} (${db.type})`,
              documentation: `Глобальный блок данных DB${db.id}`,
            });

            db.variables.forEach((v) => {
              suggestions.push({
                label: `"${db.name}".${v.name}`,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: `"${db.name}".${v.name}`,
                detail: `${v.type} (DB${db.id})`,
                documentation: v.comment || 'Переменная блока данных',
              });
            });
          });

          suggestions.push(
            {
              label: 'IF .. THEN',
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: 'IF ${1:condition} THEN\n    ${0}\nEND_IF;',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Условный оператор IF',
            },
            {
              label: 'IF .. ELSE',
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: 'IF ${1:condition} THEN\n    ${2}\nELSE\n    ${0}\nEND_IF;',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Условный оператор IF-ELSE',
            }
          );

          return { suggestions };
        },
      });
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-xl flex flex-col">
      <div className="px-5 py-3 bg-slate-800/80 border-b border-slate-700 flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <Code2 size={18} className="text-emerald-400" />
          <span className="font-semibold text-slate-100 text-sm">Программа: {program.name}</span>
          <span className="bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 text-xs px-2 py-0.5 rounded font-mono">
            {program.language} (IEC 61131-3)
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <BookOpen size={14} className="text-slate-500" />
          <span>Ctrl+Space: автодополнение тегов</span>
        </div>
      </div>

      <div className="h-[380px] w-full">
        <Editor
          height="100%"
          language={ST_LANGUAGE_ID}
          theme="vs-dark"
          value={program.code}
          onChange={(val) => onChange(val || '')}
          beforeMount={handleEditorWillMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "Fira Code, Menlo, Monaco, 'Courier New', monospace",
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
