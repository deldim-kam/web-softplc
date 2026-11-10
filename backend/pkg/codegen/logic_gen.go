package codegen

import (
	"fmt"
	"regexp"
	"strings"
	"web-softplc/backend/pkg/model"
)

func translateStToC(stCode string, dbs []model.DataBlock) string {
	cCode := stCode

	// 1. Замена обращений к переменным DB: "Line_Params".Var -> db1->Var
	for _, db := range dbs {
		pattern := fmt.Sprintf(`"%s"\.([a-zA-Z0-9_]+)`, db.Name)
		re := regexp.MustCompile(pattern)
		replacement := fmt.Sprintf(`db%d->$1`, db.ID)
		cCode = re.ReplaceAllString(cCode, replacement)
	}

	// 2. Замена IF <условие> THEN на if (<условие>) {
	reIfThen := regexp.MustCompile(`(?i)\bIF\s+(.+?)\s+THEN\b`)
	cCode = reIfThen.ReplaceAllString(cCode, "if ($1) {")

	// 3. Замена операторов присваивания и логики
	cCode = strings.ReplaceAll(cCode, ":=", "=")

	reAnd := regexp.MustCompile(`(?i)\bAND\b`)
	cCode = reAnd.ReplaceAllString(cCode, "&&")

	reOr := regexp.MustCompile(`(?i)\bOR\b`)
	cCode = reOr.ReplaceAllString(cCode, "||")

	reNot := regexp.MustCompile(`(?i)\bNOT\b`)
	cCode = reNot.ReplaceAllString(cCode, "!")

	reElse := regexp.MustCompile(`(?i)\bELSE\b`)
	cCode = reElse.ReplaceAllString(cCode, "} else {")

	reEndIf := regexp.MustCompile(`(?i)\bEND_IF;?`)
	cCode = reEndIf.ReplaceAllString(cCode, "}")

	return cCode
}

func GenerateLogicSource(project *model.Project) (string, error) {
	var sb strings.Builder

	sb.WriteString("// Сгенерировано автоматически компилятором Web-SoftPLC.\n")
	sb.WriteString("#include \"plc_abi.h\"\n")
	sb.WriteString("#include \"generated_db.h\"\n")
	sb.WriteString("#include <stdio.h>\n\n")
	sb.WriteString("const uint32_t PLC_LOGIC_ABI_VERSION = PLC_ABI_VERSION;\n\n")

	sb.WriteString("void plc_logic_step(PlcContext *ctx) {\n")

	for _, db := range project.DataBlocks {
		sb.WriteString(fmt.Sprintf("    PlcDataBlock *raw_db%d = ctx->get_db(%d);\n", db.ID, db.ID))
		sb.WriteString(fmt.Sprintf("    if (!raw_db%d) return;\n", db.ID))
		sb.WriteString(fmt.Sprintf("    DB%d_%s_t *db%d = (DB%d_%s_t *)raw_db%d->ptr;\n\n",
			db.ID, db.Name, db.ID, db.ID, db.Name, db.ID))
	}

	for _, prog := range project.Programs {
		sb.WriteString(fmt.Sprintf("    // --- Program: %s (%s) ---\n", prog.Name, prog.Language))
		translated := translateStToC(prog.Code, project.DataBlocks)
		sb.WriteString("    " + strings.TrimSpace(translated) + "\n\n")
	}

	sb.WriteString("}\n")
	return sb.String(), nil
}
