package main

import (
"encoding/json"
"flag"
"fmt"
"log"
"os"
"path/filepath"
"web-softplc/backend/pkg/builder"
"web-softplc/backend/pkg/codegen"
"web-softplc/backend/pkg/model"
)

func main() {
projectFile := flag.String("project", "../contracts/sample_project.json", "Путь к файлу проекта JSON")
includeDir := flag.String("include", "../core/include", "Путь к заголовочным файлам ядра")
outputDir := flag.String("out", "../core", "Папка для сохранения logic.so")
flag.Parse()

log.Printf("[Compiler] Чтение проекта: %s", *projectFile)
data, err := os.ReadFile(*projectFile)
if err != nil {
log.Fatalf("Ошибка чтения файла: %v", err)
}

var proj model.Project
if err := json.Unmarshal(data, &proj); err != nil {
log.Fatalf("Ошибка парсинга JSON: %v", err)
}

log.Printf("[Compiler] Генерация C-структур для %d блоков данных...", len(proj.DataBlocks))
headerCode, err := codegen.GenerateHeader(proj.DataBlocks)
if err != nil {
log.Fatalf("Ошибка кодогенерации заголовков: %v", err)
}

log.Printf("[Compiler] Трансляция программного кода ST в C...")
logicCode, err := codegen.GenerateLogicSource(&proj)
if err != nil {
log.Fatalf("Ошибка трансляции логики: %v", err)
}

absInclude, _ := filepath.Abs(*includeDir)
absOutput, _ := filepath.Abs(*outputDir)

log.Printf("[Compiler] Запуск компилятора GCC...")
soFile, err := builder.CompileSharedLib(headerCode, logicCode, builder.BuildConfig{
IncludeDir: absInclude,
OutputDir:  absOutput,
})
if err != nil {
log.Fatalf("Сборка завершилась ошибкой: %v", err)
}

fmt.Println("-------------------------------------------------------")
log.Printf("[УСПЕХ] Библиотека логики успешно скомпилирована:")
log.Printf("-> %s", soFile)
fmt.Println("-------------------------------------------------------")
}
