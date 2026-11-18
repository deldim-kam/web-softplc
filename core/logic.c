#include <stdint.h>
#include <stdbool.h>
#include <math.h>
#include <stdio.h>
#include "plc_abi.h"

const uint32_t PLC_LOGIC_ABI_VERSION = PLC_ABI_VERSION;

static bool    __ld_edge[256]    = {0};
static int32_t __ld_timer[256]   = {0};
static int32_t __ld_counter[256] = {0};

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
    // >>> INLINE EXPAND [FC: FC1_SpeedLimiter (ST)] >>>
    {
#line 1 "FC1_SpeedLimiter"
// FC1: Ограничение максимальной скорости
#line 2 "FC1_SpeedLimiter"
if (db1->Target_Speed > 3000.0) {
#line 3 "FC1_SpeedLimiter"
    db1->Target_Speed = 3000.0;
#line 4 "FC1_SpeedLimiter"
}
    }
    // <<< END INLINE [FC1_SpeedLimiter] <<<
#line 5 "OB1_Main"
    // >>> INLINE EXPAND [FC: FC2_LadderSafety (LD)] >>>
    {
    // === BEGIN LADDER BLOCK [FC2_LadderSafety] ===
    // Network 1: Цепь 1: Контроль предельной уставки и выставление кода 101
    {
        bool rung_flow = true;
        rung_flow = rung_flow && ((db1->Line_Enable != 0));
        if (ctx->rlo_status) ctx->rlo_status[1] = rung_flow ? 1 : 0;
        rung_flow = rung_flow && (((float)(db1->Target_Speed) >= (float)(2000.0)));
        if (ctx->rlo_status) ctx->rlo_status[2] = rung_flow ? 1 : 0;
        if (rung_flow) { db1->Error_Code = (100) + (1); }
        if (ctx->rlo_status) ctx->rlo_status[3] = rung_flow ? 1 : 0;
    }
    // Network 2: Цепь 2: Сброс кода аварии при штатном останове линии
    {
        bool rung_flow = true;
        rung_flow = rung_flow && (!(db1->Line_Enable != 0));
        if (ctx->rlo_status) ctx->rlo_status[17] = rung_flow ? 1 : 0;
        if (rung_flow) { db1->Error_Code = (0) - (0); }
        if (ctx->rlo_status) ctx->rlo_status[18] = rung_flow ? 1 : 0;
    }
    // === END LADDER BLOCK ===

    }
    // <<< END INLINE [FC2_LadderSafety] <<<
#line 6 "OB1_Main"
} else {
#line 7 "OB1_Main"
    db1->Target_Speed = 0.0;
#line 8 "OB1_Main"
}
}
