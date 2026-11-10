import type { languages } from 'monaco-editor';

export const ST_LANGUAGE_ID = 'iec-st';

export const stLanguageConfig: languages.LanguageConfiguration = {
  comments: {
    lineComment: '//',
    blockComment: ['(*', '*)'],
  },
  brackets: [
    ['(', ')'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '(*', close: '*)' },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};

export const stMonarchTokens: languages.IMonarchLanguage = {
  defaultToken: '',
  ignoreCase: true,
  tokenPostfix: '.st',

  keywords: [
    'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF',
    'CASE', 'OF', 'END_CASE',
    'FOR', 'TO', 'BY', 'DO', 'END_FOR',
    'WHILE', 'END_WHILE',
    'REPEAT', 'UNTIL', 'END_REPEAT',
    'RETURN', 'EXIT',
    'PROGRAM', 'END_PROGRAM',
    'FUNCTION', 'END_FUNCTION',
    'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK',
    'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR_GLOBAL', 'END_VAR',
    'RETAIN', 'PERSISTENT',
    'TRUE', 'FALSE',
  ],

  operators: [
    'AND', 'OR', 'XOR', 'NOT', 'MOD',
    ':=', '=', '<>', '<', '<=', '>', '>=',
    '+', '-', '*', '/', '**',
  ],

  typeKeywords: [
    'BOOL', 'BYTE', 'WORD', 'DWORD', 'LWORD',
    'SINT', 'INT', 'DINT', 'LINT',
    'USINT', 'UINT', 'UDINT', 'ULINT',
    'REAL', 'LREAL',
    'TIME', 'TOD', 'TIME_OF_DAY', 'DATE', 'DT', 'DATE_AND_TIME',
    'STRING', 'WSTRING',
  ],

  tokenizer: {
    root: [
      // Имена переменных DB в кавычках: "Line_Params".Var
      [/"([^"\\]|\\.)*"/, 'variable.other'],

      // Ключевые слова, типы и операторы
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@operators': 'keyword.operator',
            '@default': 'identifier',
          },
        },
      ],

      // Числовые литералы и таймеры T#10s, TIME#500ms
      [/(?:T|TIME)#\d+(?:\.\d+)?(?:ms|s|m|h|d)/i, 'number.time'],
      [/16#[0-9a-fA-F_]+/, 'number.hex'],
      [/2#[01_]+/, 'number.binary'],
      [/\b\d+(\.\d+)?([eE][+-]?\d+)?\b/, 'number.float'],

      // Операторы
      [/[:=<>+\-*/]/, {
        cases: {
          '@operators': 'keyword.operator',
          '@default': 'delimiter',
        },
      }],

      // Разделители
      [/[;,.]/, 'delimiter'],

      // Строковые литералы
      [/'([^'\\]|\\.)*'/, 'string'],

      // Комментарии
      [/\(\*/, 'comment', '@commentInSt'],
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@commentInC'],
    ],

    commentInSt: [
      [/[^(*)]+/, 'comment'],
      [/\*\)/, 'comment', '@pop'],
      [/[(*)]/, 'comment'],
    ],

    commentInC: [
      [/[^*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[*]/, 'comment'],
    ],
  },
};
