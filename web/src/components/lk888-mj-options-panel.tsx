import {
    lk888MjBotTypeOptions,
    lk888MjChaosOptions,
    lk888MjQualityOptions,
    lk888MjStyleOptions,
    lk888MjStylizeOptions,
    type Lk888MjOptions,
} from "@/lib/lk888-mj-options";
import { useLk888MjOptionsStore } from "@/stores/use-lk888-mj-options-store";

type Option = { value: string; label: string; description?: string };

export function Lk888MjOptionsPanel({ compact = false }: { compact?: boolean }) {
    const options = useLk888MjOptionsStore((state) => state.options);
    const updateOptions = useLk888MjOptionsStore((state) => state.updateOptions);
    const section = (title: string, key: keyof Lk888MjOptions, items: readonly Option[], columns: string) => (
        <section className={compact ? "space-y-2" : "creation-parameter-section"}>
            {compact ? <div className="text-[var(--fs-label)] opacity-70">{title}</div> : <header><h3>{title}</h3></header>}
            <div className={compact ? `grid gap-1.5 ${columns}` : `creation-choice-grid ${key === "botType" ? "is-quality" : "is-count"}`}>
                {items.map((item) => (
                    <button
                        key={item.value || "default"}
                        type="button"
                        aria-pressed={options[key] === item.value}
                        className={compact
                            ? `rounded-lg border px-2 py-1.5 text-[var(--fs-label)] ${options[key] === item.value ? "border-current" : "border-transparent opacity-70"}`
                            : options[key] === item.value ? "is-selected" : ""}
                        onClick={() => updateOptions({ [key]: item.value })}
                    >
                        <span>{item.label}</span>
                        {!compact && item.description ? <small>{item.description}</small> : null}
                    </button>
                ))}
            </div>
        </section>
    );
    return (
        <div className={compact ? "space-y-3" : undefined}>
            {section("模式", "botType", lk888MjBotTypeOptions, "grid-cols-2")}
            {section("精细度", "quality", lk888MjQualityOptions, "grid-cols-5")}
            {section("风格化", "stylize", lk888MjStylizeOptions, "grid-cols-4")}
            {section("变化", "chaos", lk888MjChaosOptions, "grid-cols-6")}
            {section("风格", "style", lk888MjStyleOptions, "grid-cols-2")}
        </div>
    );
}
