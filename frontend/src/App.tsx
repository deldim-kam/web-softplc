import React, { useState, useEffect, useRef } from 'react';
import type {
  Project,
  ProgramBlock,
  DataBlock,
  LiveDbSnapshot,
  ForceEntry,
  DiagnosticItem,
  TelemetryPacket,
} from './types/plc';
import { DbEditor } from './components/DbEditor';
import { StEditor } from './components/StEditor';
import { LdEditor } from './components/LdEditor';
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
  Layers,
  Plus,
  Trash2,
  Zap,
  ZapOff,
  Download,
  Upload,
  Copy,
  Edit3,
  AlertCircle,
  CheckCircle2,
  X,
  LineChart,
} from 'lucide-react';

interface LogEntry {
  id: number;
  time: string;
  level: 'INFO' | 'SUCCESS' | 'ERROR';
  text: string;
}

interface OpenTab {
  key: string;
  type: 'DB' | 'PROG' | 'C_OUT';
  id: number;
  blockType?: 'OB' | 'FB' | 'FC';
  title: string;
}

const INITIAL_PROJECT: Project = {
  projectName: 'Conveyor_Control',
  version: '2.0.0',
  target: { arch: 'x86_64', cycleTimeMs: 10 },
  datablocks: [
    {
      id: 1,
      name: 'Line_Params',
      type: 'global',
      variables: [
        { name: 'Target_Speed', type: 'REAL', initValue: '1500.0', retain: false, comment: 'Заданная скорость (об/мин)' },
        { name: 'Line_Enable', type: 'BOOL', initValue: 'true', retain: false, comment: 'Разрешение работы линии' },
        { name: 'Error_Code', type: 'INT', initValue: '0', retain: true, comment: 'Код аварийной диагностики' },
      ],
    },
  ],
  programBlocks: [
    {
      id: 1,
      blockType: 'OB',
      name: 'OB1_Main',
      language: 'ST',
      title: 'Главный цикл ПЛК (10 мс)',
      code: `// OB1: Главный циклический блок управления (10 мс)\nIF "Line_Params".Line_Enable THEN\n    "Line_Params".Target_Speed := 3500.0;\n    "FC1_SpeedLimiter"();\n    "FC2_LadderSafety"();\nELSE\n    "Line_Params".Target_Speed := 0.0;\nEND_IF;`,
    },
    {
      id: 1,
      blockType: 'FC',
      name: 'FC1_SpeedLimiter',
      language: 'ST',
      title: 'Ограничитель скорости (ST)',
      code: `// FC1: Ограничение максимальной скорости\nIF "Line_Params".Target_Speed > 3000.0 THEN\n    "Line_Params".Target_Speed := 3000.0;\nEND_IF;`,
    },
    {
      id: 2,
      blockType: 'FC',
      name: 'FC2_LadderSafety',
      language: 'LD',
      title: 'Цепь блокировки и диагностики (LD)',
      code: JSON.stringify(
        {
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
            {
              id: 'r2',
              title: 'Цепь 2: Сброс кода аварии при штатном останове линии',
              elements: [
                { id: 'e4', type: 'NC', operand1: '"Line_Params".Line_Enable' },
                { id: 'e5', type: 'SUB', operand1: '0', operand2: '0', operand3: '"Line_Params".Error_Code' },
              ],
            },
          ],
        },
        null,
        2
      ),
    },
  ],
};

const STORAGE_KEY = 'web_softplc_saved_project_v2';

export default function App() {
  const [project, setProject] = useState<Project>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return INITIAL_PROJECT;
  });

  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [fileHandle, setFileHandle] = useState<any>(null);

  // Телеметрия ядра и данные SHM
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [coreRunning, setCoreRunning] = useState(false);
  const [cycleTick, setCycleTick] = useState(0);
  const [scanTimeUs, setScanTimeUs] = useState(0);
  const [jitterUs, setJitterUs] = useState(0);
  const [liveData, setLiveData] = useState<LiveDbSnapshot>({});
  const [rloStatus, setRloStatus] = useState<boolean[]>([]);
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);

  const [activeForces, setActiveForces] = useState<Record<string, ForceEntry>>({});
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [generatedCCode, setGeneratedCCode] = useState<string>('// Нажмите "Собрать и загрузить" для генерации logic.c');
  const [revealLine, setRevealLine] = useState<number | null>(null);

  // Мульти-вкладки
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([
    { key: 'PROG_OB_1', type: 'PROG', id: 1, blockType: 'OB', title: 'OB1_Main [ST]' },
    { key: 'PROG_FC_2', type: 'PROG', id: 2, blockType: 'FC', title: 'FC2_LadderSafety [LD]' },
    { key: 'DB_1', type: 'DB', id: 1, title: 'DB1 (Line_Params)' },
  ]);
  const [activeTabKey, setActiveTabKey] = useState<string>('PROG_FC_2');

  // Нижняя панель и ресайзеры
  const [bottomTab, setBottomTab] = useState<'PROBLEMS' | 'WATCH' | 'LOGS'>('LOGS');
  const [logFilter, setLogFilter] = useState<'ALL' | 'INFO' | 'SUCCESS' | 'ERROR'>('ALL');
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 1, time: new Date().toLocaleTimeString(), level: 'INFO', text: 'Среда разработки Web-SoftPLC инициализирована.' },
  ]);
  const [sidebarWidth, setSidebarWidth] = useState<number>(280);
  const [bottomHeight, setBottomHeight] = useState<number>(190);

  const [isNewBlockOpen, setIsNewBlockOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState({
    progRoot: true,
    OB: true,
    FC: true,
    FB: true,
    dbRoot: true,
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const trendCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const addLog = (level: 'INFO' | 'SUCCESS' | 'ERROR', text: string) => {
    setLogs((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), level, text },
    ]);
  };

  // Автосохранение в localStorage
  const updateProject = (next: Project) => {
    setProject(next);
    setIsDirty(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const fetchGeneratedCCode = async () => {
    try {
      const resp = await fetch('/api/generated-c');
      const data = await resp.json();
      if (data.code) setGeneratedCCode(data.code);
    } catch {
      // ignore
    }
  };

  const fetchActiveForces = async () => {
    try {
      const resp = await fetch('/api/forces');
      const data = await resp.json();
      setActiveForces(data || {});
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchGeneratedCCode();
    fetchActiveForces();

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/live`);

    ws.onopen = () => {
      setIsWsConnected(true);
      addLog('SUCCESS', 'Соединение со шлюзом телеметрии установлено (20 Гц).');
    };
    ws.onclose = () => {
      setIsWsConnected(false);
      setCoreRunning(false);
      addLog('ERROR', 'Потеряна связь со шлюзом телеметрии.');
    };
    ws.onmessage = (event) => {
      try {
        const pkt: TelemetryPacket = JSON.parse(event.data);
        setCoreRunning(Boolean(pkt.coreRunning));
        setCycleTick(pkt.cycleTick || 0);
        setScanTimeUs(pkt.scanTimeUs || 0);
        setJitterUs(pkt.jitterUs || 0);
        setLiveData(pkt.values || {});
        setRloStatus(pkt.rlo || []);

        const spd = Number(pkt.values?.['"Line_Params".Target_Speed'] ?? 0);
        setSpeedHistory((prev) => [...prev.slice(-119), spd]);
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, []);

  // Отрисовка мини-графика (осциллографа) для Target_Speed
  useEffect(() => {
    if (bottomTab !== 'WATCH' || !trendCanvasRef.current) return;
    const canvas = trendCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Сетка
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    for (let y = 20; y < h; y += 25) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (speedHistory.length < 2) return;
    const maxVal = Math.max(4000, ...speedHistory);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    speedHistory.forEach((v, i) => {
      const x = (i / 120) * w;
      const y = h - 10 - (v / maxVal) * (h - 24);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [speedHistory, bottomTab]);

  const openOrFocusTab = (tab: OpenTab) => {
    setOpenTabs((prev) => (prev.some((t) => t.key === tab.key) ? prev : [...prev, tab]));
    setActiveTabKey(tab.key);
  };

  const closeTab = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = openTabs.filter((t) => t.key !== key);
    setOpenTabs(filtered);
    if (activeTabKey === key && filtered.length > 0) {
      setActiveTabKey(filtered[filtered.length - 1].key);
    }
  };

  const handleBuild = async () => {
    setIsBuilding(true);
    addLog('INFO', 'Компиляция проекта (ST + LD -> C) и горячая загрузка...');
    try {
      const response = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      const res = await response.json();
      setDiagnostics(res.diagnostics || []);
      if (res.success) {
        addLog('SUCCESS', res.message);
        await fetchGeneratedCCode();
      } else {
        addLog('ERROR', `Ошибка сборки GCC:\n${res.error}`);
        setBottomTab('PROBLEMS');
      }
    } catch (err: any) {
      addLog('ERROR', `Ошибка связи с сервером сборки: ${err.message}`);
    } finally {
      setIsBuilding(false);
    }
  };

  const handleUnforceAll = async () => {
    try {
      const resp = await fetch('/api/unforce-all', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        setActiveForces({});
        addLog('INFO', data.message);
      }
    } catch (err: any) {
      addLog('ERROR', err.message);
    }
  };

  // Сохранение через File System Access API (перезапись того же файла) с fallback
  const handleSaveProject = async () => {
    const jsonString = JSON.stringify(project, null, 2);
    try {
      if ('showSaveFilePicker' in window) {
        let handle = fileHandle;
        if (!handle) {
          handle = await (window as any).showSaveFilePicker({
            suggestedName: `${project.projectName}.plc.json`,
            types: [{ description: 'SoftPLC Project', accept: { 'application/json': ['.json'] } }],
          });
          setFileHandle(handle);
        }
        const writable = await handle.createWritable();
        await writable.write(jsonString);
        await writable.close();
        setIsDirty(false);
        addLog('SUCCESS', 'Проект сохранён на диск.');
        return;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
    }

    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.projectName}.plc.json`;
    a.click();
    URL.revokeObjectURL(url);
    setIsDirty(false);
    addLog('SUCCESS', `Проект выгружен: ${project.projectName}.plc.json`);
  };

  const handleImportProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (isDirty && !window.confirm('Есть несохранённые изменения. Заменить текущий проект?')) {
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as Project;
        if (!parsed.datablocks || !parsed.programBlocks) {
          throw new Error('Некорректный формат файла проекта');
        }
        await handleUnforceAll();
        updateProject(parsed);
        setIsDirty(false);
        addLog('SUCCESS', `Проект "${parsed.projectName}" загружен (все форсы сброшены).`);
      } catch (err: any) {
        addLog('ERROR', `Ошибка импорта: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  // Операции с блоками в дереве (переименование, дублирование, удаление)
  const renameProgBlock = (pb: ProgramBlock) => {
    const newName = window.prompt('Новое имя блока:', pb.name)?.trim();
    if (!newName || newName === pb.name) return;
    const pbs = project.programBlocks.map((b) =>
      b.id === pb.id && b.blockType === pb.blockType
        ? { ...b, name: newName }
        : { ...b, code: b.code.replaceAll(`"${pb.name}"`, `"${newName}"`) }
    );
    updateProject({ ...project, programBlocks: pbs });
  };

  const duplicateProgBlock = (pb: ProgramBlock) => {
    const maxId = Math.max(0, ...project.programBlocks.filter((b) => b.blockType === pb.blockType).map((b) => b.id));
    const copy: ProgramBlock = {
      ...pb,
      id: maxId + 1,
      name: `${pb.name}_Copy`,
    };
    updateProject({ ...project, programBlocks: [...project.programBlocks, copy] });
  };

  const deleteProgBlock = (pb: ProgramBlock) => {
    if (pb.blockType === 'OB' && pb.id === 1) {
      window.alert('Главный организационный блок OB1 удалить нельзя.');
      return;
    }
    if (!window.confirm(`Удалить блок ${pb.name}?`)) return;
    updateProject({
      ...project,
      programBlocks: project.programBlocks.filter((b) => !(b.id === pb.id && b.blockType === pb.blockType)),
    });
  };

  const activeTabObj = openTabs.find((t) => t.key === activeTabKey) || openTabs[0];
  const activeProgBlock =
    activeTabObj?.type === 'PROG'
      ? project.programBlocks.find((p) => p.id === activeTabObj.id && p.blockType === activeTabObj.blockType)
      : undefined;
  const activeDataBlock =
    activeTabObj?.type === 'DB' ? project.datablocks.find((d) => d.id === activeTabObj.id) : undefined;

  const activeForceList = Object.values(activeForces).filter((f) => f.active);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#18181b] text-[#e4e4e7]">
      <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportProject} className="hidden" />

      {/* 1. Верхняя панель управления */}
      <header className="h-11 bg-[#252526] border-b border-[#3e3e42] px-4 flex items-center justify-between select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Cpu size={17} className="text-[#3b82f6]" />
            <span>Web-SoftPLC IDE</span>
          </div>
          <span className="text-[#52525b]">|</span>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={project.projectName}
              onChange={(e) => updateProject({ ...project, projectName: e.target.value })}
              className="bg-[#1e1e1e] border border-[#3e3e42] focus:border-[#3b82f6] px-2 py-0.5 rounded text-xs text-white font-mono outline-none"
            />
            {isDirty && (
              <span className="text-amber-400 text-xs font-bold" title="Есть несохранённые изменения">
                ● Не сохранено
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-[#2d2d30] hover:bg-[#3e3e42] text-white border border-[#3e3e42] transition"
          >
            <Upload size={13} className="text-emerald-400" /> Открыть
          </button>

          <button
            onClick={handleSaveProject}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-[#2d2d30] hover:bg-[#3e3e42] text-white border border-[#3e3e42] transition"
          >
            <Download size={13} className="text-sky-400" /> Сохранить
          </button>

          <button
            onClick={() => {
              fetchGeneratedCCode();
              openOrFocusTab({ key: 'C_OUT', type: 'C_OUT', id: 0, title: 'logic.c [C-код]' });
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-[#2d2d30] hover:bg-[#3e3e42] text-amber-300 border border-[#3e3e42] font-mono transition"
          >
            <FileCode2 size={13} /> logic.c
          </button>

          {/* Честный индикатор состояния ядра и времени скана */}
          <div className="flex items-center gap-2 px-3 py-1 rounded bg-[#1e1e1e] border border-[#3e3e42] text-xs font-mono">
            {coreRunning ? (
              <>
                <CheckCircle2 size={14} className="text-emerald-400" />
                <span className="text-emerald-400 font-bold">RUN</span>
                <span className="text-[#a1a1aa]">
                  | Scan: {scanTimeUs} µs | Jitter: {jitterUs} µs | Tick: {cycleTick}
                </span>
              </>
            ) : (
              <>
                <AlertCircle size={14} className="text-rose-500" />
                <span className="text-rose-400 font-bold">
                  {isWsConnected ? 'CORE STOPPED' : 'GATEWAY OFFLINE'}
                </span>
              </>
            )}
          </div>

          <button
            onClick={handleBuild}
            disabled={isBuilding}
            className="flex items-center gap-1.5 px-3.5 py-1 bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-50 text-white rounded text-xs font-semibold transition"
          >
            <Play size={13} fill="currentColor" />
            {isBuilding ? 'Сборка...' : 'Собрать и загрузить'}
          </button>
        </div>
      </header>

      {/* 2. Статичный красный баннер безопасности Force (если есть активные форсы) */}
      {activeForceList.length > 0 && (
        <div className="bg-rose-950 border-b border-rose-600 px-4 py-1.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 bg-rose-600 text-white font-bold rounded flex items-center gap-1">
              <Zap size={12} /> ВНИМАНИЕ: АКТИВНО ФОРСИРОВАНИЕ ({activeForceList.length})
            </span>
            {activeForceList.map((f) => (
              <span key={f.key} className="px-2 py-0.5 bg-black/40 border border-rose-500/50 rounded font-mono text-amber-300">
                {f.key} := <b>{f.value}</b>
              </span>
            ))}
          </div>
          <button
            onClick={handleUnforceAll}
            className="flex items-center gap-1 px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded transition shrink-0"
          >
            <ZapOff size={13} /> Снять все форсы (Unforce All)
          </button>
        </div>
      )}

      {/* 3. Основная рабочая область (Дерево слева + Вкладки редакторов справа) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Левая панель: Дерево проекта с единым компонентом веток OB/FC/FB */}
        <aside
          style={{ width: sidebarWidth }}
          className="bg-[#252526] border-r border-[#3e3e42] flex flex-col text-xs select-none shrink-0"
        >
          <div className="h-9 px-3 border-b border-[#3e3e42] flex items-center justify-between font-semibold text-[#e4e4e7]">
            <div className="flex items-center gap-2">
              <Layers size={14} className="text-[#3b82f6]" />
              <span>Дерево проекта</span>
            </div>
            <button
              onClick={() => setIsNewBlockOpen(true)}
              className="flex items-center gap-1 px-2 py-0.5 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-[11px] transition"
            >
              <Plus size={12} /> Блок
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-xs">
            <div className="flex items-center gap-1.5 text-white font-semibold py-1">
              <Cpu size={14} className="text-emerald-400" />
              <span>PLC_1 [SoftPLC-RT]</span>
            </div>

            {/* Ветка программных блоков (OB, FC, FB через единый цикл) */}
            <div className="pl-2">
              <div
                className="flex items-center gap-1.5 py-1 text-[#e4e4e7] cursor-pointer hover:text-white"
                onClick={() => setTreeOpen((p) => ({ ...p, progRoot: !p.progRoot }))}
              >
                {treeOpen.progRoot ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Folder size={14} className="text-amber-400" />
                <span className="font-semibold">Программные блоки</span>
              </div>

              {treeOpen.progRoot && (
                <div className="pl-3 space-y-1">
                  {([
                    { type: 'OB', label: 'Организационные (OB)', color: 'text-sky-400' },
                    { type: 'FC', label: 'Функции (FC)', color: 'text-emerald-400' },
                    { type: 'FB', label: 'Функц. блоки (FB)', color: 'text-purple-400' },
                  ] as const).map((group) => (
                    <div key={group.type}>
                      <div
                        className="flex items-center gap-1.5 py-0.5 text-[#d4d4d8] cursor-pointer hover:text-white"
                        onClick={() => setTreeOpen((p) => ({ ...p, [group.type]: !p[group.type] }))}
                      >
                        {treeOpen[group.type] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        <Folder size={13} className={group.color} />
                        <span>{group.label}</span>
                      </div>

                      {treeOpen[group.type] && (
                        <div className="pl-4 space-y-0.5">
                          {project.programBlocks
                            .filter((p) => p.blockType === group.type)
                            .map((pb) => {
                              const tKey = `PROG_${pb.blockType}_${pb.id}`;
                              const isActive = activeTabKey === tKey;
                              return (
                                <div
                                  key={tKey}
                                  onClick={() =>
                                    openOrFocusTab({
                                      key: tKey,
                                      type: 'PROG',
                                      id: pb.id,
                                      blockType: pb.blockType,
                                      title: `${pb.name} [${pb.language}]`,
                                    })
                                  }
                                  className={`group flex items-center justify-between px-2 py-1 rounded cursor-pointer transition ${
                                    isActive ? 'bg-[#094771] text-white font-bold' : 'hover:bg-[#2a2d2e] text-[#e4e4e7]'
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5 truncate">
                                    <FileCode size={13} className={group.color} />
                                    <span className="truncate">{pb.name}</span>
                                    <span className="px-1 py-0.2 bg-[#18181b] text-[10px] rounded text-amber-300">
                                      {pb.language}
                                    </span>
                                  </div>

                                  <div className="hidden group-hover:flex items-center gap-1 ml-1">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); renameProgBlock(pb); }}
                                      className="hover:text-sky-300"
                                      title="Переименовать"
                                    >
                                      <Edit3 size={11} />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); duplicateProgBlock(pb); }}
                                      className="hover:text-emerald-300"
                                      title="Дублировать"
                                    >
                                      <Copy size={11} />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); deleteProgBlock(pb); }}
                                      className="hover:text-rose-400"
                                      title="Удалить"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Блоки данных (DB) */}
            <div className="pl-2">
              <div
                className="flex items-center gap-1.5 py-1 text-[#e4e4e7] cursor-pointer hover:text-white"
                onClick={() => setTreeOpen((p) => ({ ...p, dbRoot: !p.dbRoot }))}
              >
                {treeOpen.dbRoot ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Folder size={14} className="text-[#3b82f6]" />
                <span className="font-semibold">Блоки данных (DB)</span>
              </div>

              {treeOpen.dbRoot && (
                <div className="pl-4 space-y-0.5">
                  {project.datablocks.map((db) => {
                    const tKey = `DB_${db.id}`;
                    return (
                      <div
                        key={tKey}
                        onClick={() =>
                          openOrFocusTab({
                            key: tKey,
                            type: 'DB',
                            id: db.id,
                            title: `DB${db.id} (${db.name})`,
                          })
                        }
                        className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition ${
                          activeTabKey === tKey ? 'bg-[#094771] text-white font-bold' : 'hover:bg-[#2a2d2e]'
                        }`}
                      >
                        <Database size={13} className="text-[#3b82f6]" />
                        <span>DB{db.id} ({db.name})</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Ресайзер боковой панели */}
        <div
          onMouseDown={(e) => {
            const startX = e.clientX;
            const startW = sidebarWidth;
            const onMove = (mv: MouseEvent) => setSidebarWidth(Math.max(220, Math.min(480, startW + mv.clientX - startX)));
            const onUp = () => {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
          className="w-1 bg-[#2d2d30] hover:bg-[#3b82f6] cursor-col-resize transition shrink-0"
        />

        {/* Центральная область с мульти-вкладками */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
          <div className="h-9 bg-[#252526] border-b border-[#3e3e42] flex items-center px-2 gap-1 overflow-x-auto select-none">
            {openTabs.map((t) => (
              <div
                key={t.key}
                onClick={() => setActiveTabKey(t.key)}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer rounded-t border-t-2 transition ${
                  activeTabKey === t.key
                    ? 'bg-[#1e1e1e] text-white border-[#3b82f6] font-semibold'
                    : 'bg-[#2d2d30] text-[#a1a1aa] border-transparent hover:text-white'
                }`}
              >
                <span>{t.title}</span>
                {openTabs.length > 1 && (
                  <button onClick={(e) => closeTab(t.key, e)} className="hover:text-rose-400">
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex-1 overflow-hidden p-2">
            {activeTabObj?.type === 'DB' && activeDataBlock && (
              <DbEditor
                dataBlock={activeDataBlock}
                onChange={(updatedDb, renamedVar) => {
                  const dbs = project.datablocks.map((d) => (d.id === updatedDb.id ? updatedDb : d));
                  let pbs = project.programBlocks;
                  if (renamedVar) {
                    pbs = pbs.map((p) => ({
                      ...p,
                      code: p.code.replaceAll(renamedVar.oldName, renamedVar.newName),
                    }));
                  }
                  updateProject({ ...project, datablocks: dbs, programBlocks: pbs });
                }}
                liveData={liveData}
                isCoreRunning={coreRunning}
                activeForces={activeForces}
                onForceUpdate={(forces, msg) => {
                  setActiveForces(forces);
                  addLog('INFO', msg);
                }}
              />
            )}

            {activeTabObj?.type === 'PROG' && activeProgBlock && activeProgBlock.language === 'LD' && (
              <LdEditor
                blockName={activeProgBlock.name}
                code={activeProgBlock.code}
                datablocks={project.datablocks}
                liveData={liveData}
                rloStatus={rloStatus}
                isCoreRunning={coreRunning}
                onChange={(newCode) => {
                  const pbs = project.programBlocks.map((p) =>
                    p.id === activeProgBlock.id && p.blockType === activeProgBlock.blockType
                      ? { ...p, code: newCode }
                      : p
                  );
                  updateProject({ ...project, programBlocks: pbs });
                }}
              />
            )}

            {activeTabObj?.type === 'PROG' && activeProgBlock && activeProgBlock.language === 'ST' && (
              <StEditor
                program={{
                  name: activeProgBlock.name,
                  language: activeProgBlock.language,
                  code: activeProgBlock.code,
                }}
                datablocks={project.datablocks}
                programBlocks={project.programBlocks}
                liveData={liveData}
                isCoreRunning={coreRunning}
                activeForces={activeForces}
                diagnostics={diagnostics}
                revealLine={revealLine}
                onChange={(newCode) => {
                  const pbs = project.programBlocks.map((p) =>
                    p.id === activeProgBlock.id && p.blockType === activeProgBlock.blockType
                      ? { ...p, code: newCode }
                      : p
                  );
                  updateProject({ ...project, programBlocks: pbs });
                }}
              />
            )}

            {activeTabObj?.type === 'C_OUT' && (
              <CCodeViewer code={generatedCCode} onRefresh={fetchGeneratedCCode} />
            )}
          </div>
        </div>
      </div>

      {/* Ресайзер нижней панели */}
      <div
        onMouseDown={(e) => {
          const startY = e.clientY;
          const startH = bottomHeight;
          const onMove = (mv: MouseEvent) => setBottomHeight(Math.max(110, Math.min(420, startH - (mv.clientY - startY))));
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
        className="h-1 bg-[#2d2d30] hover:bg-[#3b82f6] cursor-row-resize transition shrink-0"
      />

      {/* 4. Нижняя панель: Problems / Watch & Trend / Logs */}
      <footer style={{ height: bottomHeight }} className="bg-[#18181b] flex flex-col font-mono text-xs shrink-0">
        <div className="h-8 bg-[#252526] px-3 border-b border-[#3e3e42] flex items-center justify-between select-none">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setBottomTab('PROBLEMS')}
              className={`py-1 border-b-2 font-semibold transition flex items-center gap-1.5 ${
                bottomTab === 'PROBLEMS' ? 'border-rose-500 text-white' : 'border-transparent text-[#a1a1aa]'
              }`}
            >
              <span>Ошибки и диагностика</span>
              <span className={`px-1.5 py-0.2 rounded text-[10px] ${diagnostics.length > 0 ? 'bg-rose-600 text-white' : 'bg-[#3f3f46]'}`}>
                {diagnostics.length}
              </span>
            </button>

            <button
              onClick={() => setBottomTab('WATCH')}
              className={`py-1 border-b-2 font-semibold transition flex items-center gap-1.5 ${
                bottomTab === 'WATCH' ? 'border-emerald-400 text-white' : 'border-transparent text-[#a1a1aa]'
              }`}
            >
              <LineChart size={13} className="text-emerald-400" />
              <span>Watch & График скорости</span>
            </button>

            <button
              onClick={() => setBottomTab('LOGS')}
              className={`py-1 border-b-2 font-semibold transition flex items-center gap-1.5 ${
                bottomTab === 'LOGS' ? 'border-[#3b82f6] text-white' : 'border-transparent text-[#a1a1aa]'
              }`}
            >
              <span>Журнал событий ({logs.length})</span>
            </button>
          </div>

          {bottomTab === 'LOGS' && (
            <div className="flex items-center gap-2">
              {(['ALL', 'INFO', 'SUCCESS', 'ERROR'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setLogFilter(f)}
                  className={`px-2 py-0.5 rounded text-[10px] ${
                    logFilter === f ? 'bg-[#094771] text-white' : 'bg-[#2d2d30] text-[#a1a1aa]'
                  }`}
                >
                  {f}
                </button>
              ))}
              <button
                onClick={() => navigator.clipboard.writeText(logs.map((l) => `[${l.time}] [${l.level}] ${l.text}`).join('\n'))}
                className="px-2 py-0.5 bg-[#2d2d30] hover:bg-[#3e3e42] text-white rounded text-[10px]"
              >
                Копировать
              </button>
              <button
                onClick={() => setLogs([])}
                className="px-2 py-0.5 bg-[#2d2d30] hover:text-rose-400 rounded text-[10px]"
              >
                Очистить
              </button>
            </div>
          )}
        </div>

        {/* Контент вкладок подвала */}
        <div className="flex-1 overflow-y-auto p-2.5">
          {bottomTab === 'PROBLEMS' && (
            <div className="space-y-1">
              {diagnostics.length === 0 ? (
                <div className="text-[#a1a1aa] italic">Ошибок компиляции не обнаружено.</div>
              ) : (
                diagnostics.map((d, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      const pb = project.programBlocks.find((b) => b.name === d.blockName);
                      if (pb) {
                        openOrFocusTab({
                          key: `PROG_${pb.blockType}_${pb.id}`,
                          type: 'PROG',
                          id: pb.id,
                          blockType: pb.blockType,
                          title: `${pb.name} [${pb.language}]`,
                        });
                        setRevealLine(d.line);
                      }
                    }}
                    className="flex items-center gap-3 px-2.5 py-1.5 rounded bg-rose-950/30 border border-rose-500/40 hover:bg-rose-950/50 cursor-pointer"
                  >
                    <AlertCircle size={14} className="text-rose-400 shrink-0" />
                    <span className="text-amber-300 font-bold">{d.blockName}:{d.line}</span>
                    <span className="text-rose-200">{d.message}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {bottomTab === 'WATCH' && (
            <div className="flex items-stretch gap-4 h-full">
              <div className="w-72 border border-[#2d2d30] rounded p-2 bg-[#1e1e1e] overflow-y-auto space-y-1">
                <div className="text-[11px] font-bold text-[#a1a1aa] border-b border-[#2d2d30] pb-1">
                  Активные теги (DB.Var)
                </div>
                {Object.entries(liveData).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs py-0.5 border-b border-[#252526]">
                    <span className="text-[#9cdcfe]">{k}</span>
                    <span className="text-emerald-300 font-bold">{String(v)}</span>
                  </div>
                ))}
              </div>
              <div className="flex-1 border border-[#2d2d30] rounded p-2 bg-[#1e1e1e] flex flex-col">
                <div className="flex justify-between text-[11px] text-[#a1a1aa] mb-1">
                  <span>Тренд реального времени: "Line_Params".Target_Speed (об/мин)</span>
                  <span className="text-emerald-400 font-bold">
                    Текущее: {String(liveData['"Line_Params".Target_Speed'] ?? 0)}
                  </span>
                </div>
                <canvas ref={trendCanvasRef} width={600} height={95} className="w-full flex-1 bg-[#141416] rounded" />
              </div>
            </div>
          )}

          {bottomTab === 'LOGS' && (
            <div className="space-y-1">
              {logs
                .filter((l) => logFilter === 'ALL' || l.level === logFilter)
                .map((entry) => (
                  <div key={entry.id} className="leading-relaxed border-b border-[#222225] pb-1">
                    <span className="text-[#a1a1aa] mr-2">[{entry.time}]</span>
                    <span
                      className={`font-bold mr-2 ${
                        entry.level === 'ERROR'
                          ? 'text-rose-400'
                          : entry.level === 'SUCCESS'
                          ? 'text-emerald-400'
                          : 'text-sky-400'
                      }`}
                    >
                      [{entry.level}]
                    </span>
                    <span className="whitespace-pre-wrap text-[#e4e4e7]">{entry.text}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </footer>

      <NewBlockModal
        isOpen={isNewBlockOpen}
        onClose={() => setIsNewBlockOpen(false)}
        onAddProgramBlock={(block) => {
          const defaultLd = JSON.stringify(
            {
              rungs: [
                {
                  id: `rung_${Date.now()}`,
                  title: 'Цепь 1: Логика управления',
                  elements: [
                    { id: `el_1`, type: 'NO', operand1: '"Line_Params".Line_Enable' },
                    { id: `el_2`, type: 'COIL', operand1: '"Line_Params".Line_Enable' },
                  ],
                },
              ],
            },
            null,
            2
          );
          const newBlock: ProgramBlock = {
            id: block.number,
            blockType: block.type,
            name: `${block.type}${block.number}_${block.name}`,
            language: block.language,
            title: block.name,
            code: block.language === 'LD' ? defaultLd : `// ${block.type}${block.number}: ${block.name}\n`,
          };
          updateProject({ ...project, programBlocks: [...project.programBlocks, newBlock] });
          openOrFocusTab({
            key: `PROG_${newBlock.blockType}_${newBlock.id}`,
            type: 'PROG',
            id: newBlock.id,
            blockType: newBlock.blockType,
            title: `${newBlock.name} [${newBlock.language}]`,
          });
        }}
        onAddDataBlock={(db) => {
          const newDb: DataBlock = {
            id: db.number,
            name: db.name,
            type: db.type,
            variables: [{ name: 'Status_Word', type: 'WORD', initValue: '0', retain: false, comment: 'Слово состояния' }],
          };
          updateProject({ ...project, datablocks: [...project.datablocks, newDb] });
          openOrFocusTab({
            key: `DB_${newDb.id}`,
            type: 'DB',
            id: newDb.id,
            title: `DB${newDb.id} (${newDb.name})`,
          });
        }}
      />
    </div>
  );
}
