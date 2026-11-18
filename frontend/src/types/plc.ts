export type IecType = 'BOOL' | 'INT' | 'DINT' | 'REAL' | 'TIME' | 'WORD';

export interface Variable {
  name: string;
  type: IecType;
  initValue: string;
  retain: boolean;
  comment?: string;
}

export interface DataBlock {
  id: number;
  name: string;
  type: 'global' | 'instance';
  variables: Variable[];
}

export type LdElementType =
  | 'NO' | 'NC' | 'P_TRIG' | 'N_TRIG'
  | 'COIL' | 'COIL_SET' | 'COIL_RESET' | 'COIL_INV'
  | 'TON' | 'TOF' | 'CTU' | 'CTD'
  | 'CMP_EQ' | 'CMP_NE' | 'CMP_GT' | 'CMP_LT' | 'CMP_GE' | 'CMP_LE'
  | 'ADD' | 'SUB' | 'MUL' | 'DIV';

export interface LdElement {
  id: string;
  type: LdElementType;
  operand1: string;
  operand2?: string;
  operand3?: string;
  parallel?: LdElement[]; // Параллельные ветки OR под этим контактом
}

export interface LdRung {
  id: string;
  title: string;
  elements: LdElement[];
}

export interface LdProgramData {
  rungs: LdRung[];
}

export interface ProgramBlock {
  id: number;
  blockType: 'OB' | 'FB' | 'FC';
  name: string;
  language: 'ST' | 'LD';
  title?: string;
  code: string;
}

export interface Program {
  name: string;
  language: 'ST' | 'LD';
  code: string;
}

export interface Project {
  projectName: string;
  version: string;
  target: {
    arch: string;
    cycleTimeMs: number;
  };
  datablocks: DataBlock[];
  programBlocks: ProgramBlock[];
}

export type LiveDbSnapshot = Record<string, number | boolean>;

export interface TelemetryPacket {
  coreRunning: boolean;
  cycleTick: number;
  scanTimeUs: number;
  jitterUs: number;
  maxJitterUs: number;
  values: LiveDbSnapshot;
  rlo: boolean[];
}

export interface DiagnosticItem {
  blockName: string;
  line: number;
  column: number;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface ForceEntry {
  key: string;
  dbId: number;
  dbName: string;
  varName: string;
  varType: IecType;
  offset: number;
  size: number;
  value: string;
  active: boolean;
}
