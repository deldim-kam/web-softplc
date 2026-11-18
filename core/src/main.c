#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <string.h>
#include <time.h>
#include <errno.h>
#include <signal.h>
#include <unistd.h>
#include <sched.h>
#include <fcntl.h>
#include <sys/mman.h>

#include "plc_abi.h"
#include "plc_runtime.h"

#define CYCLE_PERIOD_NS 10000000L // 10 ms (100 Hz)
#define NSEC_PER_SEC    1000000000L
#define SYS_SHM_NAME    "/softplc_sys_shm"

static volatile sig_atomic_t g_running = 1;
static volatile sig_atomic_t g_reload_requested = 0;

extern bool logic_load_module(const char *so_path);
extern PlcLogicStepFn logic_get_step_fn(void);
extern void logic_unload(void);

static void sig_handler(int sig) {
    if (sig == SIGINT || sig == SIGTERM) {
        g_running = 0;
    } else if (sig == SIGUSR1) {
        g_reload_requested = 1;
    }
}

static inline int64_t timespec_diff_ns(struct timespec a, struct timespec b) {
    return ((int64_t)a.tv_sec - (int64_t)b.tv_sec) * NSEC_PER_SEC + ((int64_t)a.tv_nsec - (int64_t)b.tv_nsec);
}

static inline void timespec_add_ns(struct timespec *t, long ns) {
    t->tv_nsec += ns;
    while (t->tv_nsec >= NSEC_PER_SEC) {
        t->tv_nsec -= NSEC_PER_SEC;
        t->tv_sec++;
    }
}

static void apply_shm_forces(PlcSysShm *sys_shm) {
    if (!sys_shm) return;
    for (int i = 0; i < MAX_FORCE_ENTRIES; i++) {
        if (sys_shm->forces[i].active) {
            PlcDataBlock *blk = db_get(sys_shm->forces[i].db_id);
            if (blk && blk->ptr) {
                uint16_t off = sys_shm->forces[i].offset;
                uint8_t sz = sys_shm->forces[i].size;
                if ((size_t)(off + sz) <= blk->size_bytes && sz <= 8) {
                    memcpy((uint8_t *)blk->ptr + off, sys_shm->forces[i].raw, sz);
                }
            }
        }
    }
}

int main(int argc, char *argv[]) {
    const char *logic_path = (argc > 1) ? argv[1] : "./logic.so";

    signal(SIGINT, sig_handler);
    signal(SIGTERM, sig_handler);
    signal(SIGUSR1, sig_handler);

    mlockall(MCL_CURRENT | MCL_FUTURE);

    FILE *pid_file = fopen("softplc.pid", "w");
    if (pid_file) {
        fprintf(pid_file, "%d\n", getpid());
        fclose(pid_file);
    }

    // Инициализация системного SHM для телеметрии, RLO и таблицы Force
    int sys_fd = shm_open(SYS_SHM_NAME, O_CREAT | O_RDWR, 0666);
    if (sys_fd == -1 || ftruncate(sys_fd, sizeof(PlcSysShm)) == -1) {
        perror("[PLC] Ошибка создания softplc_sys_shm");
        return 1;
    }
    PlcSysShm *sys_shm = (PlcSysShm *)mmap(NULL, sizeof(PlcSysShm), PROT_READ | PROT_WRITE, MAP_SHARED, sys_fd, 0);
    memset(sys_shm, 0, sizeof(PlcSysShm));
    sys_shm->core_running = 1;

    db_registry_init();
    // Регистрируем пул блоков данных DB1..DB8 по 256 байт для динамических переменных
    for (uint16_t id = 1; id <= 8; id++) {
        db_register(id, 256);
    }

    if (!logic_load_module(logic_path)) {
        fprintf(stderr, "[PLC] Предупреждение: стартовый модуль %s не загружен, ожидание сборки...\n", logic_path);
    }

    PlcContext ctx;
    ctx.cycle_tick = 0;
    ctx.get_db = db_get;
    ctx.rlo_status = sys_shm->rlo_status;

    struct timespec next_cycle, t_start, t_end;
    clock_gettime(CLOCK_MONOTONIC, &next_cycle);

    printf("[PLC] RT-ядро запущено (PID: %d). Цикл: 10 мс.\n", getpid());

    while (g_running) {
        timespec_add_ns(&next_cycle, CYCLE_PERIOD_NS);

        clock_gettime(CLOCK_MONOTONIC, &t_start);
        int32_t jitter_us = (int32_t)(timespec_diff_ns(t_start, next_cycle) / 1000);
        if (jitter_us < 0) jitter_us = -jitter_us;

        if (g_reload_requested) {
            g_reload_requested = 0;
            printf("[PLC] SIGUSR1: Горячая замена модуля логики...\n");
            logic_load_module(logic_path);
        }

        // 1. Pre-Scan Force (накладываем форсированные входы прямо из SHM)
        apply_shm_forces(sys_shm);

        // 2. Выполнение цикла OB1 + инлайн FC/FB
        PlcLogicStepFn step = logic_get_step_fn();
        if (step) {
            step(&ctx);
        }

        // 3. Post-Scan Force (гарантированное удержание форсированных выходов)
        apply_shm_forces(sys_shm);

        clock_gettime(CLOCK_MONOTONIC, &t_end);
        uint32_t scan_us = (uint32_t)(timespec_diff_ns(t_end, t_start) / 1000);
        if (scan_us == 0) scan_us = 1;

        ctx.cycle_tick++;
        sys_shm->cycle_tick = ctx.cycle_tick;
        sys_shm->timestamp_ns = (uint64_t)t_end.tv_sec * NSEC_PER_SEC + (uint64_t)t_end.tv_nsec;
        sys_shm->scan_time_us = scan_us;
        sys_shm->jitter_us = jitter_us;
        if (jitter_us > sys_shm->max_jitter_us) {
            sys_shm->max_jitter_us = jitter_us;
        }

        int res = clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next_cycle, NULL);
        if (res != 0 && res != EINTR) {
            clock_gettime(CLOCK_MONOTONIC, &next_cycle);
        }
    }

    sys_shm->core_running = 0;
    munmap(sys_shm, sizeof(PlcSysShm));
    close(sys_fd);
    unlink("softplc.pid");
    logic_unload();
    db_registry_cleanup();
    return 0;
}
