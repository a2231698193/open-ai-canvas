export const LK888_IMAGE_PROTOCOL = "lk888-image";
export const TT_IMAGE_25_MODEL = "tt-image-2.5";

export type Lk888Image25Options = {
    version: "flare" | "sunburst";
    quality: "" | "auto" | "low" | "medium" | "high" | "xhigh" | "max";
    background: "" | "opaque" | "transparent" | "auto";
};

export const defaultLk888Image25Options: Lk888Image25Options = {
    version: "flare",
    quality: "auto",
    background: "",
};

export const lk888Image25VersionOptions = [
    { value: "flare", label: "标准版", description: "更快、更便宜" },
    { value: "sunburst", label: "增强版", description: "细节更稳" },
] as const;

export const lk888Image25QualityOptions = [
    { value: "auto", label: "自适应", description: "由模型决定" },
    { value: "low", label: "低", description: "更快" },
    { value: "medium", label: "中", description: "均衡" },
    { value: "high", label: "高", description: "更细" },
    { value: "xhigh", label: "超高", description: "更慢" },
    { value: "max", label: "极致", description: "最高画质" },
] as const;

export const lk888Image25BackgroundOptions = [
    { value: "", label: "默认", description: "不透明" },
    { value: "opaque", label: "不透明" },
    { value: "transparent", label: "透明底" },
    { value: "auto", label: "自适应" },
] as const;

export function isTtImage25(protocol?: string, model?: string) {
    return String(protocol || "").trim().toLowerCase() === LK888_IMAGE_PROTOCOL && String(model || "").trim().toLowerCase() === TT_IMAGE_25_MODEL;
}

export function lk888Image25ProviderPayload(options: Lk888Image25Options) {
    const payload: Record<string, string> = { version: options.version };
    if (options.quality) payload.quality = options.quality;
    if (options.background) payload.background = options.background;
    return payload;
}

export function lk888Image25Summary(options: Lk888Image25Options) {
    const parts = [options.version === "sunburst" ? "增强版" : "标准版"];
    if (options.quality && options.quality !== "auto") parts.push(options.quality);
    if (options.background === "transparent") parts.push("透明底");
    return parts.join(" · ");
}
