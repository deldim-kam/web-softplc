#!/usr/bin/env bash

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$PROJECT_ROOT/core"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

# Цветовая разметка вывода
C_CORE="\033[0;36m[CORE]\033[0m"
C_GATEWAY="\033[0;32m[GATEWAY]\033[0m"
C_VITE="\033[0;35m[VITE]\033[0m"
C_SYS="\033[1;33m[SYSTEM]\033[0m"

echo -e "$C_SYS Инициализация Web-SoftPLC IDE..."

# 1. Проверка и сборка ядра C
if [ ! -f "$CORE_DIR/softplc" ]; then
    echo -e "$C_SYS Бинарник softplc не найден. Сборка ядра..."
    make -C "$CORE_DIR"
fi

# 2. Проверка начальной библиотеки logic.so
if [ ! -f "$CORE_DIR/logic.so" ]; then
    echo -e "$C_SYS logic.so не найден. Сборка через softplc-compiler..."
    if [ ! -f "$BACKEND_DIR/bin/softplc-compiler" ]; then
        cd "$BACKEND_DIR" && go build -o bin/softplc-compiler cmd/compiler/main.go && cd "$PROJECT_ROOT"
    fi
    "$BACKEND_DIR/bin/softplc-compiler" \
      -project="$PROJECT_ROOT/contracts/sample_project.json" \
      -include="$CORE_DIR/include" \
      -out="$CORE_DIR"
fi

# 3. Проверка и сборка Go Gateway сервера
if [ ! -f "$BACKEND_DIR/bin/softplc-server" ]; then
    echo -e "$C_SYS Бинарник softplc-server не найден. Сборка Go-сервера..."
    cd "$BACKEND_DIR" && go build -o bin/softplc-server cmd/server/main.go && cd "$PROJECT_ROOT"
fi

# Массив для хранения PID дочерних процессов
PIDS=()

# Функция корректной остановки всех подсистем
cleanup() {
    echo ""
    echo -e "$C_SYS Получен сигнал остановки (Ctrl+C). Завершение процессов..."

    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -SIGTERM "$pid" 2>/dev/null || true
        fi
    done

    # Даем процессам время на корректный flush и unmap памяти
    sleep 0.5

    # Принудительная зачистка PID-файла, если процесс не успел удалить сам
    rm -f "$CORE_DIR/softplc.pid"

    echo -e "$C_SYS Все службы успешно остановлены."
    exit 0
}

# Перехват сигналов SIGINT (Ctrl+C) и SIGTERM
trap cleanup SIGINT SIGTERM EXIT

# 4. Запуск ядра SoftPLC
echo -e "$C_SYS Запуск RT-ядра SoftPLC..."
cd "$CORE_DIR"
./softplc ./logic.so 2>&1 | sed "s/^/$C_CORE /" &
PIDS+=($!)

# Небольшая пауза, чтобы ядро успело зарегистрировать SHM и сохранить softplc.pid
sleep 0.4

# 5. Запуск Go Gateway (REST API + WebSocket)
echo -e "$C_SYS Запуск Go Gateway сервера (:8080)..."
cd "$BACKEND_DIR"
./bin/softplc-server 2>&1 | sed "s/^/$C_GATEWAY /" &
PIDS+=($!)

sleep 0.4

# 6. Запуск фронтенда Vite
echo -e "$C_SYS Запуск фронтенда Vite (:5173)..."
cd "$FRONTEND_DIR"
npm run dev -- --host 2>&1 | sed "s/^/$C_VITE /" &
PIDS+=($!)

echo -e "$C_SYS Комплекс запущен!"
echo -e "$C_SYS Веб-интерфейс: http://localhost:5173"
echo -e "$C_SYS Для остановки всех модулей нажмите Ctrl+C"

# Ожидание завершения дочерних процессов
wait
