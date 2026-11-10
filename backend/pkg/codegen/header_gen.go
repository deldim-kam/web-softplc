package codegen

import (
"fmt"
"strings"
"web-softplc/backend/pkg/model"
)

// Преобразование типов МЭК 61131-3 в типы языка C
func mapIecTypeToC(iecType string) (string, error) {
switch strings.ToUpper(iecType) {
case "BOOL":
return "bool", nil
case "INT":
return "int16_t", nil
case "DINT":
return "int32_t", nil
case "REAL":
return "float", nil
case "TIME", "UDINT":
return "uint32_t", nil
case "WORD":
return "uint16_t", nil
default:
return "", fmt.Errorf("неизвестный тип данных МЭК: %s", iecType)
}
}

// GenerateHeader формирует текст заголовочного файла с объявлениями DB
func GenerateHeader(dbs []model.DataBlock) (string, error) {
var sb strings.Builder

sb.WriteString("// Сгенерировано автоматически компилятором Web-SoftPLC. Не редактировать вручную!\n")
sb.WriteString("#ifndef GENERATED_DB_H\n#define GENERATED_DB_H\n\n")
sb.WriteString("#include <stdint.h>\n#include <stdbool.h>\n\n")
sb.WriteString("#pragma pack(push, 1)\n\n")

for _, db := range dbs {
sb.WriteString(fmt.Sprintf("// Блок данных DB%d: %s\n", db.ID, db.Name))
sb.WriteString(fmt.Sprintf("typedef struct {\n"))

for _, v := range db.Variables {
cType, err := mapIecTypeToC(v.Type)
if err != nil {
return "", err
}
comment := ""
if v.Comment != "" {
comment = fmt.Sprintf(" // %s", v.Comment)
}
sb.WriteString(fmt.Sprintf("    %s %s;%s\n", cType, v.Name, comment))
}

sb.WriteString(fmt.Sprintf("} DB%d_%s_t;\n\n", db.ID, db.Name))
}

sb.WriteString("#pragma pack(pop)\n\n#endif // GENERATED_DB_H\n")
return sb.String(), nil
}
