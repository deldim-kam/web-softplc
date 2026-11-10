package softplc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseProjectFile(t *testing.T) {
	project, err := ParseProjectFile("contracts/sample_project.json")
	if err != nil {
		t.Fatal(err)
	}
	if project.ProjectName != "Conveyor_Control" {
		t.Fatalf("ProjectName = %q, want Conveyor_Control", project.ProjectName)
	}
	if len(project.DataBlocks) != 1 || len(project.DataBlocks[0].Variables) != 3 {
		t.Fatalf("unexpected datablocks: %#v", project.DataBlocks)
	}
	if project.DataBlocks[0].Variables[0].Type != "REAL" {
		t.Fatalf("first variable type = %q, want REAL", project.DataBlocks[0].Variables[0].Type)
	}
}

func TestParseProjectRejectsMissingRequiredField(t *testing.T) {
	_, err := ParseProject([]byte(`{"projectName":"p","target":{"arch":"arm64","cycleTimeMs":10},"datablocks":[],"programs":[]}`))
	if err == nil || !strings.Contains(err.Error(), `"version" is missing`) {
		t.Fatalf("ParseProject error = %v, want missing version error", err)
	}
}

func TestParseProjectRejectsTrailingJSON(t *testing.T) {
	project, err := os.ReadFile("contracts/sample_project.json")
	if err != nil {
		t.Fatal(err)
	}
	project = append(project, []byte(` {}`)...)
	if _, err := ParseProject(project); err == nil {
		t.Fatal("ParseProject accepted multiple JSON values")
	}
}

func TestGenerateDataBlocksHeader(t *testing.T) {
	project, err := ParseProjectFile("contracts/sample_project.json")
	if err != nil {
		t.Fatal(err)
	}
	header, err := GenerateDataBlocksHeader(project.DataBlocks)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"#include <stdint.h>",
		"#define Line_Params_INITIALIZER { \\\n",
		"float Target_Speed;",
		"uint8_t Line_Enable;",
		"int16_t Error_Code;",
		".Target_Speed = 1500.0f",
		".Line_Enable = 0u",
		".Error_Code = 0 \\\n}",
		"| RETAIN */",
		"extern Line_Params_t Line_Params;",
	} {
		if !strings.Contains(header, expected) {
			t.Errorf("generated header does not contain %q:\n%s", expected, header)
		}
	}
}

func TestWriteDataBlocksHeader(t *testing.T) {
	project, err := ParseProjectFile("contracts/sample_project.json")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "datablocks.h")
	if err := WriteDataBlocksHeader(path, project.DataBlocks); err != nil {
		t.Fatal(err)
	}
	header, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(header), "#ifndef SOFTPLC_DATABLOCKS_H") {
		t.Fatalf("unexpected header contents:\n%s", header)
	}
}

func TestGenerateDataBlocksHeaderRejectsInvalidInitializerAndComments(t *testing.T) {
	block := DataBlock{
		ID:   1,
		Name: "Settings",
		Type: "global",
		Variables: []Variable{{
			Name:      "Value",
			Type:      "INT",
			InitValue: "0}; system(\"unsafe\")",
			Comment:   "comment */",
		}},
	}
	if _, err := GenerateDataBlocksHeader([]DataBlock{block}); err == nil {
		t.Fatal("GenerateDataBlocksHeader accepted a non-numeric INT initializer")
	}

	block.Variables[0].InitValue = "-42"
	header, err := GenerateDataBlocksHeader([]DataBlock{block})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(header, "/* comment * / */") || !strings.Contains(header, ".Value = -42") {
		t.Fatalf("generated header did not safely include comment and value:\n%s", header)
	}
	if strings.Contains(header, "system(") {
		t.Fatalf("generated header contains injected code:\n%s", header)
	}
}
