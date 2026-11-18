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
	"path/filepath"
	"regexp"
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

type Variable struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	InitValue string `json:"initValue"`
}

type DataBlock struct {
	ID        int        `json:"id"`
	Name      string     `json:"name"`
	Type      string     `json:"type"`
	Variables []Variable `json:"variables"`
}

type ProjectSchema struct {
	Datablocks []DataBlock `json:"datablocks"`
}

type DiagnosticItem struct {
	BlockName string `json:"blockName"`
	Line      int    `json:"line"`
	Column    int    `json:"column"`
	Severity  string `json:"severity"`
	Message   string `json:"message"`
}

type ForceEntry struct {
	Key    string `json:"key"` // "Line_Params".Target_Speed
	DbID   int    `json:"dbId"`
	DbName string `json:"dbName"`
	Var    string `json:"varName"`
	Type   string `json:"varType"`
	Offset int    `json:"offset"`
	Size   int    `json:"size"`
	Value  string `json:"value"`
	Active bool   `json:"active"`
}

var (
	clients       = make(map[*websocket.Conn]bool)
	clientsMu     sync.Mutex
	buildMu       sync.Mutex
	schemaMu      sync.RWMutex
	currentSchema ProjectSchema
	forcesMu      sync.RWMutex
	activeForces  = make(map[string]ForceEntry)
	lastCycleTick uint64
	lastTickTime  time.Time
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

func typeSize(iecType string) int {
	switch iecType {
	case "BOOL":
		return 1
	case "INT", "WORD":
		return 2
	case "DINT", "REAL", "TIME":
		return 4
	default:
		return 4
	}
}

func loadSchemaFromDisk() {
	data, err := os.ReadFile("../core/temp_project.json")
	if err != nil {
		data, err = os.ReadFile("../contracts/sample_project.json")
	}
	if err == nil {
		var s ProjectSchema
		if json.Unmarshal(data, &s) == nil {
			schemaMu.Lock()
			currentSchema = s
			schemaMu.Unlock()
		}
	}
}

func getCorePID() (int, error) {
	data, err := os.ReadFile("../core/softplc.pid")
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(string(data)))
}

// Синхронизация таблицы активных форсов напрямую в /dev/shm/softplc_sys_shm (без GCC!)
func syncForcesToSysShm() {
	f, err := os.OpenFile("/dev/shm/softplc_sys_shm", os.O_RDWR, 0666)
	if err != nil {
		return
	}
	defer f.Close()

	// В структуре PlcSysShm:
	// cycle_tick (8) + timestamp_ns (8) + scan_time_us (4) + jitter_us (4) + max_jitter_us (4) + core_running (1) + rlo_status (256) = 285 байт
	// force_count (4 байта на смещении 285), затем массив forces[64] по 14 байт каждый (начиная со смещения 289)
	const forceCountOffset = 1053
		const itemSize = 14

	buf := make([]byte, 4+64*itemSize)
	forcesMu.RLock()
	defer forcesMu.RUnlock()

	idx := 0
	for _, fe := range activeForces {
		if !fe.Active || idx >= 64 {
			continue
		}
		base := 4 + idx*itemSize
		buf[base+0] = 1
		binary.LittleEndian.PutUint16(buf[base+1:base+3], uint16(fe.DbID))
		binary.LittleEndian.PutUint16(buf[base+3:base+5], uint16(fe.Offset))
		buf[base+5] = uint8(fe.Size)

		switch fe.Type {
		case "BOOL":
			if strings.EqualFold(fe.Value, "true") || fe.Value == "1" {
				buf[base+6] = 1
			}
		case "INT":
			v, _ := strconv.Atoi(fe.Value)
			binary.LittleEndian.PutUint16(buf[base+6:base+8], uint16(int16(v)))
		case "WORD":
			v, _ := strconv.ParseUint(fe.Value, 10, 16)
			binary.LittleEndian.PutUint16(buf[base+6:base+8], uint16(v))
		case "DINT", "TIME":
			v, _ := strconv.Atoi(fe.Value)
			binary.LittleEndian.PutUint32(buf[base+6:base+10], uint32(int32(v)))
		case "REAL":
			v, _ := strconv.ParseFloat(fe.Value, 32)
			binary.LittleEndian.PutUint32(buf[base+6:base+10], math.Float32bits(float32(v)))
		}
		idx++
	}
	binary.LittleEndian.PutUint32(buf[0:4], uint32(idx))
	_, _ = f.WriteAt(buf, forceCountOffset)
}

func parseGccDiagnostics(gccOutput string) []DiagnosticItem {
	var diags []DiagnosticItem
	// Формат благодаря #line: OB1_Main:4:12: error: ...
	re := regexp.MustCompile(`([^:\s]+):(\d+):(?:(\d+):)?\s*(error|warning):\s*(.+)`)
	for _, line := range strings.Split(gccOutput, "\n") {
		m := re.FindStringSubmatch(strings.TrimSpace(line))
		if len(m) >= 6 {
			ln, _ := strconv.Atoi(m[2])
			col, _ := strconv.Atoi(m[3])
			if col == 0 {
				col = 1
			}
			block := filepath.Base(m[1])
			diags = append(diags, DiagnosticItem{
				BlockName: block,
				Line:      ln,
				Column:    col,
				Severity:  strings.ToUpper(m[4]),
				Message:   m[5],
			})
		}
	}
	return diags
}

func runCompileAndReload() (string, []DiagnosticItem, error) {
	buildMu.Lock()
	defer buildMu.Unlock()

	cmd := exec.Command("./bin/softplc-compiler",
		"-project=../core/temp_project.json",
		"-include=../core/include",
		"-out=../core",
	)
	output, err := cmd.CombinedOutput()
	outStr := string(output)
	if err != nil {
		return outStr, parseGccDiagnostics(outStr), err
	}

	if pid, err := getCorePID(); err == nil {
		if proc, err := os.FindProcess(pid); err == nil {
			_ = proc.Signal(syscall.SIGUSR1)
		}
	}
	return "OK", nil, nil
}

func handleBuild(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	var rawProject json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&rawProject); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "Некорректный JSON проекта"})
		return
	}

	_ = os.WriteFile("../core/temp_project.json", rawProject, 0644)
	loadSchemaFromDisk()

	out, diags, err := runCompileAndReload()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]any{
			"success":     false,
			"error":       out,
			"diagnostics": diags,
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]any{
		"success":     true,
		"message":     "Логика скомпилирована и загружена в RT-ядро (Hot Reload).",
		"diagnostics": []DiagnosticItem{},
	})
}

func handleGeneratedC(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	content, err := os.ReadFile("../core/logic.c")
	if err != nil {
		json.NewEncoder(w).Encode(map[string]any{"success": false, "code": "// logic.c ещё не создан."})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"success": true, "code": string(content)})
}

func findVarOffsetAndSize(dbID int, varName string) (string, string, int, int, bool) {
	schemaMu.RLock()
	defer schemaMu.RUnlock()

	for _, db := range currentSchema.Datablocks {
		if db.ID == dbID {
			offset := 0
			for _, v := range db.Variables {
				sz := typeSize(v.Type)
				if v.Name == varName {
					return db.Name, v.Type, offset, sz, true
				}
				offset += sz
			}
		}
	}
	return "", "", 0, 0, false
}

func handleGetForces(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	forcesMu.RLock()
	defer forcesMu.RUnlock()
	json.NewEncoder(w).Encode(activeForces)
}

func handleForce(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		DbID     int    `json:"dbId"`
		VarName  string `json:"varName"`
		ValueStr string `json:"value"`
		Active   bool   `json:"active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	dbName, vType, offset, sz, ok := findVarOffsetAndSize(req.DbID, req.VarName)
	if !ok {
		json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "Переменная не найдена в схеме DB"})
		return
	}

	fullKey := fmt.Sprintf(`"%s".%s`, dbName, req.VarName)
	cleanVal := strings.TrimSpace(req.ValueStr)

	forcesMu.Lock()
	if req.Active {
		if vType != "BOOL" {
			if fVal, err := strconv.ParseFloat(cleanVal, 64); err == nil {
				cleanVal = strconv.FormatFloat(fVal, 'f', -1, 64)
			}
		}
		activeForces[fullKey] = ForceEntry{
			Key:    fullKey,
			DbID:   req.DbID,
			DbName: dbName,
			Var:    req.VarName,
			Type:   vType,
			Offset: offset,
			Size:   sz,
			Value:  cleanVal,
			Active: true,
		}
	} else {
		delete(activeForces, fullKey)
	}
	forcesMu.Unlock()

	// Мгновенно пишем в SHM без вызова GCC!
	syncForcesToSysShm()

	msg := fmt.Sprintf("Force применён в SHM: %s := %s", fullKey, cleanVal)
	if !req.Active {
		msg = fmt.Sprintf("Force снят: %s", fullKey)
	}

	forcesMu.RLock()
	defer forcesMu.RUnlock()
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"message": msg,
		"forces":  activeForces,
	})
}

func handleUnforceAll(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	forcesMu.Lock()
	activeForces = make(map[string]ForceEntry)
	forcesMu.Unlock()

	syncForcesToSysShm()

	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"message": "Все форсирования (Forces) сняты.",
		"forces":  activeForces,
	})
}

func readTelemetryPacket() map[string]any {
	values := make(map[string]any)

	schemaMu.RLock()
	dbs := currentSchema.Datablocks
	schemaMu.RUnlock()

	for _, db := range dbs {
		shmPath := fmt.Sprintf("/dev/shm/softplc_db%d_shm", db.ID)
		buf, err := os.ReadFile(shmPath)
		if err != nil {
			continue
		}
		offset := 0
		for _, v := range db.Variables {
			sz := typeSize(v.Type)
			if offset+sz > len(buf) {
				break
			}
			fullKey := fmt.Sprintf(`"%s".%s`, db.Name, v.Name)
			switch v.Type {
			case "BOOL":
				values[fullKey] = buf[offset] != 0
			case "INT":
				values[fullKey] = int16(binary.LittleEndian.Uint16(buf[offset : offset+2]))
			case "WORD":
				values[fullKey] = binary.LittleEndian.Uint16(buf[offset : offset+2])
			case "DINT", "TIME":
				values[fullKey] = int32(binary.LittleEndian.Uint32(buf[offset : offset+4]))
			case "REAL":
				bits := binary.LittleEndian.Uint32(buf[offset : offset+4])
				f := math.Float32frombits(bits)
				if math.IsNaN(float64(f)) || math.IsInf(float64(f), 0) {
					values[fullKey] = 0.0
				} else {
					values[fullKey] = math.Round(float64(f)*100) / 100
				}
			}
			offset += sz
		}
	}

	coreRunning := false
	var cycleTick uint64
	var scanTimeUs uint32
	var jitterUs int32
	var maxJitterUs int32
	rloList := make([]bool, 1024)

	sysBuf, err := os.ReadFile("/dev/shm/softplc_sys_shm")
	if err == nil && len(sysBuf) >= 1053 {
		cycleTick = binary.LittleEndian.Uint64(sysBuf[0:8])
		scanTimeUs = binary.LittleEndian.Uint32(sysBuf[16:20])
		jitterUs = int32(binary.LittleEndian.Uint32(sysBuf[20:24]))
		maxJitterUs = int32(binary.LittleEndian.Uint32(sysBuf[24:28]))
		flagRun := sysBuf[28] != 0

		if cycleTick != lastCycleTick {
			lastCycleTick = cycleTick
			lastTickTime = time.Now()
		}
		if flagRun && time.Since(lastTickTime) < 350*time.Millisecond {
			coreRunning = true
		}

		for i := 0; i < 1024; i++ {
			rloList[i] = sysBuf[29+i] != 0
		}
	}

	return map[string]any{
		"coreRunning": coreRunning,
		"cycleTick":   cycleTick,
		"scanTimeUs":  scanTimeUs,
		"jitterUs":    jitterUs,
		"maxJitterUs": maxJitterUs,
		"values":      values,
		"rlo":         rloList,
	}
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

			packet := readTelemetryPacket()
			data, err := json.Marshal(packet)
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
	loadSchemaFromDisk()
	// При старте сбрасываем старый файл форсов, чтобы не было скрытых форсирований
	_ = os.Remove("../core/force_state.json")
	syncForcesToSysShm()
	startShmBroadcaster()

	http.HandleFunc("/api/build", enableCORS(handleBuild))
	http.HandleFunc("/api/force", enableCORS(handleForce))
	http.HandleFunc("/api/forces", enableCORS(handleGetForces))
	http.HandleFunc("/api/unforce-all", enableCORS(handleUnforceAll))
	http.HandleFunc("/api/generated-c", enableCORS(handleGeneratedC))
	http.HandleFunc("/ws/live", handleLiveWS)

	log.Println("[Web-SoftPLC Gateway] Listening on :8080 (Dynamic DBs, SHM Force, RLO & Telemetry)")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Fatal: %v", err)
	}
}
