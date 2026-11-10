#include "plc_abi.h"
#include <stdio.h>
#include <stdlib.h>
#include <dlfcn.h>
#include <stdatomic.h>

static _Atomic(PlcLogicStepFn) g_active_step_fn = NULL;
static void *g_current_handle = NULL;

bool logic_load_module(const char *so_path) {
    printf("[Loader] Загрузка модуля логики: %s\n", so_path);

    void *new_handle = dlopen(so_path, RTLD_NOW);
    if (!new_handle) {
        fprintf(stderr, "[Loader] Ошибка dlopen: %s\n", dlerror());
        return false;
    }

    uint32_t *version = (uint32_t *)dlsym(new_handle, "PLC_LOGIC_ABI_VERSION");
    if (!version || *version != PLC_ABI_VERSION) {
        fprintf(stderr, "[Loader] Ошибка: несовместимая версия ABI!\n");
        dlclose(new_handle);
        return false;
    }

    PlcLogicStepFn new_step = (PlcLogicStepFn)dlsym(new_handle, "plc_logic_step");
    if (!new_step) {
        fprintf(stderr, "[Loader] Символ 'plc_logic_step' не найден: %s\n", dlerror());
        dlclose(new_handle);
        return false;
    }

    void *old_handle = g_current_handle;
    atomic_store(&g_active_step_fn, new_step);
    g_current_handle = new_handle;

    if (old_handle) {
        dlclose(old_handle);
        printf("[Loader] Предыдущая версия выгружена.\n");
    }

    printf("[Loader] Логика успешно обновлена на лету!\n");
    return true;
}

PlcLogicStepFn logic_get_step_fn(void) {
    return atomic_load(&g_active_step_fn);
}

void logic_unload(void) {
    atomic_store(&g_active_step_fn, NULL);
    if (g_current_handle) {
        dlclose(g_current_handle);
        g_current_handle = NULL;
    }
}
