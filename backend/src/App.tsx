import { useState, useEffect } from 'react';
import { Project, LiveDbSnapshot } from './types/plc';
import { DbEditor } from './components/DbEditor';
import { Play, Activity, Cpu, Layers } from 'lucide-react';

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
      name: "Main",
      language: "ST",
      code: "IF \"Line_Params\".Line_Enable THEN\n    \"Line_Params\".Error_Code := 0;\nELSE\n    \"Line_Params\".Target_Speed := 0.0;\nEND_IF;"
    }
  ]
};

export default function App() {
  const [project, setProject] = useState<Project>(INITIAL_PROJECT);
  const [liveData, setLiveData] = useState<LiveDbSnapshot | null>(null);
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("Готов к работе");

  // Подключение к WebSocket бэкенда
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8080/ws/live");

    ws.onopen = () => setIsWsConnected(true);
    ws.onclose = () => setIsWsConnected(false);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLiveData(data);
      } catch (err) {
        console.error("Ошибка парсинга WS:", err);
      }
    };

    return () => ws.close();
  }, []);

  // Отправка проекта на компиляцию и Hot Reload
  const handleBuild = async () => {
    setIsBuilding(true);
    setStatusMessage("Компиляция и Hot-Reload на лету...");
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
        setStatusMessage(`Ошибка: ${res.error}`);
      }
    } catch (err: any) {
      setStatusMessage(`Сетевая ошибка: ${err.message}`);
    } finally {
      setIsBuilding(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Шапка приложения */}
      <header className="border-b border-slate-800 bg-slate-900/90 px-6 py-3.5 flex justify-between items-center backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg text-white">
            <Cpu size={22} />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              Web-SoftPLC IDE
              <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">v0.4.0</span>
            </h1>
            <p className="text-xs text-slate-400">Проект: {project.projectName} | Цикл: {project.target.cycleTimeMs} мс</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-xs">
            <span className={`w-2 h-2 rounded-full ${isWsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-slate-300">{isWsConnected ? 'PLC Online (20 Hz)' : 'PLC Offline'}</span>
          </div>

          <button
            onClick={handleBuild}
            disabled={isBuilding}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-medium text-sm transition shadow-lg shadow-emerald-950"
          >
            <Play size={16} fill="currentColor" />
            {isBuilding ? 'Сборка...' : 'Build & Hot Reload'}
          </button>
        </div>
      </header>

      {/* Основная рабочая область */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-200 font-semibold">
            <Layers size={18} className="text-blue-500" />
            Конфигурация блоков данных (Data Blocks)
          </div>
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <Activity size={14} className="text-blue-400" />
            Статус: <span className="text-slate-300 font-mono">{statusMessage}</span>
          </div>
        </div>

        {project.datablocks.map((db, idx) => (
          <DbEditor
            key={db.id}
            dataBlock={db}
            onChange={(updatedDb) => {
              const updatedList = [...project.datablocks];
              updatedList[idx] = updatedDb;
              setProject({ ...project, datablocks: updatedList });
            }}
            liveData={liveData}
            isOnline={isWsConnected}
          />
        ))}
      </main>
    </div>
  );
}
