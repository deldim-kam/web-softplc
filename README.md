# Web-SoftPLC IDE

<p align="center">
  <a href="#english">English</a> • <a href="#русский">Русский</a>
</p>

---

<a name="english"></a>
## English

**Web-SoftPLC** is an open-source real-time SoftPLC runtime and web-based engineering environment inspired by industrial automation platforms like Siemens TIA Portal and CODESYS, aligned with IEC 61131-3 standards.

The stack integrates a deterministic C POSIX real-time runtime engine, a Go-based gateway for automated compilation and streaming, and an industrial-grade web IDE powered by React, TypeScript, Tailwind CSS, and Monaco Editor.

### 🏗 System Architecture

```text
                      +---------------------------------------+
                      |       Web Browser IDE (:5173)         |
                      |  React + Vite + Tailwind + Monaco ST  |
                      +-------------------+-------------------+
                                          |
                        HTTP POST /build  |  WebSocket :8080/ws/live
                        HTTP POST /force  |  (Live SHM Snapshot 20 Hz)
                                          v
                      +---------------------------------------+
                      |          Go Gateway (:8080)           |
                      |   Process Lifecycle, REST API, WS     |
                      +-------------------+-------------------+
                                          |
                         SIGUSR1 (Reload) |  mmap /dev/shm
                                          v
+-----------------------------------------------------------------------------+
|                         C-Kernel (RT-POSIX Engine)                          |
|                                                                             |
|   +--------------------------+          +-------------------------------+   |
|   |   Shared Memory Manager  | <------> |     Dynamic Logic Loader      |   |
|   |  (/dev/shm/softplc_db*)  |          |      (dlopen logic.so)        |   |
|   +--------------------------+          +-------------------------------+   |
|                                                                             |
|   Deterministic Cycle (clock_nanosleep): 10 ms (100 Hz)                     |
+-----------------------------------------------------------------------------+
```

### ✨ Key Features

* **RT-Core (C/POSIX):**
  * Strict cyclic execution (default: 10 ms / 100 Hz) using monotonic timers via `clock_nanosleep(CLOCK_MONOTONIC)`.
  * Shared Memory IPC (`/dev/shm`) for global Data Blocks.
  * **Zero-Downtime Hot Reload:** Intercepts `SIGUSR1`, safely unloads the active dynamic library, and links newly built logic modules on the fly via `dlopen` and `dlsym`.

* **Translator & Gateway (Go):**
  * Validates JSON project contracts and translates IEC 61131-3 Structured Text (ST) into native C logic.
  * Drives GCC automatically to produce dynamic shared objects (`logic.so`).
  * Direct binary reading of `/dev/shm/softplc_db1_shm` with live WebSocket broadcasting (20 Hz).
  * **Force Value API:** `POST /api/force` for targeted in-memory variable overrides directly in shared memory.

* **Web IDE (React 18 + Vite + Monaco Editor):**
  * **Industrial Layout:** Structured workbench inspired by TIA Portal and CODESYS.
  * **Project Tree:** Navigable hierarchy containing controller devices, Data Blocks, and ST programs.
  * **Data Block Editor:** Grid supporting IEC primitive types (`BOOL`, `INT`, `DINT`, `REAL`, `TIME`, `WORD`), retain flags, and live online values.
  * **Force Modal:** Quick-access modal triggered by clicking an online cell or double-clicking any variable row.
  * **Monaco ST Editor:** Custom Monarch tokenizer for IEC 61131-3 Structured Text syntax highlighting and `"DB".Variable` IntelliSense (`Ctrl+Space`).
  * **Live Inline Monitoring:** In-code floating decoration chips displaying live variable states directly next to statements with a toggle switch (`Monitoring: ON/OFF`).

### 🚀 Quick Start

#### Prerequisites

* **OS:** Linux (Ubuntu 22.04+, EndeavourOS, or WSL 2 on Windows)
* **Toolchain:**
  * `gcc`, `make`, `build-essential`
  * `go` (1.22+)
  * `node.js` (20 LTS+) and `npm`

#### Single-Command Launch

Clone the repository and launch the unified orchestration runner:

```bash
git clone git@github.com:deldim-kam/web-softplc.git
cd web-softplc

# Install frontend dependencies
cd frontend && npm install && cd ..

# Make executable and launch RT-core, Gateway, and Vite Web IDE
chmod +x start.sh
./start.sh
```

Open your browser at:
👉 **`http://localhost:5173`**

To stop all background services and clean up `/dev/shm` IPC handles safely, press **`Ctrl + C`** in the terminal window.

### 📁 Project Structure

```text
web-softplc/
├── core/                   # C-based Real-Time runtime engine
│   ├── include/            # C headers (db_registry, logic_loader)
│   ├── src/                # Deterministic loop, POSIX SHM & dlopen logic
│   └── Makefile            # Native C build targets
├── backend/                # Go Gateway and ST compiler
│   ├── cmd/compiler/       # CLI ST-to-C translator & GCC invocations
│   ├── cmd/server/         # REST API, WebSocket hub & Force handler
│   └── go.mod
├── frontend/               # React Web IDE
│   ├── src/components/     # DbEditor, StEditor components
│   ├── src/editor/         # Monarch IEC 61131-3 syntax definition
│   └── src/types/          # PLC TypeScript schema
├── contracts/              # JSON definitions for projects and DBs
├── start.sh                # Unified multi-process launcher
└── README.md
```

---

<a name="русский"></a>
## Русский

**Web-SoftPLC** — открытая среда разработки и программный ПЛК (SoftPLC) реального времени, вдохновлённый архитектурой промышленных комплексов (Siemens TIA Portal, CODESYS) и международными стандартами серии IEC 61131-3.

Комплекс объединяет детерминированное RT-ядро исполнения на языке Си, шлюз на Go для компиляции и обмена данными, а также современную веб-среду разработки на React, TypeScript, Tailwind CSS и Monaco Editor.

### 🏗 Архитектура системы

```text
                      +---------------------------------------+
                      |       Web Browser IDE (:5173)         |
                      |  React + Vite + Tailwind + Monaco ST  |
                      +-------------------+-------------------+
                                          |
                        HTTP POST /build  |  WebSocket :8080/ws/live
                        HTTP POST /force  |  (Live SHM Snapshot 20 Hz)
                                          v
                      +---------------------------------------+
                      |          Go Gateway (:8080)           |
                      |   Process Lifecycle, REST API, WS     |
                      +-------------------+-------------------+
                                          |
                         SIGUSR1 (Reload) |  mmap /dev/shm
                                          v
+-----------------------------------------------------------------------------+
|                         C-Kernel (RT-POSIX Engine)                          |
|                                                                             |
|   +--------------------------+          +-------------------------------+   |
|   |   Shared Memory Manager  | <------> |     Dynamic Logic Loader      |   |
|   |  (/dev/shm/softplc_db*)  |          |      (dlopen logic.so)        |   |
|   +--------------------------+          +-------------------------------+   |
|                                                                             |
|   Детерминированный цикл (clock_nanosleep): 10 мс (100 Hz)                  |
+-----------------------------------------------------------------------------+
```

### ✨ Ключевые возможности

* **RT-Ядро (C/POSIX):**
  * Строгий детерминированный цикл сканирования (по умолчанию 10 мс / 100 Hz) на базе `clock_nanosleep(CLOCK_MONOTONIC)`.
  * Разделяемая память (`/dev/shm`) для глобальных блоков данных (Data Blocks).
  * **Hot-Reload без останова ПЛК:** перехват сигнала `SIGUSR1`, безопасная выгрузка библиотеки и динамическое подключение скомпилированного `logic.so` через `dlopen`/`dlsym`.

* **Транслятор и шлюз (Go):**
  * Парсинг JSON-контрактов проектов и трансляция кода IEC 61131-3 Structured Text (ST) в Си.
  * Автоматический вызов GCC для сборки разделяемой библиотеки `logic.so`.
  * Прямой бинарный маппинг разделяемой памяти `/dev/shm/softplc_db1_shm` и рассылка снапшотов по WebSocket (20 Hz).
  * **Force Value API:** эндпоинт `POST /api/force` для принудительного побайтового изменения значений переменных в `/dev/shm`.

* **Web IDE (React 18 + Vite + Monaco Editor):**
  * **Industrial Layout:** компоновка рабочего пространства по стандартам промышленных сред (TIA Portal / CODESYS).
  * **Project Tree:** дерево проекта с узлами контроллера, каталогом Data Blocks и программными модулями.
  * **Data Block Editor:** таблица переменных с поддержкой базовых типов IEC (`BOOL`, `INT`, `DINT`, `REAL`, `TIME`, `WORD`), атрибутов `Retain` и живых значений.
  * **Force Modal:** модальное окно форсирования значения по клику на ячейку «Online значение» или двойному клику по строке.
  * **Monaco ST Editor:** токенизатор синтаксиса IEC 61131-3 ST, автодополнение тегов `"DB".Variable` по `Ctrl+Space`.
  * **Live Inline Monitoring:** динамические плавающие бейджи поверх строк исходного кода с тумблером включения/выключения мониторинга (`Monitoring: ON/OFF`).

### 🚀 Быстрый старт

#### Требования к окружению

* **ОС:** Linux (Ubuntu 22.04+, EndeavourOS или WSL 2 под Windows)
* **Инструменты:**
  * `gcc`, `make`, `build-essential`
  * `go` (1.22+)
  * `node.js` (20 LTS+) и `npm`

#### Запуск всего комплекса одной командой

Клонируйте репозиторий и запустите скрипт:

```bash
git clone git@github.com:deldim-kam/web-softplc.git
cd web-softplc

# Установка зависимостей фронтенда
cd frontend && npm install && cd ..

# Запуск RT-ядра, Go-шлюза и веб-интерфейса
chmod +x start.sh
./start.sh
```

Откройте интерфейс в браузере:
👉 **`http://localhost:5173`**

Для корректной остановки всех подсистем и освобождения дескрипторов памяти `/dev/shm` нажмите **`Ctrl + C`** в терминале.

### 📁 Структура репозитория

```text
web-softplc/
├── core/                   # RT-ядро ПЛК на языке Си
│   ├── include/            # Заголовочные файлы (db_registry, logic_loader)
│   ├── src/                # Реализация RT-цикла, SHM и загрузчика logic.so
│   └── Makefile            # Сборка бинарника softplc
├── backend/                # Go Gateway и транслятор ST->C
│   ├── cmd/compiler/       # CLI-компилятор проекта в C-код и logic.so
│   ├── cmd/server/         # REST API, WebSocket-хаб и Force Controller
│   └── go.mod
├── frontend/               # Веб-среда разработки IDE
│   ├── src/components/     # Таблица DbEditor, редактор StEditor
│   ├── src/editor/         # Токенизатор IEC 61131-3 ST
│   └── src/types/          # TypeScript типы ПЛК
├── contracts/              # JSON-схемы проектов и блоков данных
├── start.sh                # Скрипт автоматического запуска комплекса
└── README.md
```