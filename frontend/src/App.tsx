import React, { useState, useEffect, useRef } from 'react';
import type { Project, ProgramBlock, DataBlock, LiveDbSnapshot } from './types/plc';
import { DbEditor } from './components/DbEditor';
import type { ForceEntry } from './components/DbEditor';
import { StEditor } from './components/StEditor';
import { CCodeViewer } from './components/CCodeViewer';
import { NewBlockModal } from './components/NewBlockModal';
import { 
  Play, 
  Cpu, 
  Folder, 
  FileCode, 
  FileCode2,
  Database, 
  ChevronRight, 
  ChevronDown,
  ChevronUp,
  Layers,
  Activity,
  Terminal,
  Plus,
  Trash2,
  Zap,
  Download,
  Upload
} from 'lucide-react';

interface LogEntry {
  id: number;
  time: string;
  level: 'INFO' | 'SUCCESS' | 'ERROR';
  text: string;
}

const INITIAL_PROJECT: Project = {
  projectName: "Conveyor_Control",
  version: "1.0.0",
  target: { arch: "x86_64", cycleTimeMs: 10 },
  datablocks: [
    {
      id: 1,
      name: "Line_Params",
      type: "global",
      variables: [
        { name: "Target_Speed", type: "REAL", initValue: "1500.0", retain: false, comment: "Заданная скорость (об/мин)" },
        { name: "Line_Enable", type: "BOOL", initValue: "true", retain: false, comment: "Разрешение работы линии" },
        { name: "Error_Code", type: "INT", initValue: "0", retain: true, comment: "Код аварийной остановки" }
      ]
    }
  ],
  programBlocks: [
    {
      id: 1,
      blockType: "OB",
      name: "OB1_Main",
      language: "ST",
      title: "Main Cyclic Organization Block",
      code: `// OB1: Главный циклический блок управления (10 мс)\nIF "Line_Params".Line_Enable THEN\n    "Line_Params".Target_Speed := 3500.0;\n    // Вызов функции FC1 для ограничения предельной скорости\n    "FC1_SpeedLimiter"();\nELSE\n    "Line_Params".Target_Speed := 0.0;\nEND_IF;`
    },
    {
      id: 1,
      blockType: "FC",
      name: "FC1_SpeedLimiter",
      language: "ST",
      title: "Ограничитель предельной скорости",
      code: `// FC1: Функция защиты по превышению скорости\nIF "Line_Params".Target_Speed > 3000.0 THEN\n    "Line_Params".Target_Speed := 3000.0;\n    "Line_Params".Error_Code := 101;\nEND_IF;`
    }
  ]
};

export default function App() {
  const [project, setProject] = useState<Project>(INITIAL_PROJECT);
  const [liveData, setLiveData] = useState<LiveDbSnapshot | null>(null);
  const [activeForces, setActiveForces] = useState<Record<string, ForceEntry>>({});
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [generatedCCode, setGeneratedCCode] = useState<string>("// Нажмите 'Build & Hot Reload' или 'Обновить код' для загрузки logic.c");

  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 1, time: new Date().toLocaleTimeString(), level: 'INFO', text: 'Web-SoftPLC IDE инициализирована.' }
  ]);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<{ type: 'DB' | 'PROG' | 'C_OUT'; id: number; blockType?: string }>({
    type: 'PROG',
    id: 1,
    blockType: 'OB'
  });

  const [isNewBlockOpen, setIsNewBlockOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState({
    progRoot: true,
    ob: true,
    fc: true,
    fb: true,
    dbRoot: true,
    outRoot: true,
  });

  const addLog = (level: 'INFO' | 'SUCCESS' | 'ERROR', text: string) => {
    setLogs(prev => [
      ...prev,
      { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), level, text }
    ]);
    if (level === 'ERROR') {
      setIsConsoleOpen(true);
    }
  };

  const fetchGeneratedCCode = async () => {
    try {
      const resp = await fetch("http://localhost:8080/api/generated-c");
      const data = await resp.json();
      if (data.code) {
        setGeneratedCCode(data.code);
      }
    } catch (err) {
      console.error("Ошибка загрузки logic.c:", err);
    }
  };

  const fetchActiveForces = async () => {
    try {
      const resp = await fetch("http://localhost:8080/api/forces");
      const data = await resp.json();
      setActiveForces(data || {});
    } catch (err) {
      console.error("Ошибка загрузки activeForces:", err);
    }
  };

  useEffect(() => {
    if (isConsoleOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isConsoleOpen]);

  useEffect(() => {
    fetchGeneratedCCode();
    fetchActiveForces();

    const ws = new WebSocket("ws://localhost:8080/ws/live");
    ws.onopen = () => {
      setIsWsConnected(true);
      addLog('SUCCESS', 'PLC Core Online: Shared Memory /dev/shm подключена (20 Hz)');
    };
    ws.onclose = () => {
      setIsWsConnected(false);
      addLog('ERROR', 'PLC Offline: потеряна связь с Gateway :8080');
    };
    ws.onmessage = (event) => {
      try {
        setLiveData(JSON.parse(event.data));
      } catch (err) {
        console.error("WS Parse error:", err);
      }
    };
    return () => ws.close();
  }, []);

  const handleBuild = async () => {
    setIsBuilding(true);
    addLog('INFO', 'Запуск монолитной трансляции ST -> C и сборки logic.so через GCC...');
    try {
      const response = await fetch("http://localhost:8080/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
      });
      const res = await response.json();
      if (res.success) {
        addLog('SUCCESS', res.message);
        await fetchGeneratedCCode();
      } else {
        addLog('ERROR', `Ошибка компиляции:\n${res.error}`);
      }
    } catch (err: any) {
      addLog('ERROR', `Ошибка связи с Gateway: ${err.message}`);
    } finally {
      setIsBuilding(false);
    }
  };

  // Экспорт проекта в JSON-файл на диск пользователя
  const handleExportProject = () => {
    try {
      const jsonString = JSON.stringify(project, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = project.projectName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'softplc_project';
      a.href = url;
      a.download = `${safeName}.plc.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addLog('SUCCESS', `Проект экспортирован в файл: ${safeName}.plc.json`);
    } catch (err: any) {
      addLog('ERROR', `Ошибка экспорта проекта: ${err.message}`);
    }
  };

  // Импорт проекта из JSON-файла с диска пользователя
  const handleImportProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content) as Project;

        if (!parsed.datablocks || !parsed.programBlocks) {
          throw new Error('Некорректная структура файла проекта (отсутствуют datablocks или programBlocks)');
        }

        setProject(parsed);
        if (parsed.programBlocks.length > 0) {
          const first = parsed.programBlocks[0];
          setActiveTab({ type: 'PROG', id: first.id, blockType: first.blockType });
        }
        addLog('SUCCESS', `Проект "${parsed.projectName}" успешно загружен из файла ${file.name}`);
      } catch (err: any) {
        addLog('ERROR', `Ошибка чтения файла проекта: ${err.message}`);
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  };

  const handleAddProgramBlock = (block: { type: 'OB' | 'FB' | 'FC'; number: number; name: string }) => {
    const newBlock: ProgramBlock = {
      id: block.number,
      blockType: block.type,
      name: `${block.type}${block.number}_${block.name}`,
      language: 'ST',
      title: block.name,
      code: `// ${block.type}${block.number}: ${block.name}\n`,
    };
    setProject({
      ...project,
      programBlocks: [...project.programBlocks, newBlock],
    });
    setActiveTab({ type: 'PROG', id: newBlock.id, blockType: newBlock.blockType });
    addLog('INFO', `Добавлен программный блок: ${newBlock.name} [${block.type}]`);
  };

  const handleAddDataBlock = (db: { number: number; name: string; type: 'global' | 'instance' }) => {
    const newDb: DataBlock = {
      id: db.number,
      name: db.name,
      type: db.type,
      variables: [
        { name: "Status_Word", type: "WORD", initValue: "0", retain: false, comment: "Слово состояния" }
      ],
    };
    setProject({
      ...project,
      datablocks: [...project.datablocks, newDb],
    });
    setActiveTab({ type: 'DB', id: newDb.id });
    addLog('INFO', `Добавлен блок данных: DB${newDb.id} (${newDb.name})`);
  };

  const activeProgBlock = project.programBlocks.find(
    (p) => p.id === activeTab.id && p.blockType === activeTab.blockType
  );
  const activeDataBlock = project.datablocks.find((d) => d.id === activeTab.id);
  const lastLog = logs[logs.length - 1];
  const activeForceCount = Object.values(activeForces).filter(f => f.active).length;

  return (
    <div className="flex flex-col h-screen w-screen select-none bg-[#1e1e1e] text-[#cccccc]">
      {/* Скрытый input для выбора файла при импорте */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.plc.json"
        onChange={handleImportProject}
        className="hidden"
      />

      {/* 1. Верхний Command Bar */}
      <header className="h-10 bg-[#2d2d30] border-b border-[#3e3e42] px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Cpu size={16} className="text-[#007acc]" />
            <span>Web-SoftPLC IDE</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#3e3e42] text-[#858585]">Monolithic RT</span>
          </div>
          <span className="text-[#555555]">|</span>
          <input
            type="text"
            value={project.projectName}
            onChange={(e) => setProject({ ...project, projectName: e.target.value })}
            className="bg-transparent hover:bg-[#3e3e42] focus:bg-[#1e1e1e] px-1.5 py-0.5 rounded text-xs text-[#e1e1e1] font-mono outline-none border border-transparent focus:border-[#007acc]"
            title="Имя проекта (кликните для переименования)"
          />
          <span className="text-xs text-[#777777]">({project.target.cycleTimeMs} ms)</span>

          {activeForceCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-600/30 border border-amber-500 text-amber-300 text-[11px] font-mono animate-pulse">
              <Zap size={11} /> FORCED ({activeForceCount})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Кнопки управления файлом проекта (Import / Export JSON) */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono bg-[#252526] text-[#cccccc] border border-[#3e3e42] hover:border-[#666666] hover:text-white transition"
            title="Загрузить проект с диска (.json)"
          >
            <Upload size={13} className="text-[#4ec9b0]" />
            <span>Open</span>
          </button>

          <button
            onClick={handleExportProject}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono bg-[#252526] text-[#cccccc] border border-[#3e3e42] hover:border-[#666666] hover:text-white transition"
            title="Сохранить проект на диск (.plc.json)"
          >
            <Download size={13} className="text-[#007acc]" />
            <span>Save</span>
          </button>

          <span className="text-[#444444] mx-0.5">|</span>

          <button
            onClick={() => {
              fetchGeneratedCCode();
              setActiveTab({ type: 'C_OUT', id: 0 });
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono border transition ${
              activeTab.type === 'C_OUT'
                ? 'bg-amber-950/70 text-amber-300 border-amber-500/60'
                : 'bg-[#252526] text-[#cccccc] border-[#3e3e42] hover:border-[#666666] hover:text-white'
            }`}
          >
            <FileCode2 size={13} className="text-amber-400" />
            <span>View logic.c</span>
          </button>

          <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#252526] border border-[#3e3e42] text-xs font-mono">
            <span className={`w-2 h-2 rounded-full ${isWsConnected ? 'bg-[#4ec9b0] animate-pulse' : 'bg-[#f14c4c]'}`} />
            <span className={isWsConnected ? 'text-[#4ec9b0]' : 'text-[#858585]'}>
              {isWsConnected ? 'PLC ONLINE' : 'PLC OFFLINE'}
            </span>
          </div>

          <button
            onClick={handleBuild}
            disabled={isBuilding}
            className="flex items-center gap-1.5 px-3 py-1 bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-50 text-white rounded text-xs font-medium transition shadow-sm"
          >
            <Play size={13} fill="currentColor" />
            {isBuilding ? 'Сборка GCC...' : 'Build & Hot Reload'}
          </button>
        </div>
      </header>

      {/* 2. Главная рабочая область */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
          <div className="h-9 bg-[#252526] border-b border-[#2d2d30] flex items-center px-2 gap-1 text-xs">
            {activeTab.type === 'DB' && activeDataBlock && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1e1e1e] text-white border-t-2 border-[#007acc]">
                <Database size={13} className="text-[#007acc]" />
                <span>DB{activeDataBlock.id} [{activeDataBlock.name}]</span>
              </div>
            )}
            {activeTab.type === 'PROG' && activeProgBlock && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1e1e1e] text-white border-t-2 border-[#4ec9b0]">
                <FileCode size={13} className="text-[#4ec9b0]" />
                <span>{activeProgBlock.name} [{activeProgBlock.blockType}]</span>
              </div>
            )}
            {activeTab.type === 'C_OUT' && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1e1e1e] text-amber-300 border-t-2 border-amber-500">
                <FileCode2 size={13} className="text-amber-400" />
                <span>logic.c [Generated C Output]</span>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-hidden p-2">
            {activeTab.type === 'DB' && activeDataBlock && (
              <DbEditor
                dataBlock={activeDataBlock}
                onChange={(updatedDb) => {
                  const dbs = project.datablocks.map((d) => (d.id === updatedDb.id ? updatedDb : d));
                  setProject({ ...project, datablocks: dbs });
                }}
                liveData={liveData}
                isOnline={isWsConnected}
                activeForces={activeForces}
                onForceUpdate={(forces, msg) => {
                  setActiveForces(forces);
                  addLog('INFO', msg);
                  fetchGeneratedCCode();
                }}
              />
            )}

            {activeTab.type === 'PROG' && activeProgBlock && (
              <StEditor
                program={{
                  name: activeProgBlock.name,
                  language: activeProgBlock.language,
                  code: activeProgBlock.code,
                }}
                datablocks={project.datablocks}
                programBlocks={project.programBlocks}
                liveData={liveData}
                isOnline={isWsConnected}
                activeForces={activeForces}
                onChange={(newCode) => {
                  const pbs = project.programBlocks.map((p) =>
                    p.id === activeProgBlock.id && p.blockType === activeProgBlock.blockType
                      ? { ...p, code: newCode }
                      : p
                  );
                  setProject({ ...project, programBlocks: pbs });
                }}
              />
            )}

            {activeTab.type === 'C_OUT' && (
              <CCodeViewer
                code={generatedCCode}
                onRefresh={fetchGeneratedCCode}
              />
            )}
          </div>
        </div>

        {/* Правая панель Project Tree */}
        <aside className="w-72 bg-[#252526] border-l border-[#2d2d30] flex flex-col text-xs select-none">
          <div className="h-9 px-3 border-b border-[#2d2d30] flex items-center justify-between font-semibold text-[#cccccc] uppercase tracking-wider text-[11px]">
            <div className="flex items-center">
              <Layers size={14} className="mr-2 text-[#007acc]" />
              Project Tree
            </div>
            <button
              onClick={() => setIsNewBlockOpen(true)}
              className="flex items-center gap-1 px-1.5 py-0.5 bg-[#3e3e42] hover:bg-[#0e639c] hover:text-white rounded text-[10px] lowercase transition"
              title="Добавить блок (OB, FB, FC, DB)"
            >
              <Plus size={11} /> add block
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[12px]">
            <div className="flex items-center gap-1.5 text-[#e1e1e1] font-semibold py-1">
              <Cpu size={14} className="text-[#4ec9b0]" />
              <span>PLC_1 [SoftPLC-RT]</span>
            </div>

            <div className="pl-3">
              <div 
                className="flex items-center gap-1.5 py-1 text-[#cccccc] cursor-pointer hover:text-white"
                onClick={() => setTreeOpen(p => ({ ...p, progRoot: !p.progRoot }))}
              >
                {treeOpen.progRoot ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Folder size={14} className="text-[#dcb67a]" />
                <span className="font-semibold">Program blocks</span>
              </div>

              {treeOpen.progRoot && (
                <div className="pl-4 space-y-1">
                  <div>
                    <div 
                      className="flex items-center gap-1.5 py-0.5 text-[#858585] cursor-pointer hover:text-[#cccccc]"
                      onClick={() => setTreeOpen(p => ({ ...p, ob: !p.ob }))}
                    >
                      {treeOpen.ob ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <Folder size={13} className="text-[#007acc]" />
                      <span>Organization blocks</span>
                    </div>
                    {treeOpen.ob && (
                      <div className="pl-4 space-y-0.5">
                        {project.programBlocks.filter(p => p.blockType === 'OB').map(ob => (
                          <div
                            key={`OB_${ob.id}`}
                            onClick={() => setActiveTab({ type: 'PROG', id: ob.id, blockType: 'OB' })}
                            className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer transition ${
                              activeTab.type === 'PROG' && activeTab.id === ob.id && activeTab.blockType === 'OB'
                                ? 'bg-[#094771] text-white font-bold'
                                : 'hover:bg-[#2a2d2e] text-[#cccccc]'
                            }`}
                          >
                            <Cpu size={12} className="text-[#4ec9b0]" />
                            <span>{ob.name} [ST]</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div 
                      className="flex items-center gap-1.5 py-0.5 text-[#858585] cursor-pointer hover:text-[#cccccc]"
                      onClick={() => setTreeOpen(p => ({ ...p, fc: !p.fc }))}
                    >
                      {treeOpen.fc ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <Folder size={13} className="text-[#4ec9b0]" />
                      <span>Functions (FC)</span>
                    </div>
                    {treeOpen.fc && (
                      <div className="pl-4 space-y-0.5">
                        {project.programBlocks.filter(p => p.blockType === 'FC').map(fc => (
                          <div
                            key={`FC_${fc.id}`}
                            onClick={() => setActiveTab({ type: 'PROG', id: fc.id, blockType: 'FC' })}
                            className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer transition ${
                              activeTab.type === 'PROG' && activeTab.id === fc.id && activeTab.blockType === 'FC'
                                ? 'bg-[#094771] text-white font-bold'
                                : 'hover:bg-[#2a2d2e] text-[#cccccc]'
                            }`}
                          >
                            <FileCode size={12} className="text-[#4ec9b0]" />
                            <span>{fc.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div 
                      className="flex items-center gap-1.5 py-0.5 text-[#858585] cursor-pointer hover:text-[#cccccc]"
                      onClick={() => setTreeOpen(p => ({ ...p, fb: !p.fb }))}
                    >
                      {treeOpen.fb ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <Folder size={13} className="text-[#c586c0]" />
                      <span>Function blocks (FB)</span>
                    </div>
                    {treeOpen.fb && (
                      <div className="pl-4 space-y-0.5">
                        {project.programBlocks.filter(p => p.blockType === 'FB').map(fb => (
                          <div
                            key={`FB_${fb.id}`}
                            onClick={() => setActiveTab({ type: 'PROG', id: fb.id, blockType: 'FB' })}
                            className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer transition ${
                              activeTab.type === 'PROG' && activeTab.id === fb.id && activeTab.blockType === 'FB'
                                ? 'bg-[#094771] text-white font-bold'
                                : 'hover:bg-[#2a2d2e] text-[#cccccc]'
                            }`}
                          >
                            <FileCode size={12} className="text-[#c586c0]" />
                            <span>{fb.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="pl-3">
              <div 
                className="flex items-center gap-1.5 py-1 text-[#cccccc] cursor-pointer hover:text-white"
                onClick={() => setTreeOpen(p => ({ ...p, dbRoot: !p.dbRoot }))}
              >
                {treeOpen.dbRoot ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Folder size={14} className="text-[#007acc]" />
                <span className="font-semibold">Data blocks (DB)</span>
              </div>

              {treeOpen.dbRoot && (
                <div className="pl-4 space-y-0.5">
                  {project.datablocks.map(db => (
                    <div
                      key={`DB_${db.id}`}
                      onClick={() => setActiveTab({ type: 'DB', id: db.id })}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition ${
                        activeTab.type === 'DB' && activeTab.id === db.id
                          ? 'bg-[#094771] text-white font-bold'
                          : 'hover:bg-[#2a2d2e] text-[#cccccc]'
                      }`}
                    >
                      <Database size={13} className="text-[#007acc]" />
                      <span>DB{db.id} ({db.name})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pl-3">
              <div 
                className="flex items-center gap-1.5 py-1 text-[#cccccc] cursor-pointer hover:text-white"
                onClick={() => setTreeOpen(p => ({ ...p, outRoot: !p.outRoot }))}
              >
                {treeOpen.outRoot ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Folder size={14} className="text-amber-500" />
                <span className="font-semibold">Compiled Output</span>
              </div>

              {treeOpen.outRoot && (
                <div className="pl-4 space-y-0.5">
                  <div
                    onClick={() => {
                      fetchGeneratedCCode();
                      setActiveTab({ type: 'C_OUT', id: 0 });
                    }}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition ${
                      activeTab.type === 'C_OUT'
                        ? 'bg-amber-900/60 text-amber-200 font-bold'
                        : 'hover:bg-[#2a2d2e] text-[#cccccc]'
                    }`}
                  >
                    <FileCode2 size={13} className="text-amber-400" />
                    <span>logic.c (Monolithic)</span>
                  </div>
                </div>
              )}
            </div>

          </div>
        </aside>
      </div>

      {/* 3. Нижняя сворачиваемая консоль диагностики и логов */}
      <footer className="bg-[#1e1e1e] border-t border-[#3e3e42] flex flex-col font-mono text-[11px] z-20">
        <div 
          onClick={() => setIsConsoleOpen(prev => !prev)}
          className="h-7 bg-[#252526] hover:bg-[#2d2d30] px-3 flex items-center justify-between cursor-pointer transition"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Terminal size={13} className="text-[#007acc] shrink-0" />
            <span className="font-semibold text-white uppercase text-[10px] tracking-wider shrink-0">
              Diagnostics & Logs ({logs.length})
            </span>
            <span className="text-[#555555] shrink-0">|</span>
            {lastLog && (
              <span className={`truncate ${
                lastLog.level === 'ERROR' ? 'text-rose-400 font-semibold' :
                lastLog.level === 'SUCCESS' ? 'text-emerald-400' : 'text-[#cccccc]'
              }`}>
                [{lastLog.time}] {lastLog.text.split('\n')[0]}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-[#858585] shrink-0">
            <span className="flex items-center gap-1 text-[#4ec9b0]">
              <Activity size={12} /> 10 ms RT-cycle
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setIsConsoleOpen(prev => !prev); }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#333333] hover:text-white text-[10px]"
            >
              {isConsoleOpen ? <><ChevronDown size={12} /> Свернуть</> : <><ChevronUp size={12} /> Весь лог</>}
            </button>
          </div>
        </div>

        {isConsoleOpen && (
          <div className="h-44 bg-[#181818] border-t border-[#333333] flex flex-col">
            <div className="px-3 py-1 bg-[#202020] border-b border-[#2d2d30] flex justify-between items-center text-[10px] text-[#858585]">
              <span>Журнал событий и вывода компилятора GCC</span>
              <button
                onClick={() => setLogs([])}
                className="flex items-center gap-1 hover:text-rose-400 transition"
              >
                <Trash2 size={11} /> Очистить журнал
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 select-text">
              {logs.length === 0 ? (
                <div className="text-[#555555] italic">Журнал событий пуст...</div>
              ) : (
                logs.map(entry => (
                  <div key={entry.id} className="leading-relaxed border-b border-[#222222] pb-1">
                    <span className="text-[#666666] mr-2">[{entry.time}]</span>
                    <span className={`font-bold mr-2 ${
                      entry.level === 'ERROR' ? 'text-rose-500' :
                      entry.level === 'SUCCESS' ? 'text-emerald-400' : 'text-sky-400'
                    }`}>
                      [{entry.level}]
                    </span>
                    <span className={`whitespace-pre-wrap ${
                      entry.level === 'ERROR' ? 'text-rose-200' : 'text-[#d4d4d4]'
                    }`}>
                      {entry.text}
                    </span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </footer>

      <NewBlockModal
        isOpen={isNewBlockOpen}
        onClose={() => setIsNewBlockOpen(false)}
        onAddProgramBlock={handleAddProgramBlock}
        onAddDataBlock={handleAddDataBlock}
      />
    </div>
  );
}
