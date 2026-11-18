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

type LdElement struct {
	ID       string      `json:"id"`
	Type     string      `json:"type"`
	Operand1 string      `json:"operand1"`
	Operand2 string      `json:"operand2,omitempty"`
	Operand3 string      `json:"operand3,omitempty"`
	RloIndex int         `json:"rloIndex,omitempty"`
	// Параллельные ветки OR, подключенные параллельно этому элементу
	Parallel []LdElement `json:"parallel,omitempty"`
}

type LdRung struct {
	ID       string      `json:"id"`
	Title    string      `json:"title"`
	RloIndex int         `json:"rloIndex,omitempty"`
	Elements []LdElement `json:"elements"`
}

type LdProgramData struct {
	Rungs []LdRung `json:"rungs"`
}

type ProgramBlock struct {
	ID        int    `json:"id"`
	BlockType string `json:"blockType"`
	Name      string `json:"name"`
	Language  string `json:"language"` // "ST" or "LD"
	Code      string `json:"code"`
}

type Project struct {
	ProjectName   string         `json:"projectName"`
	Datablocks    []DataBlock    `json:"datablocks"`
	ProgramBlocks []ProgramBlock `json:"programBlocks"`
}

var stateInstanceCounter = 0
var rloNodeCounter = 1

func nextStateIdx() int {
	idx := stateInstanceCounter
	stateInstanceCounter++
	if stateInstanceCounter >= 256 {
		stateInstanceCounter = 0
	}
	return idx
}

func nextRloIdx() int {
	idx := rloNodeCounter
	rloNodeCounter++
	if rloNodeCounter >= 255 {
		rloNodeCounter = 1
	}
	return idx
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

func compileSingleContactExpr(el LdElement, datablocks []DataBlock) (string, string) {
	op1 := resolveOperand(el.Operand1, datablocks)
	op2 := resolveOperand(el.Operand2, datablocks)
	idx := nextStateIdx()

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
		return fmt.Sprintf("    // [LD PARSE ERROR in %s]: %v\n", blockName, err)
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("    // === BEGIN LADDER BLOCK [%s] ===\n", blockName))

	for rIdx, rung := range ld.Rungs {
		sb.WriteString(fmt.Sprintf("    // Network %d: %s\n", rIdx+1, rung.Title))
		sb.WriteString("    {\n        bool rung_flow = true;\n")

		for eIdx, el := range rung.Elements {
			op1 := resolveOperand(el.Operand1, datablocks)
			op2 := resolveOperand(el.Operand2, datablocks)
			op3 := resolveOperand(el.Operand3, datablocks)
			idx := nextStateIdx()
			rloKey := (rIdx*16 + eIdx + 1) % 255

			switch el.Type {
			case "NO", "NC", "P_TRIG", "N_TRIG", "CMP_EQ", "CMP_NE", "CMP_GT", "CMP_LT", "CMP_GE", "CMP_LE":
				preMain, exprMain := compileSingleContactExpr(el, datablocks)
				var preAll []string
				if preMain != "" {
					preAll = append(preAll, preMain)
				}
				orExprs := []string{exprMain}

				// Обработка параллельных веток OR (шунтов)
				for _, par := range el.Parallel {
					prePar, exprPar := compileSingleContactExpr(par, datablocks)
					if prePar != "" {
						preAll = append(preAll, prePar)
					}
					orExprs = append(orExprs, exprPar)
				}

				for _, p := range preAll {
					sb.WriteString("        " + p + "\n")
				}
				combinedOr := strings.Join(orExprs, " || ")
				sb.WriteString(fmt.Sprintf("        rung_flow = rung_flow && (%s);\n", combinedOr))

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

			// Сохраняем реальный RLO узла в SHM для 100% точной подсветки в браузере
			sb.WriteString(fmt.Sprintf("        if (ctx->rlo_status) ctx->rlo_status[%d] = rung_flow ? 1 : 0;\n", rloKey))
		}
		sb.WriteString("    }\n")
	}
	sb.WriteString("    // === END LADDER BLOCK ===\n")
	return sb.String()
}

func compileBlockToC(pb ProgramBlock, programBlocks []ProgramBlock, datablocks []DataBlock, depth int) string {
	if depth > 10 {
		return "// [WARNING] Max inline depth reached\n"
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

	sb.WriteString("static bool    __ld_edge[256]    = {0};\n")
	sb.WriteString("static int32_t __ld_timer[256]   = {0};\n")
	sb.WriteString("static int32_t __ld_counter[256] = {0};\n\n")

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

	if err := os.WriteFile(cFilePath, []byte(sb.String()), 0644); err != nil {
		log.Fatalf("Write logic.c error: %v", err)
	}

	gccCmd := exec.Command("gcc", "-O2", "-shared", "-fPIC", "-I"+*includeDir, cFilePath, "-o", soFilePath)
	if out, err := gccCmd.CombinedOutput(); err != nil {
		log.Fatalf("GCC error:\n%s", string(out))
	}
	fmt.Println("Compiled ST+LD logic.so successfully.")
}
