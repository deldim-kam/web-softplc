package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

var (
	clients   = make(map[*websocket.Conn]bool)
	clientsMu sync.Mutex
)

func enableCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func getCorePID() (int, error) {
	data, err := os.ReadFile("../core/softplc.pid")
	if err != nil {
		return 0, fmt.Errorf("softplc.pid не найден: %w", err)
	}
	pidStr := strings.TrimSpace(string(data))
	return strconv.Atoi(pidStr)
}

func handleBuild(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	var projectData any
	if err := json.NewDecoder(r.Body).Decode(&projectData); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "Неверный JSON"})
		return
	}

	tempProjectFile := "../core/temp_project.json"
	fileBytes, _ := json.MarshalIndent(projectData, "", "  ")
	_ = os.WriteFile(tempProjectFile, fileBytes, 0644)

	cmd := exec.Command("./bin/softplc-compiler",
		"-project="+tempProjectFile,
		"-include=../core/include",
		"-out=../core",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   fmt.Sprintf("Ошибка компиляции: %s", string(output)),
		})
		return
	}

	pid, err := getCorePID()
	if err == nil {
		if proc, err := os.FindProcess(pid); err == nil {
			_ = proc.Signal(syscall.SIGUSR1)
			log.Printf("[HOT RELOAD] SIGUSR1 отправлен процессу PID %d", pid)
		}
	}

	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"message": "Логика скомпилирована. Сигнал Hot Reload отправлен ядру.",
	})
}

// Запрос на форсирование значения переменной
type ForceRequest struct {
	DbID     int    `json:"dbId"`
	VarName  string `json:"varName"`
	VarType  string `json:"varType"`
	ValueStr string `json:"value"`
}

// Прямая запись байтов в /dev/shm
func handleForce(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	var req ForceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "Неверный формат запроса"})
		return
	}

	shmPath := fmt.Sprintf("/dev/shm/softplc_db%d_shm", req.DbID)
	f, err := os.OpenFile(shmPath, os.O_RDWR, 0666)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "error": fmt.Sprintf("Не удалось открыть SHM: %v", err)})
		return
	}
	defer f.Close()

	// Запись в зависимости от имени переменной и смещения в DB1
	// Target_Speed: offset 0 (float32)
	// Line_Enable:  offset 4 (uint8)
	// Error_Code:   offset 6 (int16)
	var offset int64
	var rawBytes []byte

	switch req.VarName {
	case "Target_Speed":
		offset = 0
		val, err := strconv.ParseFloat(req.ValueStr, 32)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "Некорректное значение REAL"})
			return
		}
		rawBytes = make([]byte, 4)
		binary.LittleEndian.PutUint32(rawBytes, math.Float32bits(float32(val)))

	case "Line_Enable":
		offset = 4
		val := req.ValueStr == "true" || req.ValueStr == "1" || req.ValueStr == "TRUE"
		rawBytes = []byte{0}
		if val {
			rawBytes[0] = 1
		}

	case "Error_Code":
		offset = 6
		val, err := strconv.Atoi(req.ValueStr)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "Некорректное значение INT"})
			return
		}
		rawBytes = make([]byte, 2)
		binary.LittleEndian.PutUint16(rawBytes, uint16(int16(val)))

	default:
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "Переменная не найдена для форсирования"})
		return
	}

	if _, err := f.WriteAt(rawBytes, offset); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "error": fmt.Sprintf("Ошибка записи в SHM: %v", err)})
		return
	}

	log.Printf("[FORCE] Успешно записано %s = %s в DB%d (смещение %d)", req.VarName, req.ValueStr, req.DbID, offset)

	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"message": fmt.Sprintf("Форсировано: %s := %s", req.VarName, req.ValueStr),
	})
}

func handleLiveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	clientsMu.Lock()
	clients[conn] = true
	clientsMu.Unlock()

	defer func() {
		clientsMu.Lock()
		delete(clients, conn)
		clientsMu.Unlock()
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

func readLiveShm() map[string]any {
	shmPath := "/dev/shm/softplc_db1_shm"
	buf, err := os.ReadFile(shmPath)
	if err != nil || len(buf) < 8 {
		return map[string]any{
			"Target_Speed": 0.0,
			"Line_Enable":  false,
			"Error_Code":   0,
		}
	}

	bits := binary.LittleEndian.Uint32(buf[0:4])
	speed := math.Float32frombits(bits)
	enable := buf[4] != 0
	errorCode := int16(binary.LittleEndian.Uint16(buf[6:8]))

	return map[string]any{
		"Target_Speed": math.Round(float64(speed)*10) / 10,
		"Line_Enable":  enable,
		"Error_Code":   errorCode,
	}
}

func startShmBroadcaster() {
	ticker := time.NewTicker(50 * time.Millisecond)
	go func() {
		for range ticker.C {
			clientsMu.Lock()
			count := len(clients)
			clientsMu.Unlock()

			if count == 0 {
				continue
			}

			snapshot := readLiveShm()
			data, _ := json.Marshal(snapshot)

			clientsMu.Lock()
			for conn := range clients {
				if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
					conn.Close()
					delete(clients, conn)
				}
			}
			clientsMu.Unlock()
		}
	}()
}

func main() {
	startShmBroadcaster()

	http.HandleFunc("/api/build", enableCORS(handleBuild))
	http.HandleFunc("/api/force", enableCORS(handleForce))
	http.HandleFunc("/ws/live", handleLiveWS)

	log.Println("[Web-SoftPLC Gateway] Сервер слушает :8080 (Force API enabled)")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Fatal: %v", err)
	}
}
