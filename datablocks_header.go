package softplc

import (
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"unicode"
)

var cKeywords = map[string]struct{}{
	"auto": {}, "break": {}, "case": {}, "char": {}, "const": {}, "continue": {},
	"default": {}, "do": {}, "double": {}, "else": {}, "enum": {}, "extern": {},
	"float": {}, "for": {}, "goto": {}, "if": {}, "inline": {}, "int": {},
	"long": {}, "register": {}, "restrict": {}, "return": {}, "short": {},
	"signed": {}, "sizeof": {}, "static": {}, "struct": {}, "switch": {},
	"typedef": {}, "union": {}, "unsigned": {}, "void": {}, "volatile": {},
	"while": {}, "_Alignas": {}, "_Alignof": {}, "_Atomic": {}, "_Bool": {},
	"_Complex": {}, "_Generic": {}, "_Imaginary": {}, "_Noreturn": {},
	"_Static_assert": {}, "_Thread_local": {},
}

// GenerateDataBlocksHeader returns a C99 header declaring the supplied data blocks.
// BOOL maps to uint8_t, INT/DINT/TIME to int16_t/int32_t, REAL to float, and
// WORD to uint16_t. TIME initial values are signed integer milliseconds.
func GenerateDataBlocksHeader(dataBlocks []DataBlock) (string, error) {
	if dataBlocks == nil {
		return "", fmt.Errorf("datablocks must be an array")
	}

	blockIDs := make(map[int]struct{}, len(dataBlocks))
	symbols := make(map[string]struct{}, len(dataBlocks)*2)
	macroNames := make(map[string]struct{}, len(dataBlocks))
	blocks := make([]preparedDataBlock, 0, len(dataBlocks))
	for i, block := range dataBlocks {
		if block.ID < 1 {
			return "", fmt.Errorf("datablocks[%d].id must be at least 1", i)
		}
		if _, exists := blockIDs[block.ID]; exists {
			return "", fmt.Errorf("datablocks[%d].id %d is duplicated", i, block.ID)
		}
		blockIDs[block.ID] = struct{}{}
		if err := validateCIdentifier(block.Name); err != nil {
			return "", fmt.Errorf("datablocks[%d].name: %w", i, err)
		}
		if block.Type != "global" && block.Type != "instance" {
			return "", fmt.Errorf("datablocks[%d].type %q is invalid", i, block.Type)
		}
		if len(block.Variables) == 0 {
			return "", fmt.Errorf("datablocks[%d].variables must contain at least one variable", i)
		}

		if err := addCSymbol(symbols, block.Name); err != nil {
			return "", fmt.Errorf("datablocks[%d]: %w", i, err)
		}
		typeName := block.Name + "_t"
		if err := validateCIdentifier(typeName); err != nil {
			return "", fmt.Errorf("datablocks[%d] generated type: %w", i, err)
		}
		if err := addCSymbol(symbols, typeName); err != nil {
			return "", fmt.Errorf("datablocks[%d] generated type: %w", i, err)
		}
		macroNames[block.Name+"_INITIALIZER"] = struct{}{}

		prepared := preparedDataBlock{DataBlock: block, typeName: typeName}
		variableNames := make(map[string]struct{}, len(block.Variables))
		for j, variable := range block.Variables {
			if err := validateCIdentifier(variable.Name); err != nil {
				return "", fmt.Errorf("datablocks[%d].variables[%d].name: %w", i, j, err)
			}
			if _, exists := variableNames[variable.Name]; exists {
				return "", fmt.Errorf("datablocks[%d].variables[%d].name %q is duplicated", i, j, variable.Name)
			}
			variableNames[variable.Name] = struct{}{}

			cType, err := cTypeForPLCType(variable.Type)
			if err != nil {
				return "", fmt.Errorf("datablocks[%d].variables[%d]: %w", i, j, err)
			}
			initialValue, err := cInitialValue(variable.Type, variable.InitValue)
			if err != nil {
				return "", fmt.Errorf("datablocks[%d].variables[%d].initValue: %w", i, j, err)
			}
			prepared.variables = append(prepared.variables, preparedVariable{
				Variable:     variable,
				cType:        cType,
				initialValue: initialValue,
			})
		}
		blocks = append(blocks, prepared)
	}
	for macroName := range macroNames {
		if _, exists := symbols[macroName]; exists {
			return "", fmt.Errorf("generated C macro %q conflicts with a C symbol", macroName)
		}
	}

	var header strings.Builder
	header.WriteString("#ifndef SOFTPLC_DATABLOCKS_H\n")
	header.WriteString("#define SOFTPLC_DATABLOCKS_H\n\n")
	header.WriteString("#include <stdint.h>\n\n")

	for _, block := range blocks {
		fmt.Fprintf(&header, "/* Data block: %s (%s) */\n", safeCComment(block.Name), safeCComment(block.Type))
		fmt.Fprintf(&header, "typedef struct {\n")
		for _, variable := range block.variables {
			commentParts := make([]string, 0, 2)
			if variable.Comment != "" {
				commentParts = append(commentParts, safeCComment(variable.Comment))
			}
			if variable.Retain {
				commentParts = append(commentParts, "RETAIN")
			}
			if len(commentParts) != 0 {
				fmt.Fprintf(&header, "    /* %s */\n", strings.Join(commentParts, " | "))
			}
			fmt.Fprintf(&header, "    %s %s;\n", variable.cType, variable.Name)
		}
		fmt.Fprintf(&header, "} %s;\n", block.typeName)

		fmt.Fprintf(&header, "#define %s_INITIALIZER { \\\n", block.Name)
		for i, variable := range block.variables {
			lineEnd := ", \\\n"
			if i == len(block.variables)-1 {
				lineEnd = " \\\n"
			}
			fmt.Fprintf(&header, "    .%s = %s%s", variable.Name, variable.initialValue, lineEnd)
		}
		header.WriteString("}\n")
		fmt.Fprintf(&header, "extern %s %s;\n\n", block.typeName, block.Name)
	}
	header.WriteString("#endif\n")
	return header.String(), nil
}

// WriteDataBlocksHeader generates the header and writes it to path.
func WriteDataBlocksHeader(path string, dataBlocks []DataBlock) error {
	header, err := GenerateDataBlocksHeader(dataBlocks)
	if err != nil {
		return fmt.Errorf("generate C header: %w", err)
	}
	if err := os.WriteFile(path, []byte(header), 0644); err != nil {
		return fmt.Errorf("write C header %q: %w", path, err)
	}
	return nil
}

type preparedDataBlock struct {
	DataBlock
	typeName  string
	variables []preparedVariable
}

type preparedVariable struct {
	Variable
	cType        string
	initialValue string
}

func validateCIdentifier(name string) error {
	if !identifierPattern.MatchString(name) {
		return fmt.Errorf("%q is not a valid C identifier", name)
	}
	if _, keyword := cKeywords[name]; keyword {
		return fmt.Errorf("%q is a C keyword", name)
	}
	if strings.HasPrefix(name, "_") {
		return fmt.Errorf("%q uses a reserved C identifier", name)
	}
	return nil
}

func addCSymbol(symbols map[string]struct{}, name string) error {
	if _, exists := symbols[name]; exists {
		return fmt.Errorf("generated C symbol %q is duplicated", name)
	}
	symbols[name] = struct{}{}
	return nil
}

func cTypeForPLCType(plcType string) (string, error) {
	switch plcType {
	case "BOOL":
		return "uint8_t", nil
	case "INT":
		return "int16_t", nil
	case "DINT", "TIME":
		return "int32_t", nil
	case "REAL":
		return "float", nil
	case "WORD":
		return "uint16_t", nil
	default:
		return "", fmt.Errorf("unsupported PLC type %q", plcType)
	}
}

func cInitialValue(plcType, value string) (string, error) {
	value = strings.TrimSpace(value)
	switch plcType {
	case "BOOL":
		switch strings.ToLower(value) {
		case "true", "1":
			return "1u", nil
		case "false", "0":
			return "0u", nil
		default:
			return "", fmt.Errorf("%q is not a BOOL literal", value)
		}
	case "INT":
		parsed, err := strconv.ParseInt(value, 10, 16)
		if err != nil {
			return "", fmt.Errorf("%q is not a valid INT value: %w", value, err)
		}
		return strconv.FormatInt(parsed, 10), nil
	case "DINT", "TIME":
		parsed, err := strconv.ParseInt(value, 10, 32)
		if err != nil {
			return "", fmt.Errorf("%q is not a valid %s value: %w", value, plcType, err)
		}
		return strconv.FormatInt(parsed, 10), nil
	case "WORD":
		parsed, err := strconv.ParseUint(value, 10, 16)
		if err != nil {
			return "", fmt.Errorf("%q is not a valid WORD value: %w", value, err)
		}
		return strconv.FormatUint(parsed, 10) + "u", nil
	case "REAL":
		parsed, err := strconv.ParseFloat(value, 32)
		if err != nil || math.IsInf(parsed, 0) || math.IsNaN(parsed) {
			return "", fmt.Errorf("%q is not a finite REAL value", value)
		}
		formatted := strconv.FormatFloat(parsed, 'g', -1, 32)
		if !strings.ContainsAny(formatted, ".eE") {
			formatted += ".0"
		}
		return formatted + "f", nil
	default:
		return "", fmt.Errorf("unsupported PLC type %q", plcType)
	}
}

func safeCComment(comment string) string {
	comment = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, comment)
	comment = strings.ReplaceAll(comment, "*/", "* /")
	comment = strings.ReplaceAll(comment, "??", "? ?")
	comment = strings.ReplaceAll(comment, "\r", " ")
	comment = strings.ReplaceAll(comment, "\n", " ")
	return comment
}
