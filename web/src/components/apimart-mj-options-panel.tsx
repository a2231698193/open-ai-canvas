import { apimartMjModeOptions, apimartMjSpeedOptions, apimartMjVersionChoices, type ApimartMjOption } from "@/lib/apimart-mj-options";
import { useApimartMjOptionsStore } from "@/stores/use-apimart-mj-options-store";

export function ApimartMjOptionsPanel({ compact = false }: { compact?: boolean }) {
    const options = useApimartMjOptionsStore((state) => state.options);
    const updateOptions = useApimartMjOptionsStore((state) => state.updateOptions);
    const section = (title: string, selected: string, items: readonly ApimartMjOption[], columns: string, onSelect: (value: string) => void) => (
        <section className={compact ? "space-y-2" : "creation-parameter-section"}>
            {compact ? (
                <div className="text-[var(--fs-label)] opacity-70">{title}</div>
            ) : (
                <header>
                    <h3>{title}</h3>
                </header>
            )}
            <div className={compact ? `grid gap-1.5 ${columns}` : "creation-choice-grid is-count"}>
                {items.map((item) => (
                    <button
                        key={item.value || "default"}
                        type="button"
                        aria-pressed={selected === item.value}
                        className={compact ? `rounded-lg border px-2 py-1.5 text-[var(--fs-label)] ${selected === item.value ? "border-current" : "border-transparent opacity-70"}` : selected === item.value ? "is-selected" : ""}
                        onClick={() => onSelect(item.value)}
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
            {section("模式", options.niji ? "niji" : "mj", apimartMjModeOptions, "grid-cols-2", (value) => updateOptions({ niji: value === "niji" }))}
            {section("版本", options.version, apimartMjVersionChoices(options.niji), "grid-cols-3", (value) => updateOptions({ version: value as typeof options.version }))}
            {section("速度", options.speed, apimartMjSpeedOptions, "grid-cols-3", (value) => updateOptions({ speed: value as typeof options.speed }))}
        </div>
    );
}
