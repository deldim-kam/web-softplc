package softplc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
)

type Project struct {
	ProjectName string      `json:"projectName"`
	Version     string      `json:"version"`
	Target      Target      `json:"target"`
	DataBlocks  []DataBlock `json:"datablocks"`
	Programs    []Program   `json:"programs"`
}

type Target struct {
	Arch        string `json:"arch"`
	CycleTimeMs int    `json:"cycleTimeMs"`
}

type DataBlock struct {
	ID        int        `json:"id"`
	Name      string     `json:"name"`
	Type      string     `json:"type"`
	Variables []Variable `json:"variables"`
}

type Variable struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	InitValue string `json:"initValue"`
	Retain    bool   `json:"retain"`
	Comment   string `json:"comment,omitempty"`
}

type Program struct {
	Name     string `json:"name"`
	Language string `json:"language"`
	Code     string `json:"code"`
}

var identifierPattern = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// ParseProject parses and validates a SoftPLC project JSON document.
func ParseProject(data []byte) (Project, error) {
	var raw json.RawMessage
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(&raw); err != nil {
		return Project{}, fmt.Errorf("decode project JSON: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		if err == nil {
			return Project{}, fmt.Errorf("decode project JSON: multiple JSON values")
		}
		return Project{}, fmt.Errorf("decode project JSON: %w", err)
	}

	if err := validateRequiredFields(raw, "projectName", "version", "target", "datablocks", "programs"); err != nil {
		return Project{}, fmt.Errorf("validate project JSON: %w", err)
	}
	var topLevel map[string]json.RawMessage
	if err := json.Unmarshal(raw, &topLevel); err != nil {
		return Project{}, fmt.Errorf("decode project object: %w", err)
	}
	if err := validateRequiredFields(topLevel["target"], "arch", "cycleTimeMs"); err != nil {
		return Project{}, fmt.Errorf("validate target: %w", err)
	}

	var dataBlocks []json.RawMessage
	if err := json.Unmarshal(topLevel["datablocks"], &dataBlocks); err != nil {
		return Project{}, fmt.Errorf("decode datablocks: %w", err)
	}
	if dataBlocks == nil {
		return Project{}, fmt.Errorf("validate datablocks: must be an array")
	}
	for i, block := range dataBlocks {
		if err := validateRequiredFields(block, "id", "name", "type", "variables"); err != nil {
			return Project{}, fmt.Errorf("validate datablocks[%d]: %w", i, err)
		}
		var blockFields map[string]json.RawMessage
		if err := json.Unmarshal(block, &blockFields); err != nil {
			return Project{}, fmt.Errorf("decode datablocks[%d]: %w", i, err)
		}
		variables, err := decodeRawArray(blockFields["variables"])
		if err != nil {
			return Project{}, fmt.Errorf("decode datablocks[%d].variables: %w", i, err)
		}
		if variables == nil {
			return Project{}, fmt.Errorf("validate datablocks[%d].variables: must be an array", i)
		}
		for j, variable := range variables {
			if err := validateRequiredFields(variable, "name", "type", "initValue", "retain"); err != nil {
				return Project{}, fmt.Errorf("validate datablocks[%d].variables[%d]: %w", i, j, err)
			}
		}
	}

	var programs []json.RawMessage
	if err := json.Unmarshal(topLevel["programs"], &programs); err != nil {
		return Project{}, fmt.Errorf("decode programs: %w", err)
	}
	if programs == nil {
		return Project{}, fmt.Errorf("validate programs: must be an array")
	}
	for i, program := range programs {
		if err := validateRequiredFields(program, "name", "language", "code"); err != nil {
			return Project{}, fmt.Errorf("validate programs[%d]: %w", i, err)
		}
	}

	var project Project
	if err := json.Unmarshal(raw, &project); err != nil {
		return Project{}, fmt.Errorf("decode project: %w", err)
	}
	if err := project.Validate(); err != nil {
		return Project{}, err
	}
	return project, nil
}

// ParseProjectFile reads and parses a project from a file.
func ParseProjectFile(path string) (Project, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Project{}, fmt.Errorf("read project file %q: %w", path, err)
	}
	project, err := ParseProject(data)
	if err != nil {
		return Project{}, fmt.Errorf("parse project file %q: %w", path, err)
	}
	return project, nil
}

// Validate checks the project fields defined by the project schema.
func (project Project) Validate() error {
	if project.ProjectName == "" {
		return fmt.Errorf("projectName must not be empty")
	}
	switch project.Target.Arch {
	case "x86_64", "arm64", "armv7l":
	default:
		return fmt.Errorf("unsupported target.arch %q", project.Target.Arch)
	}
	if project.Target.CycleTimeMs < 1 || project.Target.CycleTimeMs > 1000 {
		return fmt.Errorf("target.cycleTimeMs must be between 1 and 1000")
	}

	blockIDs := make(map[int]struct{}, len(project.DataBlocks))
	blockNames := make(map[string]struct{}, len(project.DataBlocks))
	for i, block := range project.DataBlocks {
		if block.ID < 1 {
			return fmt.Errorf("datablocks[%d].id must be at least 1", i)
		}
		if _, exists := blockIDs[block.ID]; exists {
			return fmt.Errorf("datablocks[%d].id %d is duplicated", i, block.ID)
		}
		blockIDs[block.ID] = struct{}{}
		if !identifierPattern.MatchString(block.Name) {
			return fmt.Errorf("datablocks[%d].name %q is not a valid identifier", i, block.Name)
		}
		if _, exists := blockNames[block.Name]; exists {
			return fmt.Errorf("datablocks[%d].name %q is duplicated", i, block.Name)
		}
		blockNames[block.Name] = struct{}{}
		if block.Type != "global" && block.Type != "instance" {
			return fmt.Errorf("datablocks[%d].type %q is invalid", i, block.Type)
		}
		if block.Variables == nil {
			return fmt.Errorf("datablocks[%d].variables must be an array", i)
		}

		variableNames := make(map[string]struct{}, len(block.Variables))
		for j, variable := range block.Variables {
			if !identifierPattern.MatchString(variable.Name) {
				return fmt.Errorf("datablocks[%d].variables[%d].name %q is not a valid identifier", i, j, variable.Name)
			}
			if _, exists := variableNames[variable.Name]; exists {
				return fmt.Errorf("datablocks[%d].variables[%d].name %q is duplicated", i, j, variable.Name)
			}
			variableNames[variable.Name] = struct{}{}
			switch variable.Type {
			case "BOOL", "INT", "DINT", "REAL", "TIME", "WORD":
			default:
				return fmt.Errorf("datablocks[%d].variables[%d].type %q is invalid", i, j, variable.Type)
			}
		}
	}

	if project.Programs == nil {
		return fmt.Errorf("programs must be an array")
	}
	for i, program := range project.Programs {
		if !identifierPattern.MatchString(program.Name) {
			return fmt.Errorf("programs[%d].name %q is not a valid identifier", i, program.Name)
		}
		if program.Language != "ST" && program.Language != "FBD" {
			return fmt.Errorf("programs[%d].language %q is invalid", i, program.Language)
		}
	}
	return nil
}

func validateRequiredFields(data json.RawMessage, required ...string) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return fmt.Errorf("expected an object: %w", err)
	}
	for _, field := range required {
		if _, exists := fields[field]; !exists {
			return fmt.Errorf("required field %q is missing", field)
		}
	}
	return nil
}

func decodeRawArray(data json.RawMessage) ([]json.RawMessage, error) {
	var values []json.RawMessage
	if err := json.Unmarshal(data, &values); err != nil {
		return nil, err
	}
	return values, nil
}
