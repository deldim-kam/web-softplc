#ifndef PLC_ABI_H
#define PLC_ABI_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#define PLC_ABI_VERSION 2
#define MAX_FORCE_ENTRIES 64
#define MAX_RLO_NODES 256

typedef struct {
    uint16_t id;
    void    *ptr;
    size_t   size_bytes;
} PlcDataBlock;

typedef struct __attribute__((packed)) {
    uint8_t  active;
    uint16_t db_id;
    uint16_t offset;
    uint8_t  size;
    uint8_t  raw[8];
} PlcForceItem;

typedef struct __attribute__((packed)) {
    uint64_t     cycle_tick;
    uint64_t     timestamp_ns;
    uint32_t     scan_time_us;
    int32_t      jitter_us;
    int32_t      max_jitter_us;
    uint8_t      core_running;
    uint8_t      rlo_status[MAX_RLO_NODES];
    uint32_t     force_count;
    PlcForceItem forces[MAX_FORCE_ENTRIES];
} PlcSysShm;

typedef struct {
    uint32_t      cycle_tick;
    PlcDataBlock *(*get_db)(uint16_t db_id);
    uint8_t      *rlo_status;
} PlcContext;

typedef void (*PlcLogicStepFn)(PlcContext *ctx);

#endif // PLC_ABI_H
