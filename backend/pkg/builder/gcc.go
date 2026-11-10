package builder

import (
"fmt"
"os"
"os/exec"
"path/filepath"
)

type BuildConfig struct {
IncludeDir string
OutputDir  string
}

func CompileSharedLib(headerCode, logicCode string, cfg BuildConfig) (string, error) {
tmpDir, err := os.MkdirTemp("", "softplc_build_*")
if err != nil {
return "", fmt.Errorf("ошибка создания temp-директории: %w", err)
}
defer os.RemoveAll(tmpDir)

headerPath := filepath.Join(tmpDir, "generated_db.h")
if err := os.WriteFile(headerPath, []byte(headerCode), 0644); err != nil {
return "", err
}

logicPath := filepath.Join(tmpDir, "generated_logic.c")
if err := os.WriteFile(logicPath, []byte(logicCode), 0644); err != nil {
return "", err
}

outPath := filepath.Join(cfg.OutputDir, "logic.so")

cmd := exec.Command("gcc",
"-O2",
"-shared",
"-fPIC",
"-I", cfg.IncludeDir,
"-I", tmpDir,
logicPath,
"-o", outPath,
)

out, err := cmd.CombinedOutput()
if err != nil {
return "", fmt.Errorf("ошибка компиляции GCC:\n%s\n%w", string(out), err)
}

return outPath, nil
}
