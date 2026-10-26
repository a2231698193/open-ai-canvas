import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { ModelPicker } from "@/components/model-picker";
import { dramaChoiceKey, dramaChoiceToModel, modelToDramaChoice } from "@/lib/drama/model-choice";
import { cn } from "@/lib/utils";
import { getDramaModels, type DramaCapability, type DramaModelChoice } from "@/services/api/drama";
import { useEffectiveConfig } from "@/stores/use-config-store";

export function useDramaModelCatalog() {
    return useQuery({ queryKey: ["drama-models"], queryFn: getDramaModels, staleTime: 60_000 });
}

/**
 * 短剧制作用的模型下拉：沿用创作端带品牌图标的通用 ModelPicker，
 * 只放行后端短剧目录里可无人值守执行的平台模型。
 */
export function DramaModelPicker({
    capability,
    value,
    onChange,
    placeholder,
    size = "md",
    showPrice = true,
    className,
}: {
    capability: DramaCapability;
    value?: DramaModelChoice;
    onChange: (choice: DramaModelChoice) => void;
    placeholder?: string;
    size?: "sm" | "md";
    showPrice?: boolean;
    className?: string;
}) {
    const config = useEffectiveConfig();
    const catalogQuery = useDramaModelCatalog();
    const allowed = useMemo(() => {
        const options = catalogQuery.data?.options[capability] || [];
        return new Map(options.map((option) => [dramaChoiceKey(option.choice), option.choice]));
    }, [capability, catalogQuery.data]);
    const modelFilter = useCallback(
        (model: string) => {
            const key = dramaChoiceKey(modelToDramaChoice(config, model));
            // 目录未返回前只限制为平台模型；返回后与服务端可执行目录严格一致。
            return Boolean(key) && (!catalogQuery.data || allowed.has(key));
        },
        [allowed, catalogQuery.data, config],
    );
    const current = dramaChoiceToModel(config, capability, value);

    return (
        <ModelPicker
            config={config}
            value={current}
            capability={capability}
            variant="creation"
            fullWidth
            showSelectedPrice={showPrice}
            showOptionPrices
            modelFilter={modelFilter}
            className={cn("drama-model-picker", size === "sm" && "is-sm", className)}
            placeholder={current ? placeholder || "选择模型" : value?.label || placeholder || "选择模型"}
            onChange={(model) => {
                const choice = modelToDramaChoice(config, model);
                if (!choice) return;
                const known = allowed.get(dramaChoiceKey(choice));
                onChange(known ? { ...known, label: choice.label || known.label } : choice);
            }}
        />
    );
}
