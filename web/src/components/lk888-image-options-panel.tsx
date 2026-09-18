import {
    lk888Image25BackgroundOptions,
    lk888Image25QualityOptions,
    lk888Image25VersionOptions,
    type Lk888Image25Options,
} from "@/lib/lk888-image-options";
import { useLk888ImageOptionsStore } from "@/stores/use-lk888-image-options-store";

type Option = { value: string; label: string; description?: string };

export function Lk888Image25OptionsPanel({ compact = false }: { compact?: boolean }) {
    const options = useLk888ImageOptionsStore((state) => state.options);
    const updateOptions = useLk888ImageOptionsStore((state) => state.updateOptions);
    const section = (title: string, key: keyof Lk888Image25Options, items: readonly Option[], columns: string) => (
        <section className={compact ? "space-y-2" : "creation-parameter-section"}>
            {compact ? <div className="text-[var(--fs-label)] opacity-70">{title}</div> : <header><h3>{title}</h3></header>}
            <div className={compact ? `grid gap-1.5 ${columns}` : "creation-choice-grid is-quality"}>
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
            {section("版本", "version", lk888Image25VersionOptions, "grid-cols-2")}
            {section("画质", "quality", lk888Image25QualityOptions, "grid-cols-3")}
            {section("背景", "background", lk888Image25BackgroundOptions, "grid-cols-4")}
        </div>
    );
}
