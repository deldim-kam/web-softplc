#include "plc_runtime.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

#define SHM_PREFIX "/softplc_db"

static PlcDataBlock g_blocks[MAX_DATA_BLOCKS];
static int g_shm_fds[MAX_DATA_BLOCKS];
static size_t g_blocks_count = 0;

void db_registry_init(void) {
    memset(g_blocks, 0, sizeof(g_blocks));
    memset(g_shm_fds, -1, sizeof(g_shm_fds));
    g_blocks_count = 0;
}

bool db_register(uint16_t id, size_t size_bytes) {
    if (g_blocks_count >= MAX_DATA_BLOCKS) {
        fprintf(stderr, "[DB] Ошибка: лимит блоков данных (%d)\n", MAX_DATA_BLOCKS);
        return false;
    }

    char shm_name[64];
    snprintf(shm_name, sizeof(shm_name), "%s%u_shm", SHM_PREFIX, id);

    // Создаем регион разделяемой памяти
    int fd = shm_open(shm_name, O_CREAT | O_RDWR, 0666);
    if (fd == -1) {
        perror("[DB] Ошибка shm_open");
        return false;
    }

    // Задаем размер региона памяти
    if (ftruncate(fd, size_bytes) == -1) {
        perror("[DB] Ошибка ftruncate");
        close(fd);
        return false;
    }

    // Отображаем разделяемую память в адресное пространство процесса ядра
    void *mem = mmap(NULL, size_bytes, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (mem == MAP_FAILED) {
        perror("[DB] Ошибка mmap");
        close(fd);
        return false;
    }

    memset(mem, 0, size_bytes);

    g_blocks[g_blocks_count].id = id;
    g_blocks[g_blocks_count].ptr = mem;
    g_blocks[g_blocks_count].size_bytes = size_bytes;
    g_shm_fds[g_blocks_count] = fd;
    g_blocks_count++;

    printf("[DB] DB%u зарегистрирован в SHM: %s (%zu байт)\n", id, shm_name, size_bytes);
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
        if (g_blocks[i].ptr && g_blocks[i].ptr != MAP_FAILED) {
            munmap(g_blocks[i].ptr, g_blocks[i].size_bytes);
            g_blocks[i].ptr = NULL;
        }
        if (g_shm_fds[i] != -1) {
            close(g_shm_fds[i]);
            char shm_name[64];
            snprintf(shm_name, sizeof(shm_name), "%s%u_shm", SHM_PREFIX, g_blocks[i].id);
            shm_unlink(shm_name);
        }
    }
    g_blocks_count = 0;
    printf("[DB] Разделяемая память DB освобождена и разлинкована.\n");
}
