export type IecType = 'BOOL' | 'INT' | 'DINT' | 'REAL' | 'TIME' | 'WORD';

export interface Variable {
  name: string;
  type: IecType;
  initValue: string;
  retain: boolean;
  comment?: string;
}

export type BlockType = 'OB' | 'FB' | 'FC';

export interface ProgramBlock {
  id: number;
  blockType: BlockType;
  name: string;
  language: 'ST';
  title?: string;
  code: string;
  inputs?: Variable[];
  outputs?: Variable[];
  inOuts?: Variable[];
  staticVars?: Variable[];
}

// Алиас для обратной совместимости с редакторами кода
export interface Program {
  name: string;
  language: 'ST';
  code: string;
}

export type DataBlockType = 'global' | 'instance';

export interface DataBlock {
  id: number;
  name: string;
  type: DataBlockType;
  assignedFbId?: number;
  variables: Variable[];
}

export interface ProjectTarget {
  arch: string;
  cycleTimeMs: number;
}

export interface Project {
  projectName: string;
  version: string;
  target: ProjectTarget;
  datablocks: DataBlock[];
  programBlocks: ProgramBlock[];
}

export type LiveDbSnapshot = Record<string, boolean | number>;
