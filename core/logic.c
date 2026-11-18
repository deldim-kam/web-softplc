#include <stdint.h>
#include <stdbool.h>
#include <math.h>
#include <stdio.h>
#include "plc_abi.h"

const uint32_t PLC_LOGIC_ABI_VERSION = PLC_ABI_VERSION;

static bool    __ld_edge[512]    = {0};
static int32_t __ld_timer[512]   = {0};
static int32_t __ld_counter[512] = {0};

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

    // --- MONOLITHIC PLC SCAN CYCLE ---
#line 1 "OB1_Main"
// OB1: Главный циклический блок управления (10 мс)
#line 2 "OB1_Main"
if (db1->Line_Enable) {
#line 3 "OB1_Main"
    db1->Target_Speed = 3500.0;
#line 4 "OB1_Main"
    // Вызов функции FC1 для ограничения предельной скорости
#line 5 "OB1_Main"
    // >>> INLINE EXPAND [FC: FC1_SpeedLimiter (ST)] >>>
    {
#line 1 "FC1_SpeedLimiter"
// FC1: Функция защиты по превышению скорости
#line 2 "FC1_SpeedLimiter"
if (db1->Target_Speed > 3000.0) {
#line 3 "FC1_SpeedLimiter"
    db1->Target_Speed = 3000.0;
#line 4 "FC1_SpeedLimiter"
    db1->Error_Code = 101;
#line 5 "FC1_SpeedLimiter"
}
    }
    // <<< END INLINE [FC1_SpeedLimiter] <<<
#line 6 "OB1_Main"
} else {
#line 7 "OB1_Main"
    db1->Target_Speed = 0.0;
#line 8 "OB1_Main"
}
}
