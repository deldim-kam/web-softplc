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
	buildMu   sync.Mutex
)

type ForceEntry struct {
	Active bool   `json:"active"`
	Value  string `json:"value"`
}

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

func runCompileAndReload() (string, error) {
	buildMu.Lock()
	defer buildMu.Unlock()

	cmd := exec.Command("./bin/softplc-compiler",
		"-project=../core/temp_project.json",
		"-include=../core/include",
		"-out=../core",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), err
	}

	pid, err := getCorePID()
	if err == nil {
		if proc, err := os.FindProcess(pid); err == nil {
			_ = proc.Signal(syscall.SIGUSR1)
			log.Printf("[HOT RELOAD] SIGUSR1 отправлен core PID %d", pid)
		}
	}
	return "OK", nil
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
		json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "Неверный JSON проекта"})
		return
	}

	fileBytes, _ := json.MarshalIndent(projectData, "", "  ")
	_ = os.WriteFile("../core/temp_project.json", fileBytes, 0644)

	out, err := runCompileAndReload()
	if err != nil {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   fmt.Sprintf("Ошибка компиляции: %s", out),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"message": "Логика скомпилирована. Сигнал Hot Reload отправлен ядру.",
	})
}

func handleGeneratedC(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	content, err := os.ReadFile("../core/logic.c")
	if err != nil {
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"code":    "// Файл logic.c ещё не сгенерирован.\n// Нажмите 'Build & Hot Reload'.",
		})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"code":    string(content),
	})
}

type ForceRequest struct {
	DbID     int    `json:"dbId"`
	VarName  string `json:"varName"`
	ValueStr string `json:"value"`
	Active   bool   `json:"active"` // true = включить Force, false = снять Force (Unforce)
}

func loadForces() map[string]ForceEntry {
	forces := make(map[string]ForceEntry)
	if data, err := os.ReadFile("../core/force_state.json"); err == nil {
		_ = json.Unmarshal(data, &forces)
	}
	return forces
}

func saveForces(forces map[string]ForceEntry) {
	data, _ := json.MarshalIndent(forces, "", "  ")
	_ = os.WriteFile("../core/force_state.json", data, 0644)
}

func handleGetForces(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(loadForces())
}

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

	cleanVal := strings.TrimSpace(cleanVal)
	if req.Active {
		// Очищаем ведущие нули (чтобы 01500 не превращалось в восьмеричный литерал Си)
		if cleanVal != "true" && cleanVal != "false" && cleanVal != "TRUE" && cleanVal != "FALSE" {
			if fVal, err := strconv.ParseFloat(cleanVal, 64); err == nil {
				cleanVal = strconv.FormatFloat(fVal, 'f', -1, 64)
			}
		}
		forces := loadForces()
		forces[req.VarName] = ForceEntry{Active: true, Value: cleanVal}
		saveForces(forces)
	} else {
		forces := loadForces()
		delete(forces, req.VarName)
		saveForces(forces)
	}

	forces := loadForces()

	// Перекомпилируем логику с учётом обновления маски Force и делаем Hot Reload
	if out, err := runCompileAndReload(); err != nil {
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   fmt.Sprintf("Ошибка применения Force при сборке: %s", out),
		})
		return
	}

	msg := fmt.Sprintf("Force ВКЛЮЧЁН: %s := %s", req.VarName, cleanVal)
	if !req.Active {
		msg = fmt.Sprintf("Force СНЯТ (Unforce): %s", req.VarName)
	}

	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"message": msg,
		"forces":  forces,
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
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[PANIC RECOVER] ShmBroadcaster: %v", r)
			}
		}()

		for range ticker.C {
			clientsMu.Lock()
			count := len(clients)
			clientsMu.Unlock()

			if count == 0 {
				continue
			}

			snapshot := readLiveShm()
			data, err := json.Marshal(snapshot)
			if err != nil {
				continue
			}

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
	http.HandleFunc("/api/forces", enableCORS(handleGetForces))
	http.HandleFunc("/api/generated-c", enableCORS(handleGeneratedC))
	http.HandleFunc("/ws/live", handleLiveWS)

	log.Println("[Web-SoftPLC Gateway] Сервер слушает :8080 (Force Override & C-Viewer active)")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Fatal: %v", err)
	}
}
