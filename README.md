# Web-SoftPLC

[![Go](https://img.shields.io/badge/Go-1.20%2B-00ADD8.svg)](#implemented-features)
[![IEC 61131-3](https://img.shields.io/badge/Standard-IEC%2061131--3-orange.svg)](#project-format)

[English](#english) | [Русский](#russian)

---

<a id="english"></a>
## English

Web-SoftPLC is an open-source project for a web-based SoftPLC engineering environment. The repository currently provides a JSON project contract, a Go parser and validator, and a C99 data-block header generator. The web frontend, server API, and real-time runtime are not yet present.

### Implemented Features

- Parse and validate project JSON against the supported project fields and value constraints.
- Read project files using `ParseProjectFile`.
- Generate and write C99 headers for data blocks, including validated initializers and `RETAIN` annotations.
- Run the Go test suite with `go test ./...`.

### Project Format

- [JSON Schema](contracts/project.schema.json)
- [Sample project](contracts/sample_project.json)

The current contract supports `x86_64`, `arm64`, and `armv7l` targets; `global` and `instance` data blocks; `BOOL`, `INT`, `DINT`, `REAL`, `TIME`, and `WORD` variables; and `ST` and `FBD` program language labels.

### Repository Structure

```text
.
├── contracts/
│   ├── project.schema.json
│   └── sample_project.json
├── datablocks_header.go
├── project.go
├── project_test.go
└── go.mod
```

### Roadmap

- [x] Define the project JSON schema and sample.
- [x] Implement project parsing, validation, and data-block header generation.
- [ ] Add the Structured Text compiler and toolchain integration.
- [ ] Build the real-time C runtime and hot-reload support.
- [ ] Add the backend API and online diagnostics.
- [ ] Develop the web-based editors and target deployment tools.

---

<a id="russian"></a>
## Русский

Web-SoftPLC — открытый проект веб-среды для разработки SoftPLC. Сейчас в репозитории есть JSON-контракт проекта, парсер и валидатор на Go, а также генератор заголовочных файлов C99 для блоков данных. Веб-интерфейс, серверный API и система исполнения реального времени пока не реализованы.

### Реализованные возможности

- Разбор и проверка JSON-проектов по поддерживаемым полям и ограничениям значений.
- Чтение файлов проекта через `ParseProjectFile`.
- Генерация и запись заголовочных файлов C99 для блоков данных с проверкой начальных значений и пометок `RETAIN`.
- Запуск тестов Go командой `go test ./...`.

### Формат проекта

- [JSON-схема](contracts/project.schema.json)
- [Пример проекта](contracts/sample_project.json)

Контракт поддерживает цели `x86_64`, `arm64` и `armv7l`; блоки данных `global` и `instance`; типы переменных `BOOL`, `INT`, `DINT`, `REAL`, `TIME` и `WORD`; метки языков программ `ST` и `FBD`.

### Структура репозитория

```text
.
├── contracts/
│   ├── project.schema.json
│   └── sample_project.json
├── datablocks_header.go
├── project.go
├── project_test.go
└── go.mod
```

### План разработки

- [x] Определить JSON-схему проекта и подготовить пример.
- [x] Реализовать разбор и проверку проекта, генерацию заголовков блоков данных.
- [ ] Добавить компилятор Structured Text и интеграцию с инструментарием сборки.
- [ ] Создать ядро реального времени на C и поддержку горячей замены логики.
- [ ] Добавить серверный API и диагностику в реальном времени.
- [ ] Разработать веб-редакторы и инструменты развертывания на целевых устройствах.
