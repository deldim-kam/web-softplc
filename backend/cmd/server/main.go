package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"web-softplc/backend/pkg/builder"
	"web-softplc/backend/pkg/codegen"
	"web-softplc/backend/pkg/model"
	"web-softplc/backend/pkg/shm"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type BuildResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
}

func sendHotReloadSignal(coreDir string) error {
	pidPath := filepath.Join(coreDir, "softplc.pid")
	data, err := os.ReadFile(pidPath)
	if err != nil {
		return fmt.Errorf("ядро не запущено (нет softplc.pid): %w", err)
	}

	pidStr := strings.TrimSpace(string(data))
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		return fmt.Errorf("некорректный PID ядра: %w", err)
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		return fmt.Errorf("процесс ядра %d не найден: %w", pid, err)
	}

	if err := proc.Signal(syscall.SIGUSR1); err != nil {
		return fmt.Errorf("ошибка отправки сигнала SIGUSR1: %w", err)
	}

	return nil
}

func handleBuild(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Метод не поддерживается", http.StatusMethodNotAllowed)
		return
	}

	var proj model.Project
	if err := json.NewDecoder(r.Body).Decode(&proj); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(BuildResponse{Success: false, Error: "Некорректный JSON проекта: " + err.Error()})
		return
	}

	log.Printf("[Server] Получен проект '%s' на сборку", proj.ProjectName)

	headerCode, err := codegen.GenerateHeader(proj.DataBlocks)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(BuildResponse{Success: false, Error: "Ошибка генерации заголовков: " + err.Error()})
		return
	}

	logicCode, err := codegen.GenerateLogicSource(&proj)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(BuildResponse{Success: false, Error: "Ошибка трансляции ST: " + err.Error()})
		return
	}

	coreDir, _ := filepath.Abs("../core")
	includeDir := filepath.Join(coreDir, "include")

	soPath, err := builder.CompileSharedLib(headerCode, logicCode, builder.BuildConfig{
		IncludeDir: includeDir,
		OutputDir:  coreDir,
	})
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(BuildResponse{Success: false, Error: "Ошибка GCC: " + err.Error()})
		return
	}

	log.Printf("[Server] Модуль успешно скомпилирован: %s", soPath)

	reloadMsg := "Логика скомпилирована. Сигнал Hot Reload успешно отправлен ядру."
	if err := sendHotReloadSignal(coreDir); err != nil {
		reloadMsg = fmt.Sprintf("Логика скомпилирована, но ядро сейчас не запущено: %v", err)
		log.Printf("[Server] %s", reloadMsg)
	} else {
		log.Printf("[Server] Сигнал SIGUSR1 отправлен ядру (Hot Reload выполнен)")
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(BuildResponse{
		Success: true,
		Message: reloadMsg,
	})
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Ошибка Upgrade: %v", err)
		return
	}
	defer conn.Close()

	log.Printf("[WS] Подключен клиент мониторинга: %s", conn.RemoteAddr())

	ticker := time.NewTicker(50 * time.Millisecond) // 20 Гц
	defer ticker.Stop()

	for range ticker.C {
		snapshot, err := shm.ReadDB1()
		if err != nil {
			continue
		}

		if err := conn.WriteJSON(snapshot); err != nil {
			log.Printf("[WS] Клиент отключился: %v", err)
			break
		}
	}
}

func main() {
	http.HandleFunc("/api/build", handleBuild)
	http.HandleFunc("/ws/live", handleWebSocket)

	addr := ":8080"
	log.Printf("==================================================")
	log.Printf("[Web-SoftPLC Gateway] Сервер запущен на http://localhost%s", addr)
	log.Printf("REST API:   POST http://localhost%s/api/build", addr)
	log.Printf("WebSocket:  ws://localhost%s/ws/live", addr)
	log.Printf("==================================================")

	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("Ошибка сервера: %v", err)
	}
}
