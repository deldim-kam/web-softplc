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
#include <sys/mman.h>

#include "plc_abi.h"
#include "plc_runtime.h"

#define CYCLE_PERIOD_NS 10000000L // 10 мс (100 Гц)
#define NSEC_PER_SEC    1000000000L

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

static inline void timespec_add_ns(struct timespec *t, long ns) {
    t->tv_nsec += ns;
    while (t->tv_nsec >= NSEC_PER_SEC) {
        t->tv_nsec -= NSEC_PER_SEC;
        t->tv_sec++;
    }
}

int main(int argc, char *argv[]) {
    const char *logic_path = (argc > 1) ? argv[1] : "./logic.so";

    signal(SIGINT, sig_handler);
    signal(SIGTERM, sig_handler);
    signal(SIGUSR1, sig_handler);

    mlockall(MCL_CURRENT | MCL_FUTURE);

    struct sched_param sp;
    sp.sched_priority = 50;
    if (sched_setscheduler(0, SCHED_FIFO, &sp) == 0) {
        printf("[RT] Планировщик SCHED_FIFO активен\n");
    } else {
        printf("[RT] Стандартный планировщик (без root прав)\n");
    }

    db_registry_init();
    db_register(1, 16); // DB1 из sample_project.json (16 байт)

    if (!logic_load_module(logic_path)) {
        fprintf(stderr, "[PLC] Не удалось загрузить начальный модуль: %s\n", logic_path);
        return 1;
    }

    PlcContext ctx;
    ctx.cycle_tick = 0;
    ctx.get_db = db_get;

    struct timespec next_cycle;
    clock_gettime(CLOCK_MONOTONIC, &next_cycle);

    printf("[PLC] Ядро запущено (PID: %d). Цикл: 10 мс. Ожидание сигналов...\n", getpid());

    while (g_running) {
        timespec_add_ns(&next_cycle, CYCLE_PERIOD_NS);

        if (g_reload_requested) {
            g_reload_requested = 0;
            printf("\n[PLC] Получен сигнал SIGUSR1: Hot Reload...\n");
            logic_load_module(logic_path);
        }

        PlcLogicStepFn step = logic_get_step_fn();
        if (step) {
            step(&ctx);
        }

        ctx.cycle_tick++;

        int res = clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next_cycle, NULL);
        if (res != 0 && res != EINTR) {
            clock_gettime(CLOCK_MONOTONIC, &next_cycle);
        }
    }

    printf("\n[PLC] Остановка ядра...\n");
    logic_unload();
    db_registry_cleanup();
    return 0;
}
