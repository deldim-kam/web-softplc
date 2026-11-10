#ifndef PLC_ABI_H
#define PLC_ABI_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#define PLC_ABI_VERSION 1

typedef struct {
    uint16_t id;
    void    *ptr;
    size_t   size_bytes;
} PlcDataBlock;

typedef struct {
    uint32_t cycle_tick;
    PlcDataBlock *(*get_db)(uint16_t db_id);
} PlcContext;

typedef void (*PlcLogicStepFn)(PlcContext *ctx);

#endif // PLC_ABI_H
