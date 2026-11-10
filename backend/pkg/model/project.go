package model

type TargetConfig struct {
Arch        string `json:"arch"`
CycleTimeMs int    `json:"cycleTimeMs"`
}

type Variable struct {
Name      string `json:"name"`
Type      string `json:"type"`
InitValue string `json:"initValue"`
Retain    bool   `json:"retain"`
Comment   string `json:"comment,omitempty"`
}

type DataBlock struct {
ID        uint16     `json:"id"`
Name      string     `json:"name"`
Type      string     `json:"type"` // "global" | "instance"
Variables []Variable `json:"variables"`
}

type Program struct {
Name     string `json:"name"`
Language string `json:"language"` // "ST"
Code     string `json:"code"`
}

type Project struct {
ProjectName string       `json:"projectName"`
Version     string       `json:"version"`
Target      TargetConfig `json:"target"`
DataBlocks  []DataBlock  `json:"datablocks"`
Programs    []Program    `json:"programs"`
}
