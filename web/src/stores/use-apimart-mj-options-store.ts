import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { defaultApimartMjOptions, normalizeApimartMjOptions, type ApimartMjOptions } from "@/lib/apimart-mj-options";
import { scopedLocalStorage } from "@/lib/user-scope";

type ApimartMjOptionsStore = {
    options: ApimartMjOptions;
    updateOptions: (patch: Partial<ApimartMjOptions>) => void;
};

export const APIMART_MJ_OPTIONS_STORE_KEY = "open_ai_canvas:apimart_mj_options";

export const useApimartMjOptionsStore = create<ApimartMjOptionsStore>()(
    persist(
        (set) => ({
            options: defaultApimartMjOptions,
            updateOptions: (patch) => set((state) => ({ options: normalizeApimartMjOptions({ ...state.options, ...patch }) })),
        }),
        {
            name: APIMART_MJ_OPTIONS_STORE_KEY,
            storage: createJSONStorage(() => scopedLocalStorage),
            partialize: (state) => ({ options: state.options }),
            merge: (persisted, current) => {
                const stored = (persisted || {}) as Partial<ApimartMjOptionsStore>;
                return { ...current, options: normalizeApimartMjOptions(stored.options) };
            },
        },
    ),
);
