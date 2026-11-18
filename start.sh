#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[1/3] Запуск RT-ядра SoftPLC (из папки core)..."
cd "$ROOT_DIR/core"
./softplc ./logic.so &
CORE_PID=$!
echo "      Core запущен, PID: $CORE_PID"

sleep 0.5

echo "[2/3] Запуск Go Gateway (:8080)..."
cd "$ROOT_DIR/backend"
./bin/softplc-server &
GW_PID=$!

echo "[3/3] Запуск Frontend (Vite :5173)..."
cd "$ROOT_DIR/frontend"
npm run dev -- --host &
FE_PID=$!

trap "kill -9 $CORE_PID $GW_PID $FE_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait
