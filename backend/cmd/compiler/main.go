package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

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

type ProgramBlock struct {
	ID        int    `json:"id"`
	BlockType string `json:"blockType"` // OB, FB, FC
	Name      string `json:"name"`
	Language  string `json:"language"`
	Code      string `json:"code"`
}

type Project struct {
	ProjectName   string         `json:"projectName"`
	Datablocks    []DataBlock    `json:"datablocks"`
	ProgramBlocks []ProgramBlock `json:"programBlocks"`
}

type ForceEntry struct {
	Active bool   `json:"active"`
	Value  string `json:"value"`
}

// Разворачивание вызовов FC и FB в единое полотно ST (Inlining)
func inlineBlocks(stCode string, programBlocks []ProgramBlock, depth int) string {
	if depth > 10 {
		return "// [WARNING] Превышена глубина вложенности вызовов FC/FB\n" + stCode
	}

	lines := strings.Split(stCode, "\n")
	var expandedLines []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "//") {
			expandedLines = append(expandedLines, line)
			continue
		}

		replaced := false
		for _, pb := range programBlocks {
			if pb.BlockType == "FC" || pb.BlockType == "FB" {
				reCall := regexp.MustCompile(fmt.Sprintf(`(?i)^(?:"%s"|%s)\s*\(.*?\)\s*;?$`, regexp.QuoteMeta(pb.Name), regexp.QuoteMeta(pb.Name)))
				if reCall.MatchString(trimmed) {
					expandedLines = append(expandedLines, fmt.Sprintf("    // >>> INLINE EXPAND [%s: %s] >>>", pb.BlockType, pb.Name))
					expandedLines = append(expandedLines, "    {")
					innerCode := inlineBlocks(pb.Code, programBlocks, depth+1)
					for _, innerLine := range strings.Split(innerCode, "\n") {
						expandedLines = append(expandedLines, "        "+innerLine)
					}
					expandedLines = append(expandedLines, "    }")
					expandedLines = append(expandedLines, fmt.Sprintf("    // <<< END INLINE [%s] <<<", pb.Name))
					replaced = true
					break
				}
			}
		}

		if !replaced {
			expandedLines = append(expandedLines, line)
		}
	}

	return strings.Join(expandedLines, "\n")
}

// Трансляция единого полотна ST в чистый C
func translateMonolithicSTtoC(stCode string, datablocks []DataBlock) string {
	lines := strings.Split(stCode, "\n")
	var cLines []string

	reIfThen := regexp.MustCompile(`(?i)\bIF\s+(.*?)\s+THEN\b`)
	reElsif := regexp.MustCompile(`(?i)\bELSIF\s+(.*?)\s+THEN\b`)
	reElse := regexp.MustCompile(`(?i)\bELSE\b`)
	reEndIf := regexp.MustCompile(`(?i)\bEND_IF;?`)

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "//") || trimmed == "" || trimmed == "{" || trimmed == "}" {
			cLines = append(cLines, line)
			continue
		}

		rLine := line

		// Замена обращений ко всем DB: "Line_Params".Var -> db1->Var
		for _, db := range datablocks {
			rLine = strings.ReplaceAll(rLine, fmt.Sprintf(`"%s".`, db.Name), fmt.Sprintf("db%d->", db.ID))
		}

		// Управляющие конструкции IEC ST
		rLine = reIfThen.ReplaceAllString(rLine, "if ($1) {")
		rLine = reElsif.ReplaceAllString(rLine, "} else if ($1) {")
		rLine = reElse.ReplaceAllString(rLine, "} else {")
		rLine = reEndIf.ReplaceAllString(rLine, "}")

		// Операторы присваивания и константы
		rLine = strings.ReplaceAll(rLine, ":=", "=")
		rLine = regexp.MustCompile(`(?i)\bTRUE\b`).ReplaceAllString(rLine, "1")
		rLine = regexp.MustCompile(`(?i)\bFALSE\b`).ReplaceAllString(rLine, "0")

		cLines = append(cLines, rLine)
	}

	return strings.Join(cLines, "\n")
}

func main() {
	projectPath := flag.String("project", "../core/temp_project.json", "Путь к JSON проекта")
	includeDir := flag.String("include", "../core/include", "Путь к заголовочным файлам core")
	outDir := flag.String("out", "../core", "Каталог вывода logic.so")
	flag.Parse()

	data, err := os.ReadFile(*projectPath)
	if err != nil {
		log.Fatalf("Ошибка чтения проекта: %v", err)
	}

	var proj Project
	if err := json.Unmarshal(data, &proj); err != nil {
		log.Fatalf("Ошибка парсинга проекта: %v", err)
	}

	forces := make(map[string]ForceEntry)
	if fData, err := os.ReadFile(filepath.Join(*outDir, "force_state.json")); err == nil {
		_ = json.Unmarshal(fData, &forces)
	}

	var sb strings.Builder
	sb.WriteString("#include <stdint.h>\n#include <stdbool.h>\n#include <math.h>\n#include <stdio.h>\n")
	sb.WriteString("#include \"plc_abi.h\"\n\n")

	// 1. Структуры Data Blocks
	for _, db := range proj.Datablocks {
		sb.WriteString(fmt.Sprintf("// --- DB%d: %s ---\n", db.ID, db.Name))
		sb.WriteString("typedef struct __attribute__((packed)) {\n")
		for _, v := range db.Variables {
			cType := "float"
			switch v.Type {
			case "BOOL":
				cType = "uint8_t"
			case "INT":
				cType = "int16_t"
			case "DINT":
				cType = "int32_t"
			case "REAL":
				cType = "float"
			case "WORD":
				cType = "uint16_t"
			}
			sb.WriteString(fmt.Sprintf("    %s %s;\n", cType, v.Name))
		}
		sb.WriteString(fmt.Sprintf("} DB%d_t;\n\n", db.ID))
	}

	// 2. Разворачивание главного цикла OB1
	var ob1Code string
	for _, pb := range proj.ProgramBlocks {
		if pb.BlockType == "OB" {
			ob1Code = pb.Code
			break
		}
	}

	monolithicST := inlineBlocks(ob1Code, proj.ProgramBlocks, 0)
	monolithicC := translateMonolithicSTtoC(monolithicST, proj.Datablocks)

	// 3. Точка входа RT-ядра с правильным получением указателя через ctx->get_db(1)
	sb.WriteString(`
void plc_logic_init(void) {}

void plc_logic_step(PlcContext *ctx) {
    if (!ctx || !ctx->get_db) return;

    DB1_t *db1 = (DB1_t *)ctx->get_db(1);
    if (!db1) return;

    // --- 1. MONOLITHIC PLC SCAN CYCLE (OB1 + INLINED FC/FB) ---
`)
	sb.WriteString(monolithicC)

	sb.WriteString("\n\n    // --- 2. HARDWARE FORCE OVERRIDE (END OF SCAN) ---\n")
	for varName, entry := range forces {
		if entry.Active {
			val := entry.Value
			if val == "true" || val == "TRUE" {
				val = "1"
			} else if val == "false" || val == "FALSE" {
				val = "0"
			}
			sb.WriteString(fmt.Sprintf("    db1->%s = %s; // [FORCED]\n", varName, val))
		}
	}

	sb.WriteString("}\n")

	cFilePath := filepath.Join(*outDir, "logic.c")
	soFilePath := filepath.Join(*outDir, "logic.so")

	if err := os.WriteFile(cFilePath, []byte(sb.String()), 0644); err != nil {
		log.Fatalf("Ошибка записи logic.c: %v", err)
	}

	gccCmd := exec.Command("gcc", "-O2", "-shared", "-fPIC", "-I"+*includeDir, cFilePath, "-o", soFilePath)
	out, err := gccCmd.CombinedOutput()
	if err != nil {
		log.Fatalf("Ошибка сборки GCC: %v\nВывод: %s", err, string(out))
	}

	fmt.Println("logic.so успешно скомпилирован под ABI PlcContext.")
}
