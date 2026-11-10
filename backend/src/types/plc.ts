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

export interface Project {
  projectName: string;
  version: string;
  target: {
    arch: string;
    cycleTimeMs: number;
  };
  datablocks: DataBlock[];
  programs: Array<{
    name: string;
    language: string;
    code: string;
  }>;
}

export interface LiveDbSnapshot {
  [key: string]: any;
}
