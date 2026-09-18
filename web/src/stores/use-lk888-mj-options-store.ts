import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { defaultLk888MjOptions, type Lk888MjOptions } from "@/lib/lk888-mj-options";
import { scopedLocalStorage } from "@/lib/user-scope";

const botTypes = new Set(["MID_JOURNEY", "NIJI_JOURNEY"]);
const qualities = new Set(["", "0.25", "0.5", "1", "2"]);
const stylizes = new Set(["", "0", "50", "100", "250", "500", "750", "1000"]);
const chaoses = new Set(["", "0", "25", "50", "75", "100"]);
const styles = new Set(["", "raw"]);

function pick<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
    const next = String(value ?? "").trim();
    return (allowed.has(next) ? next : fallback) as T;
}

export function normalizeLk888MjOptions(value: unknown): Lk888MjOptions {
    const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    return {
        botType: pick(raw.botType, botTypes, defaultLk888MjOptions.botType),
        quality: pick(raw.quality, qualities, defaultLk888MjOptions.quality),
        stylize: pick(raw.stylize, stylizes, defaultLk888MjOptions.stylize),
        chaos: pick(raw.chaos, chaoses, defaultLk888MjOptions.chaos),
        style: pick(raw.style, styles, defaultLk888MjOptions.style),
    };
}

type Lk888MjOptionsStore = {
    options: Lk888MjOptions;
    updateOptions: (patch: Partial<Lk888MjOptions>) => void;
};

export const LK888_MJ_OPTIONS_STORE_KEY = "open_ai_canvas:lk888_mj_options";

export const useLk888MjOptionsStore = create<Lk888MjOptionsStore>()(
    persist(
        (set) => ({
            options: defaultLk888MjOptions,
            updateOptions: (patch) => set((state) => ({ options: normalizeLk888MjOptions({ ...state.options, ...patch }) })),
        }),
        {
            name: LK888_MJ_OPTIONS_STORE_KEY,
            storage: createJSONStorage(() => scopedLocalStorage),
            partialize: (state) => ({ options: state.options }),
            merge: (persisted, current) => {
                const stored = (persisted || {}) as Partial<Lk888MjOptionsStore>;
                return { ...current, options: normalizeLk888MjOptions(stored.options) };
            },
        },
    ),
);
