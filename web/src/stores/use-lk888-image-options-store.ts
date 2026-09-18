import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { defaultLk888Image25Options, type Lk888Image25Options } from "@/lib/lk888-image-options";
import { scopedLocalStorage } from "@/lib/user-scope";

const versions = new Set(["flare", "sunburst"]);
const qualities = new Set(["", "auto", "low", "medium", "high", "xhigh", "max"]);
const backgrounds = new Set(["", "opaque", "transparent", "auto"]);

function pick<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
    const next = String(value ?? "").trim();
    return (allowed.has(next) ? next : fallback) as T;
}

export function normalizeLk888Image25Options(value: unknown): Lk888Image25Options {
    const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    return {
        version: pick(raw.version, versions, defaultLk888Image25Options.version),
        quality: pick(raw.quality, qualities, defaultLk888Image25Options.quality),
        background: pick(raw.background, backgrounds, defaultLk888Image25Options.background),
    };
}

type Lk888ImageOptionsStore = {
    options: Lk888Image25Options;
    updateOptions: (patch: Partial<Lk888Image25Options>) => void;
};

export const LK888_IMAGE_OPTIONS_STORE_KEY = "open_ai_canvas:lk888_image_options";

export const useLk888ImageOptionsStore = create<Lk888ImageOptionsStore>()(
    persist(
        (set) => ({
            options: defaultLk888Image25Options,
            updateOptions: (patch) => set((state) => ({ options: normalizeLk888Image25Options({ ...state.options, ...patch }) })),
        }),
        {
            name: LK888_IMAGE_OPTIONS_STORE_KEY,
            storage: createJSONStorage(() => scopedLocalStorage),
            partialize: (state) => ({ options: state.options }),
            merge: (persisted, current) => {
                const stored = (persisted || {}) as Partial<Lk888ImageOptionsStore>;
                return { ...current, options: normalizeLk888Image25Options(stored.options) };
            },
        },
    ),
);
