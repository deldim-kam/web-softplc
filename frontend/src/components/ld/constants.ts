import type { LdElementType, LdProgramData } from '../../types/plc';

export const TAG_H = 28;
export const PIN_ROW_H = 48;
export const WIRE_Y = TAG_H + PIN_ROW_H / 2; // 52px
export const BRANCH_STEP_Y = TAG_H + PIN_ROW_H; // 76px

export interface PaletteGroup {
  group: string;
  colorClass: string;
  items: { type: LdElementType; label: string }[];
}

export const PALETTE_GROUPS: PaletteGroup[] = [
  {
    group: 'Контакты',
    colorClass: 'text-sky-300',
    items: [
      { type: 'NO', label: '┤ ├ NO' },
      { type: 'NC', label: '┤/├ NC' },
      { type: 'P_TRIG', label: '┤P├ P_TRIG' },
      { type: 'N_TRIG', label: '┤N├ N_TRIG' },
    ],
  },
  {
    group: 'Катушки',
    colorClass: 'text-orange-300',
    items: [
      { type: 'COIL', label: '( ) Coil' },
      { type: 'COIL_SET', label: '(S) Set' },
      { type: 'COIL_RESET', label: '(R) Reset' },
      { type: 'COIL_INV', label: '(/) Inv' },
    ],
  },
  {
    group: 'Таймеры / Счётчики',
    colorClass: 'text-amber-300',
    items: [
      { type: 'TON', label: '[TON]' },
      { type: 'TOF', label: '[TOF]' },
      { type: 'CTU', label: '[CTU]' },
      { type: 'CTD', label: '[CTD]' },
    ],
  },
  {
    group: 'Сравнение',
    colorClass: 'text-purple-300',
    items: [
      { type: 'CMP_EQ', label: '[==]' },
      { type: 'CMP_NE', label: '[!=]' },
      { type: 'CMP_GT', label: '[>]' },
      { type: 'CMP_LT', label: '[<]' },
      { type: 'CMP_GE', label: '[>=]' },
      { type: 'CMP_LE', label: '[<=]' },
    ],
  },
  {
    group: 'Арифметика',
    colorClass: 'text-emerald-300',
    items: [
      { type: 'ADD', label: '[ADD]' },
      { type: 'SUB', label: '[SUB]' },
      { type: 'MUL', label: '[MUL]' },
      { type: 'DIV', label: '[DIV]' },
    ],
  },
];

export const isContactType = (t: LdElementType): boolean =>
  t === 'NO' || t === 'NC' || t === 'P_TRIG' || t === 'N_TRIG';

export const isCmpType = (t: LdElementType): boolean =>
  t === 'CMP_EQ' || t === 'CMP_NE' || t === 'CMP_GT' || t === 'CMP_LT' || t === 'CMP_GE' || t === 'CMP_LE';

export const canHaveParallel = (t: LdElementType): boolean => isContactType(t) || isCmpType(t);

export const isCoilType = (t: LdElementType): boolean =>
  t === 'COIL' || t === 'COIL_SET' || t === 'COIL_RESET' || t === 'COIL_INV';

export const isBoxType = (t: LdElementType): boolean => !isContactType(t) && !isCoilType(t);

export const DEFAULT_LD: LdProgramData = {
  rungs: [
    {
      id: 'r1',
      title: 'Цепь 1: Контроль предельной уставки и выставление кода 101',
      elements: [
        { id: 'e1', type: 'NO', operand1: '"Line_Params".Line_Enable' },
        { id: 'e2', type: 'CMP_GE', operand1: '"Line_Params".Target_Speed', operand2: '3000.0' },
        { id: 'e3', type: 'ADD', operand1: '100', operand2: '1', operand3: '"Line_Params".Error_Code' },
      ],
    },
  ],
};
