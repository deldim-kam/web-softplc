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

const (
	MaxRloNodes       = 1024
	MaxStateInstances = 512
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

type LdElement struct {
	ID       string      `json:"id"`
	Type     string      `json:"type"`
	Operand1 string      `json:"operand1"`
	Operand2 string      `json:"operand2,omitempty"`
	Operand3 string      `json:"operand3,omitempty"`
	Parallel []LdElement `json:"parallel,omitempty"`
}

type LdRung struct {
	ID       string      `json:"id"`
	Title    string      `json:"title"`
	Elements []LdElement `json:"elements"`
}

type LdProgramData struct {
	Rungs []LdRung `json:"rungs"`
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

var (
	stateInstanceCounter = 0
	globalRloSeq         = 1
	rloMap               = make(map[string]int)
)

func nextStateIdx(blockName string) int {
	if stateInstanceCounter >= MaxStateInstances {
		log.Fatalf("%s:1:1: error: превышен лимит экземпляров состояний таймеров/фронтов (%d)", blockName, MaxStateInstances)
	}
	idx := stateInstanceCounter
	stateInstanceCounter++
	return idx
}

func allocRloSlot(blockName, elemID string) int {
	if globalRloSeq >= MaxRloNodes {
		log.Fatalf("%s:1:1: error: превышен лимит узлов мониторинга RLO (%d)", blockName, MaxRloNodes)
	}
	slot := globalRloSeq
	globalRloSeq++
	rloMap[fmt.Sprintf("%s:%s", blockName, elemID)] = slot
	return slot
}

func resolveOperand(op string, datablocks []DataBlock) string {
	res := strings.TrimSpace(op)
	if res == "" {
		return "0"
	}
	for _, db := range datablocks {
		res = strings.ReplaceAll(res, fmt.Sprintf(`"%s".`, db.Name), fmt.Sprintf("db%d->", db.ID))
	}
	if strings.EqualFold(res, "TRUE") {
		return "1"
	}
	if strings.EqualFold(res, "FALSE") {
		return "0"
	}
	return res
}

func compileConditionExpr(blockName string, el LdElement, datablocks []DataBlock) (string, string) {
	op1 := resolveOperand(el.Operand1, datablocks)
	op2 := resolveOperand(el.Operand2, datablocks)
	idx := nextStateIdx(blockName)

	switch el.Type {
	case "NO":
		return "", fmt.Sprintf("(%s != 0)", op1)
	case "NC":
		return "", fmt.Sprintf("!(%s != 0)", op1)
	case "P_TRIG":
		pre := fmt.Sprintf("bool _c_%d = (%s != 0); bool _p_%d = _c_%d && !__ld_edge[%d]; __ld_edge[%d] = _c_%d;", idx, op1, idx, idx, idx, idx, idx)
		return pre, fmt.Sprintf("_p_%d", idx)
	case "N_TRIG":
		pre := fmt.Sprintf("bool _c_%d = (%s != 0); bool _n_%d = !_c_%d && __ld_edge[%d]; __ld_edge[%d] = _c_%d;", idx, op1, idx, idx, idx, idx, idx)
		return pre, fmt.Sprintf("_n_%d", idx)
	case "CMP_EQ":
		return "", fmt.Sprintf("((float)(%s) == (float)(%s))", op1, op2)
	case "CMP_NE":
		return "", fmt.Sprintf("((float)(%s) != (float)(%s))", op1, op2)
	case "CMP_GT":
		return "", fmt.Sprintf("((float)(%s) > (float)(%s))", op1, op2)
	case "CMP_LT":
		return "", fmt.Sprintf("((float)(%s) < (float)(%s))", op1, op2)
	case "CMP_GE":
		return "", fmt.Sprintf("((float)(%s) >= (float)(%s))", op1, op2)
	case "CMP_LE":
		return "", fmt.Sprintf("((float)(%s) <= (float)(%s))", op1, op2)
	default:
		return "", "true"
	}
}

func compileLDtoC(blockName string, ldJson string, datablocks []DataBlock) string {
	var ld LdProgramData
	if err := json.Unmarshal([]byte(ldJson), &ld); err != nil {
		log.Fatalf("%s:1:1: error: ошибка разбора JSON-структуры LD: %v", blockName, err)
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("    // === BEGIN LADDER BLOCK [%s] ===\n", blockName))

	for rIdx, rung := range ld.Rungs {
		sb.WriteString(fmt.Sprintf("    // Network %d: %s\n", rIdx+1, rung.Title))
		sb.WriteString("    {\n        bool rung_flow = true;\n")

		for _, el := range rung.Elements {
			mainRloIdx := allocRloSlot(blockName, el.ID)
			parRloIndices := make([]int, len(el.Parallel))
			for pI, par := range el.Parallel {
				parRloIndices[pI] = allocRloSlot(blockName, par.ID)
			}

			op1 := resolveOperand(el.Operand1, datablocks)
			op2 := resolveOperand(el.Operand2, datablocks)
			op3 := resolveOperand(el.Operand3, datablocks)
			idx := nextStateIdx(blockName)

			switch el.Type {
			case "NO", "NC", "P_TRIG", "N_TRIG", "CMP_EQ", "CMP_NE", "CMP_GT", "CMP_LT", "CMP_GE", "CMP_LE":
				sb.WriteString("        {\n            bool _in_flow = rung_flow;\n")
				preMain, exprMain := compileConditionExpr(blockName, el, datablocks)
				if preMain != "" {
					sb.WriteString("            " + preMain + "\n")
				}
				sb.WriteString(fmt.Sprintf("            bool _m_cond = (%s);\n", exprMain))
				sb.WriteString("            bool _m_rlo = _in_flow && _m_cond;\n")
				sb.WriteString(fmt.Sprintf("            if (ctx->rlo_status) ctx->rlo_status[%d] = _m_rlo ? 1 : 0;\n", mainRloIdx))
				sb.WriteString("            bool _branch_any = _m_rlo;\n")

				for pI, par := range el.Parallel {
					prePar, exprPar := compileConditionExpr(blockName, par, datablocks)
					if prePar != "" {
						sb.WriteString("            " + prePar + "\n")
					}
					sb.WriteString(fmt.Sprintf("            bool _p_rlo_%d = _in_flow && (%s);\n", pI, exprPar))
					sb.WriteString(fmt.Sprintf("            if (ctx->rlo_status) ctx->rlo_status[%d] = _p_rlo_%d ? 1 : 0;\n", parRloIndices[pI], pI))
					sb.WriteString(fmt.Sprintf("            _branch_any = _branch_any || _p_rlo_%d;\n", pI))
				}
				sb.WriteString("            rung_flow = _branch_any;\n        }\n")
				continue

			case "TON":
				sb.WriteString(fmt.Sprintf("        if (rung_flow) { if (__ld_timer[%d] < (int32_t)(%s)) __ld_timer[%d] += 10; rung_flow = (__ld_timer[%d] >= (int32_t)(%s)); } else { __ld_timer[%d] = 0; rung_flow = false; }\n", idx, op1, idx, idx, op1, idx))
				if el.Operand3 != "" && strings.Contains(op3, "db") {
					sb.WriteString(fmt.Sprintf("        %s = rung_flow ? 1 : 0;\n", op3))
				}
			case "TOF":
				sb.WriteString(fmt.Sprintf("        if (rung_flow) { __ld_timer[%d] = (int32_t)(%s); __ld_edge[%d] = true; } else { if (__ld_timer[%d] > 0) __ld_timer[%d] -= 10; rung_flow = (__ld_edge[%d] && __ld_timer[%d] > 0); }\n", idx, op1, idx, idx, idx, idx, idx))
				if el.Operand3 != "" && strings.Contains(op3, "db") {
					sb.WriteString(fmt.Sprintf("        %s = rung_flow ? 1 : 0;\n", op3))
				}
			case "CTU":
				sb.WriteString(fmt.Sprintf("        { bool _cu = rung_flow && !__ld_edge[%d]; __ld_edge[%d] = rung_flow; if (_cu) __ld_counter[%d]++; rung_flow = (__ld_counter[%d] >= (int32_t)(%s)); }\n", idx, idx, idx, idx, op2))
				if el.Operand3 != "" && strings.Contains(op3, "db") {
					sb.WriteString(fmt.Sprintf("        %s = __ld_counter[%d];\n", op3, idx))
				}
			case "CTD":
				sb.WriteString(fmt.Sprintf("        { bool _cd = rung_flow && !__ld_edge[%d]; __ld_edge[%d] = rung_flow; if (_cd) __ld_counter[%d]--; rung_flow = (__ld_counter[%d] <= 0); }\n", idx, idx, idx, idx))
				if el.Operand3 != "" && strings.Contains(op3, "db") {
					sb.WriteString(fmt.Sprintf("        %s = __ld_counter[%d];\n", op3, idx))
				}
			case "ADD":
				if strings.Contains(op3, "db") {
					sb.WriteString(fmt.Sprintf("        if (rung_flow) { %s = (%s) + (%s); }\n", op3, op1, op2))
				}
			case "SUB":
				if strings.Contains(op3, "db") {
					sb.WriteString(fmt.Sprintf("        if (rung_flow) { %s = (%s) - (%s); }\n", op3, op1, op2))
				}
			case "MUL":
				if strings.Contains(op3, "db") {
					sb.WriteString(fmt.Sprintf("        if (rung_flow) { %s = (%s) * (%s); }\n", op3, op1, op2))
				}
			case "DIV":
				if strings.Contains(op3, "db") {
					sb.WriteString(fmt.Sprintf("        if (rung_flow && (float)(%s) != 0.0f) { %s = (%s) / (%s); }\n", op2, op3, op1, op2))
				}
			case "COIL":
				if strings.Contains(op1, "db") {
					sb.WriteString(fmt.Sprintf("        %s = rung_flow ? 1 : 0;\n", op1))
				}
			case "COIL_INV":
				if strings.Contains(op1, "db") {
					sb.WriteString(fmt.Sprintf("        %s = (!rung_flow) ? 1 : 0;\n", op1))
				}
			case "COIL_SET":
				if strings.Contains(op1, "db") {
					sb.WriteString(fmt.Sprintf("        if (rung_flow) { %s = 1; }\n", op1))
				}
			case "COIL_RESET":
				if strings.Contains(op1, "db") {
					sb.WriteString(fmt.Sprintf("        if (rung_flow) { %s = 0; }\n", op1))
				}
			}

			sb.WriteString(fmt.Sprintf("        if (ctx->rlo_status) ctx->rlo_status[%d] = rung_flow ? 1 : 0;\n", mainRloIdx))
		}
		sb.WriteString("    }\n")
	}
	sb.WriteString("    // === END LADDER BLOCK ===\n")
	return sb.String()
}

func compileBlockToC(pb ProgramBlock, programBlocks []ProgramBlock, datablocks []DataBlock, depth int) string {
	if depth > 10 {
		log.Fatalf("%s:1:1: error: превышена глубина вложенности вызовов FC/FB (рекурсия)", pb.Name)
	}

	if pb.Language == "LD" {
		return compileLDtoC(pb.Name, pb.Code, datablocks)
	}

	lines := strings.Split(pb.Code, "\n")
	var cLines []string

	reIfThen := regexp.MustCompile(`(?i)\bIF\s+(.*?)\s+THEN\b`)
	reElsif := regexp.MustCompile(`(?i)\bELSIF\s+(.*?)\s+THEN\b`)
	reElse := regexp.MustCompile(`(?i)\bELSE\b`)
	reEndIf := regexp.MustCompile(`(?i)\bEND_IF;?`)

	for lineNum, line := range lines {
		trimmed := strings.TrimSpace(line)
		cLines = append(cLines, fmt.Sprintf("#line %d \"%s\"", lineNum+1, pb.Name))
		if strings.HasPrefix(trimmed, "//") || trimmed == "" {
			cLines = append(cLines, line)
			continue
		}

		inlined := false
		for _, targetPb := range programBlocks {
			if targetPb.BlockType == "FC" || targetPb.BlockType == "FB" {
				callWithQuotes := fmt.Sprintf(`"%s"(`, targetPb.Name)
				callPlain := fmt.Sprintf(`%s(`, targetPb.Name)

				if strings.Contains(trimmed, callWithQuotes) || strings.HasPrefix(trimmed, callPlain) {
					cLines = append(cLines, fmt.Sprintf("    // >>> INLINE EXPAND [%s: %s (%s)] >>>", targetPb.BlockType, targetPb.Name, targetPb.Language))
					cLines = append(cLines, "    {")
					cLines = append(cLines, compileBlockToC(targetPb, programBlocks, datablocks, depth+1))
					cLines = append(cLines, "    }")
					cLines = append(cLines, fmt.Sprintf("    // <<< END INLINE [%s] <<<", targetPb.Name))
					inlined = true
					break
				}
			}
		}

		if inlined {
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

	var sb strings.Builder
	sb.WriteString("#include <stdint.h>\n#include <stdbool.h>\n#include <math.h>\n#include <stdio.h>\n")
	sb.WriteString("#include \"plc_abi.h\"\n\n")
	sb.WriteString("const uint32_t PLC_LOGIC_ABI_VERSION = PLC_ABI_VERSION;\n\n")

	sb.WriteString(fmt.Sprintf("static bool    __ld_edge[%d]    = {0};\n", MaxStateInstances))
	sb.WriteString(fmt.Sprintf("static int32_t __ld_timer[%d]   = {0};\n", MaxStateInstances))
	sb.WriteString(fmt.Sprintf("static int32_t __ld_counter[%d] = {0};\n\n", MaxStateInstances))

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
			case "TIME":
				cType = "int32_t"
			}
			sb.WriteString(fmt.Sprintf("    %s %s;\n", cType, v.Name))
		}
		sb.WriteString(fmt.Sprintf("} DB%d_t;\n\n", db.ID))
	}

	var ob1Block ProgramBlock
	foundOb := false
	for _, pb := range proj.ProgramBlocks {
		if pb.BlockType == "OB" {
			ob1Block = pb
			foundOb = true
			break
		}
	}

	var monolithicC string
	if foundOb {
		monolithicC = compileBlockToC(ob1Block, proj.ProgramBlocks, proj.Datablocks, 0)
	}

	sb.WriteString("static bool g_db_initialized = false;\n\n")
	sb.WriteString("void plc_logic_step(PlcContext *ctx) {\n")
	sb.WriteString("    if (!ctx || !ctx->get_db) return;\n\n")

	for _, db := range proj.Datablocks {
		sb.WriteString(fmt.Sprintf("    PlcDataBlock *raw_db%d = ctx->get_db(%d);\n", db.ID, db.ID))
		sb.WriteString(fmt.Sprintf("    if (!raw_db%d || !raw_db%d->ptr) return;\n", db.ID, db.ID))
		sb.WriteString(fmt.Sprintf("    DB%d_t *db%d = (DB%d_t *)raw_db%d->ptr;\n\n", db.ID, db.ID, db.ID, db.ID))
	}

	sb.WriteString("    if (!g_db_initialized) {\n")
	for _, db := range proj.Datablocks {
		for _, v := range db.Variables {
			initVal := strings.TrimSpace(v.InitValue)
			if strings.EqualFold(initVal, "true") {
				initVal = "1"
			} else if strings.EqualFold(initVal, "false") || initVal == "" {
				initVal = "0"
			}
			sb.WriteString(fmt.Sprintf("        db%d->%s = %s;\n", db.ID, v.Name, initVal))
		}
	}
	sb.WriteString("        g_db_initialized = true;\n")
	sb.WriteString("    }\n\n")

	sb.WriteString("    // --- MONOLITHIC PLC SCAN CYCLE ---\n")
	sb.WriteString(monolithicC)
	sb.WriteString("\n}\n")

	cFilePath := filepath.Join(*outDir, "logic.c")
	soFilePath := filepath.Join(*outDir, "logic.so")
	rloMapPath := filepath.Join(*outDir, "rlo_map.json")

	if err := os.WriteFile(cFilePath, []byte(sb.String()), 0644); err != nil {
		log.Fatalf("Write logic.c error: %v", err)
	}

	if rloBytes, err := json.MarshalIndent(rloMap, "", "  "); err == nil {
		_ = os.WriteFile(rloMapPath, rloBytes, 0644)
	}

	gccCmd := exec.Command("gcc", "-O2", "-shared", "-fPIC", "-I"+*includeDir, cFilePath, "-o", soFilePath)
	if out, err := gccCmd.CombinedOutput(); err != nil {
		log.Fatalf("GCC error:\n%s", string(out))
	}
	fmt.Println("Compiled ST+LD logic.so and rlo_map.json successfully.")
}
