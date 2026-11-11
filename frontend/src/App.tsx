import { useState, useEffect } from 'react';
import type { Project, LiveDbSnapshot } from './types/plc';
import { DbEditor } from './components/DbEditor';
import { StEditor } from './components/StEditor';
import { 
  Play, 
  Cpu, 
  Folder, 
  FileCode, 
  Database, 
  ChevronRight, 
  ChevronDown,
  Layers,
  Activity,
  Terminal
} from 'lucide-react';

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
  programs: [
    {
      name: "Main_Conveyor",
      language: "ST",
      code: `// Циклическая программа управления конвейерной линией\nIF "Line_Params".Line_Enable THEN\n    "Line_Params".Error_Code := 0;\n    "Line_Params".Target_Speed := 1500.0;\nELSE\n    "Line_Params".Target_Speed := 0.0;\nEND_IF;`
    }
  ]
};

export default function App() {
  const [project, setProject] = useState<Project>(INITIAL_PROJECT);
  const [liveData, setLiveData] = useState<LiveDbSnapshot | null>(null);
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("Готов к работе");
  const [activeView, setActiveView] = useState<'db1' | 'st_main'>('st_main');
  const [treeOpen, setTreeOpen] = useState({ blocks: true, dbs: true, progs: true });

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8080/ws/live");

    ws.onopen = () => {
      setIsWsConnected(true);
      setStatusMessage("PLC Core Online: Shared Memory /dev/shm подключена (20 Hz)");
    };
    ws.onclose = () => {
      setIsWsConnected(false);
      setStatusMessage("PLC Offline: сервер 8080 недоступен");
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
    setStatusMessage("GCC: сборка logic.so и отправка SIGUSR1...");
    try {
      const response = await fetch("http://localhost:8080/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
      });
      const res = await response.json();
      if (res.success) {
        setStatusMessage(res.message);
      } else {
        setStatusMessage(`Ошибка сборки: ${res.error}`);
      }
    } catch (err: any) {
      setStatusMessage(`Ошибка связи с Gateway: ${err.message}`);
    } finally {
      setIsBuilding(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen select-none bg-[#1e1e1e] text-[#cccccc]">
      {/* 1. Верхний Command Bar */}
      <header className="h-10 bg-[#2d2d30] border-b border-[#3e3e42] px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Cpu size={16} className="text-[#007acc]" />
            <span>Web-SoftPLC IDE</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#3e3e42] text-[#858585]">Sprint 6</span>
          </div>
          <span className="text-[#555555]">|</span>
          <span className="text-xs text-[#999999]">{project.projectName} ({project.target.cycleTimeMs} ms)</span>
        </div>

        <div className="flex items-center gap-3">
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
        
        {/* Центральная рабочая панель */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
          {/* Вкладки открытых документов */}
          <div className="h-9 bg-[#252526] border-b border-[#2d2d30] flex items-center px-2 gap-1 text-xs">
            <button
              onClick={() => setActiveView('db1')}
              className={`flex items-center gap-2 px-3 py-1.5 border-t-2 transition ${
                activeView === 'db1'
                  ? 'bg-[#1e1e1e] text-white border-[#007acc]'
                  : 'text-[#858585] hover:bg-[#2a2d2e] border-transparent'
              }`}
            >
              <Database size={13} className="text-[#007acc]" />
              <span>DB1 [Line_Params]</span>
            </button>
            <button
              onClick={() => setActiveView('st_main')}
              className={`flex items-center gap-2 px-3 py-1.5 border-t-2 transition ${
                activeView === 'st_main'
                  ? 'bg-[#1e1e1e] text-white border-[#4ec9b0]'
                  : 'text-[#858585] hover:bg-[#2a2d2e] border-transparent'
              }`}
            >
              <FileCode size={13} className="text-[#4ec9b0]" />
              <span>Main_Conveyor [ST]</span>
            </button>
          </div>

          {/* Содержимое активного редактора */}
          <div className="flex-1 overflow-hidden p-2">
            {activeView === 'db1' && (
              <DbEditor
                dataBlock={project.datablocks[0]}
                onChange={(updatedDb) => {
                  const dbs = [...project.datablocks];
                  dbs[0] = updatedDb;
                  setProject({ ...project, datablocks: dbs });
                }}
                liveData={liveData}
                isOnline={isWsConnected}
              />
            )}

            {activeView === 'st_main' && (
              <StEditor
                program={project.programs[0]}
                datablocks={project.datablocks}
                liveData={liveData}
                isOnline={isWsConnected}
                onChange={(newCode) => {
                  const progs = [...project.programs];
                  progs[0] = { ...progs[0], code: newCode };
                  setProject({ ...project, programs: progs });
                }}
              />
            )}
          </div>
        </div>

        {/* Правая панель Project Tree */}
        <aside className="w-64 bg-[#252526] border-l border-[#2d2d30] flex flex-col text-xs select-none">
          <div className="h-9 px-3 border-b border-[#2d2d30] flex items-center font-semibold text-[#cccccc] uppercase tracking-wider text-[11px]">
            <Layers size={14} className="mr-2 text-[#007acc]" />
            Project Tree
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[12px]">
            <div className="flex items-center gap-1.5 text-[#e1e1e1] font-semibold py-1">
              <Cpu size={14} className="text-[#4ec9b0]" />
              <span>PLC_1 [SoftPLC-RT]</span>
            </div>

            <div className="pl-3">
              <div 
                className="flex items-center gap-1.5 py-1 text-[#cccccc] cursor-pointer hover:text-white"
                onClick={() => setTreeOpen(prev => ({ ...prev, blocks: !prev.blocks }))}
              >
                {treeOpen.blocks ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Folder size={14} className="text-[#dcb67a]" />
                <span>Program blocks</span>
              </div>

              {treeOpen.blocks && (
                <div className="pl-4 space-y-0.5">
                  {project.datablocks.map(db => (
                    <div
                      key={db.id}
                      onClick={() => setActiveView('db1')}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition ${
                        activeView === 'db1' ? 'bg-[#094771] text-white' : 'hover:bg-[#2a2d2e] text-[#cccccc]'
                      }`}
                    >
                      <Database size={13} className="text-[#007acc]" />
                      <span>DB{db.id} ({db.name})</span>
                    </div>
                  ))}

                  {project.programs.map(prog => (
                    <div
                      key={prog.name}
                      onClick={() => setActiveView('st_main')}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition ${
                        activeView === 'st_main' ? 'bg-[#094771] text-white' : 'hover:bg-[#2a2d2e] text-[#cccccc]'
                      }`}
                    >
                      <FileCode size={13} className="text-[#4ec9b0]" />
                      <span>{prog.name} [ST]</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* 3. Нижний статус-бар */}
      <footer className="h-6 bg-[#007acc] text-white px-3 flex items-center justify-between text-[11px] font-mono">
        <div className="flex items-center gap-2">
          <Terminal size={12} />
          <span>{statusMessage}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Activity size={12} /> 10 ms cycle
          </span>
          <span>UTF-8</span>
        </div>
      </footer>
    </div>
  );
}
