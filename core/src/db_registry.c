#include "plc_runtime.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

static PlcDataBlock g_blocks[MAX_DATA_BLOCKS];
static size_t g_blocks_count = 0;

void db_registry_init(void) {
    memset(g_blocks, 0, sizeof(g_blocks));
    g_blocks_count = 0;
}

bool db_register(uint16_t id, size_t size_bytes) {
    if (g_blocks_count >= MAX_DATA_BLOCKS) {
        fprintf(stderr, "[DB] Ошибка: лимит блоков данных (%d)\n", MAX_DATA_BLOCKS);
        return false;
    }
    for (size_t i = 0; i < g_blocks_count; i++) {
        if (g_blocks[i].id == id) {
            fprintf(stderr, "[DB] Ошибка: DB %u уже зарегистрирован\n", id);
            return false;
        }
    }
    void *mem = calloc(1, size_bytes);
    if (!mem) {
        perror("[DB] Ошибка выделения памяти");
        return false;
    }
    g_blocks[g_blocks_count].id = id;
    g_blocks[g_blocks_count].ptr = mem;
    g_blocks[g_blocks_count].size_bytes = size_bytes;
    g_blocks_count++;

    printf("[DB] Зарегистрирован DB%u (размер: %zu байт)\n", id, size_bytes);
    return true;
}

PlcDataBlock *db_get(uint16_t id) {
    for (size_t i = 0; i < g_blocks_count; i++) {
        if (g_blocks[i].id == id) {
            return &g_blocks[i];
        }
    }
    return NULL;
}

void db_registry_cleanup(void) {
    for (size_t i = 0; i < g_blocks_count; i++) {
        if (g_blocks[i].ptr) {
            free(g_blocks[i].ptr);
            g_blocks[i].ptr = NULL;
        }
    }
    g_blocks_count = 0;
    printf("[DB] Память блоков данных освобождена.\n");
}
