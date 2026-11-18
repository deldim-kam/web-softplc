#include <stdint.h>
#include <stdbool.h>
#include <math.h>
#include <stdio.h>
#include "plc_abi.h"

const uint32_t PLC_LOGIC_ABI_VERSION = PLC_ABI_VERSION;

// --- DB1: Line_Params ---
typedef struct __attribute__((packed)) {
    float Target_Speed;
    uint8_t Line_Enable;
    int16_t Error_Code;
} DB1_t;

static bool g_db_initialized = false;

void plc_logic_step(PlcContext *ctx) {
    if (!ctx || !ctx->get_db) return;

    PlcDataBlock *raw_db1 = ctx->get_db(1);
    if (!raw_db1 || !raw_db1->ptr) return;
    DB1_t *db1 = (DB1_t *)raw_db1->ptr;

    if (!g_db_initialized) {
        db1->Target_Speed = 1500.0;
        db1->Line_Enable = 1;
        db1->Error_Code = 0;
        g_db_initialized = true;
    }

    // --- PRE-SCAN FORCE OVERRIDE ---
    db1->Target_Speed = 4000; // [FORCED INPUT]

    // --- MONOLITHIC PLC SCAN CYCLE (OB1 + INLINED FC/FB) ---
// OB1: Главный циклический блок управления (10 мс)
if (db1->Line_Enable) {
    db1->Target_Speed = 3500.0;
    // Вызов функции FC1 для ограничения предельной скорости
    // >>> INLINE EXPAND [FC: FC1_SpeedLimiter] >>>
    {
        // FC1: Функция защиты по превышению скорости
        if (db1->Target_Speed > 3000.0) {
            db1->Target_Speed = 3000.0;
            db1->Error_Code = 101;
        }
    }
    // <<< END INLINE [FC1_SpeedLimiter] <<<
} else {
    db1->Target_Speed = 0.0;
}
}
