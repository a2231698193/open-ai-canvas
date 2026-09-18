export const LK888_MJ_PROTOCOL = "lk888-mj";

export type Lk888MjOptions = {
    botType: "MID_JOURNEY" | "NIJI_JOURNEY";
    quality: "" | "0.25" | "0.5" | "1" | "2";
    stylize: "" | "0" | "50" | "100" | "250" | "500" | "750" | "1000";
    chaos: "" | "0" | "25" | "50" | "75" | "100";
    style: "" | "raw";
};

export const defaultLk888MjOptions: Lk888MjOptions = {
    botType: "MID_JOURNEY",
    quality: "",
    stylize: "",
    chaos: "",
    style: "",
};

export const lk888MjBotTypeOptions = [
    { value: "MID_JOURNEY", label: "MJ 写实", description: "电影感、概念艺术" },
    { value: "NIJI_JOURNEY", label: "Niji 动漫", description: "二次元、插画" },
] as const;

export const lk888MjQualityOptions = [
    { value: "", label: "默认", description: "由上游决定" },
    { value: "0.25", label: "0.25", description: "最快" },
    { value: "0.5", label: "0.5", description: "标准" },
    { value: "1", label: "1", description: "高清" },
    { value: "2", label: "2", description: "超清" },
] as const;

export const lk888MjStylizeOptions = [
    { value: "", label: "默认" },
    { value: "0", label: "0 写实" },
    { value: "50", label: "50" },
    { value: "100", label: "100" },
    { value: "250", label: "250" },
    { value: "500", label: "500" },
    { value: "750", label: "750" },
    { value: "1000", label: "1000" },
] as const;

export const lk888MjChaosOptions = [
    { value: "", label: "默认" },
    { value: "0", label: "0" },
    { value: "25", label: "25" },
    { value: "50", label: "50" },
    { value: "75", label: "75" },
    { value: "100", label: "100" },
] as const;

export const lk888MjStyleOptions = [
    { value: "", label: "默认" },
    { value: "raw", label: "Raw" },
] as const;

export function isLk888MjProtocol(protocol?: string) {
    return String(protocol || "").trim().toLowerCase() === LK888_MJ_PROTOCOL;
}

export function lk888MjProviderPayload(options: Lk888MjOptions) {
    const payload: Record<string, string> = { botType: options.botType };
    if (options.quality) payload.quality = options.quality;
    if (options.stylize) payload.stylize = options.stylize;
    if (options.chaos) payload.chaos = options.chaos;
    if (options.style) payload.style = options.style;
    return payload;
}

export function lk888MjSummary(options: Lk888MjOptions) {
    const parts = [options.botType === "NIJI_JOURNEY" ? "Niji" : "MJ"];
    if (options.quality) parts.push(`Q${options.quality}`);
    if (options.stylize) parts.push(`S${options.stylize}`);
    if (options.chaos) parts.push(`C${options.chaos}`);
    if (options.style) parts.push("Raw");
    return parts.join(" · ");
}
