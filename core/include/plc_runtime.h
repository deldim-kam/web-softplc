#ifndef PLC_RUNTIME_H
#define PLC_RUNTIME_H

#include "plc_abi.h"

#define MAX_DATA_BLOCKS 64

void db_registry_init(void);
bool db_register(uint16_t id, size_t size_bytes);
PlcDataBlock *db_get(uint16_t id);
void db_registry_cleanup(void);

#endif // PLC_RUNTIME_H
