import type { ModelCapabilityChoice } from "@/components/model-protocol-picker";
import type { ChannelModel, ChannelModelPriceTier } from "@/services/api/wallet";

export type PriceTierMatchMode = "default" | "advanced";

// 与后端保存口径一致：上游键比较前剥掉一次 models/ 前缀，避免极旧存量行误报差异。
export function normalizeUpstreamModelKey(value: unknown): string {
    return String(value || "").trim().replace(/^models\//, "");
}

export type PriceTierFormValues = {
    matchMode: PriceTierMatchMode;
    operation: string;
    quality: string;
    size: string;
    resolution: string;
    videoSeconds: number;
    imageCount: number;
    providerModelKey?: string;
    billingMode: ChannelModel["billingMode"];
    unitPrice: number;
    inputTokenPrice: number;
    outputTokenPrice: number;
    cachedTokenPrice: number;
    priceConfigured: boolean;
    enabled: boolean;
};

export function defaultPriceTier(matchMode: PriceTierMatchMode = "default"): PriceTierFormValues {
    return {
        matchMode,
        operation: "*",
        quality: "*",
        size: "*",
        resolution: "*",
        videoSeconds: 0,
        imageCount: 0,
        providerModelKey: "",
        billingMode: "fixed_request",
        unitPrice: 0,
        inputTokenPrice: 0,
        outputTokenPrice: 0,
        cachedTokenPrice: 0,
        priceConfigured: true,
        enabled: true,
    };
}

export function priceTierToForm(tier: ChannelModelPriceTier): PriceTierFormValues {
    const selector = tier.selector || {};
    const hasSpecificMatch = Object.values(selector).some((value) => value && value !== "*") || (tier.resolution && tier.resolution !== "*") || tier.videoSeconds > 0;
    return {
        matchMode: hasSpecificMatch ? "advanced" : "default",
        operation: selector.operation || "*",
        quality: selector.quality || "*",
        size: selector.size || "*",
        resolution: tier.resolution || "*",
        videoSeconds: tier.videoSeconds || 0,
        imageCount: Number(selector.imageCount || 0),
        providerModelKey: tier.providerModelKey || "",
        billingMode: tier.billingMode,
        unitPrice: tier.unitPriceMicrocredits / 1_000_000,
        inputTokenPrice: tier.inputTokenPriceMicrocredits / 1_000_000,
        outputTokenPrice: tier.outputTokenPriceMicrocredits / 1_000_000,
        cachedTokenPrice: tier.cachedTokenPriceMicrocredits / 1_000_000,
        priceConfigured: tier.priceConfigured,
        enabled: tier.enabled,
    };
}

export function legacyPriceTierToForm(item: ChannelModel): PriceTierFormValues {
    return {
        ...defaultPriceTier(),
        // 不预填顶层上游键：统一价格档保持“跟随模型默认上游 ID”，
        // 否则首次保存会把当时的上游键固化进档位，之后模型级重命名会被旧值遮蔽。
        billingMode: item.billingMode,
        unitPrice: item.unitPriceMicrocredits / 1_000_000,
        inputTokenPrice: item.inputTokenPriceMicrocredits / 1_000_000,
        outputTokenPrice: item.outputTokenPriceMicrocredits / 1_000_000,
        cachedTokenPrice: item.cachedTokenPriceMicrocredits / 1_000_000,
        priceConfigured: item.priceConfigured,
        enabled: item.enabled,
    };
}

export function skuSelectorFromForm(capability: ModelCapabilityChoice, tier: PriceTierFormValues) {
    if (tier.matchMode !== "advanced") return {};
    const selector: Record<string, string> = {};
    if (tier.operation && tier.operation !== "*") selector.operation = tier.operation;
    if (capability === "video") {
        if (tier.resolution && tier.resolution !== "*") selector.vquality = tier.resolution;
        if (Number(tier.videoSeconds) > 0) selector.videoSeconds = String(Number(tier.videoSeconds));
        if (Number(tier.imageCount) > 0) selector.imageCount = String(Number(tier.imageCount));
    }
    if (capability === "image") {
        if (tier.quality && tier.quality !== "*") selector.quality = tier.quality;
        if (tier.size && tier.size !== "*") selector.size = tier.size;
    }
    return selector;
}

export function priceTierResolutionFromForm(capability: ModelCapabilityChoice, tier: PriceTierFormValues) {
    return capability === "video" && tier.matchMode === "advanced" ? tier.resolution || "*" : "*";
}

export function priceTierVideoSecondsFromForm(capability: ModelCapabilityChoice, tier: PriceTierFormValues) {
    return capability === "video" && tier.matchMode === "advanced" ? Number(tier.videoSeconds || 0) : 0;
}
