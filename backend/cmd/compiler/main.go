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
	BlockType string `json:"blockType"`
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

func inlineBlocks(stCode string, programBlocks []ProgramBlock, depth int) string {
	if depth > 10 {
		return "// [WARNING] Max inline depth reached\n" + stCode
	}
	lines := strings.Split(stCode, "\n")
	var expandedLines []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "//") || trimmed == "" {
			expandedLines = append(expandedLines, line)
			continue
		}

		replaced := false
		for _, pb := range programBlocks {
			if pb.BlockType == "FC" || pb.BlockType == "FB" {
				callWithQuotes := fmt.Sprintf(`"%s"(`, pb.Name)
				callPlain := fmt.Sprintf(`%s(`, pb.Name)

				if strings.Contains(trimmed, callWithQuotes) || strings.HasPrefix(trimmed, callPlain) {
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
		for _, db := range datablocks {
			rLine = strings.ReplaceAll(rLine, fmt.Sprintf(`"%s".`, db.Name), fmt.Sprintf("db%d->", db.ID))
		}

		rLine = reIfThen.ReplaceAllString(rLine, "if ($1) {")
		rLine = reElsif.ReplaceAllString(rLine, "} else if ($1) {")
		rLine = reElse.ReplaceAllString(rLine, "} else {")
		rLine = reEndIf.ReplaceAllString(rLine, "}")

		rLine = strings.ReplaceAll(rLine, ":=", "=")
		rLine = regexp.MustCompile(`(?i)\bTRUE\b`).ReplaceAllString(rLine, "1")
		rLine = regexp.MustCompile(`(?i)\bFALSE\b`).ReplaceAllString(rLine, "0")

		cLines = append(cLines, rLine)
	}
	return strings.Join(cLines, "\n")
}

func main() {
	projectPath := flag.String("project", "../core/temp_project.json", "JSON project path")
	includeDir := flag.String("include", "../core/include", "Core include dir")
	outDir := flag.String("out", "../core", "Output dir")
	flag.Parse()

	data, err := os.ReadFile(*projectPath)
	if err != nil {
		log.Fatalf("Read project error: %v", err)
	}

	var proj Project
	if err := json.Unmarshal(data, &proj); err != nil {
		log.Fatalf("Parse project error: %v", err)
	}

	forces := make(map[string]ForceEntry)
	if fData, err := os.ReadFile(filepath.Join(*outDir, "force_state.json")); err == nil {
		_ = json.Unmarshal(fData, &forces)
	}

	var sb strings.Builder
	sb.WriteString("#include <stdint.h>\n#include <stdbool.h>\n#include <math.h>\n#include <stdio.h>\n")
	sb.WriteString("#include \"plc_abi.h\"\n\n")
	sb.WriteString("const uint32_t PLC_LOGIC_ABI_VERSION = PLC_ABI_VERSION;\n\n")

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

	var ob1Code string
	for _, pb := range proj.ProgramBlocks {
		if pb.BlockType == "OB" {
			ob1Code = pb.Code
			break
		}
	}

	monolithicST := inlineBlocks(ob1Code, proj.ProgramBlocks, 0)
	monolithicC := translateMonolithicSTtoC(monolithicST, proj.Datablocks)

	sb.WriteString("static bool g_db_initialized = false;\n\n")
	sb.WriteString("void plc_logic_step(PlcContext *ctx) {\n")
	sb.WriteString("    if (!ctx || !ctx->get_db) return;\n\n")

	// Разыменование всех DB через raw_db->ptr
	for _, db := range proj.Datablocks {
		sb.WriteString(fmt.Sprintf("    PlcDataBlock *raw_db%d = ctx->get_db(%d);\n", db.ID, db.ID))
		sb.WriteString(fmt.Sprintf("    if (!raw_db%d || !raw_db%d->ptr) return;\n", db.ID, db.ID))
		sb.WriteString(fmt.Sprintf("    DB%d_t *db%d = (DB%d_t *)raw_db%d->ptr;\n\n", db.ID, db.ID, db.ID, db.ID))
	}

	// 1. Однократная инициализация начальных значений всех DB
	sb.WriteString("    if (!g_db_initialized) {\n")
	for _, db := range proj.Datablocks {
		for _, v := range db.Variables {
			initVal := strings.TrimSpace(v.InitValue)
			if initVal == "true" || initVal == "TRUE" {
				initVal = "1"
			} else if initVal == "false" || initVal == "FALSE" || initVal == "" {
				initVal = "0"
			}
			sb.WriteString(fmt.Sprintf("        db%d->%s = %s;\n", db.ID, v.Name, initVal))
		}
	}
	sb.WriteString("        g_db_initialized = true;\n")
	sb.WriteString("    }\n\n")

	// 2. PRE-SCAN FORCE OVERRIDE (Подача форсированных значений на вход цикла до логики)
	sb.WriteString("    // --- PRE-SCAN FORCE OVERRIDE ---\n")
	for varName, entry := range forces {
		if entry.Active {
			val := entry.Value
			if val == "true" || val == "TRUE" {
				val = "1"
			} else if val == "false" || val == "FALSE" {
				val = "0"
			}
			sb.WriteString(fmt.Sprintf("    db1->%s = %s; // [FORCED INPUT]\n", varName, val))
		}
	}

	// 3. Выполнение логики OB1 + инлайн FC/FB
	sb.WriteString("\n    // --- MONOLITHIC PLC SCAN CYCLE (OB1 + INLINED FC/FB) ---\n")
	sb.WriteString(monolithicC)
	sb.WriteString("\n}\n")

	cFilePath := filepath.Join(*outDir, "logic.c")
	soFilePath := filepath.Join(*outDir, "logic.so")

	if err := os.WriteFile(cFilePath, []byte(sb.String()), 0644); err != nil {
		log.Fatalf("Write logic.c error: %v", err)
	}

	gccCmd := exec.Command("gcc", "-O2", "-shared", "-fPIC", "-I"+*includeDir, cFilePath, "-o", soFilePath)
	if out, err := gccCmd.CombinedOutput(); err != nil {
		log.Fatalf("GCC error: %v\n%s", err, string(out))
	}
	fmt.Println("Compiled logic.so successfully.")
}
