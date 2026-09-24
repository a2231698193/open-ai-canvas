// APIMart Midjourney 的画布选项。这里同时承担「参数收敛」职责：
// 上游不校验 version / speed，非法值会先建任务再 FAILURE，所以枚举必须在提交前收敛。
export const APIMART_MJ_PROTOCOL = "apimart-mj";

// 白名单取自 MJ 引擎自身的校验报错，比 APIMart 文档多出 5 / 6 / 8 三档。
export const apimartMjVersions = ["8.2", "8.1", "8", "7", "6.1", "6", "5.2", "5.1", "5"] as const;
export const apimartMjSpeedValues = ["", "relax", "fast", "turbo"] as const;
// Niji 只有 v6 / v7 两个计费版本（上游归一化为 niji7 / niji6）。
export const apimartMjNijiVersions = ["7", "6"] as const;
const apimartMjTrueValues = ["true", "1", "yes", "on"];

export type ApimartMjVersion = (typeof apimartMjVersions)[number];
export type ApimartMjSpeed = (typeof apimartMjSpeedValues)[number];

export type ApimartMjOptions = {
    version: ApimartMjVersion;
    speed: ApimartMjSpeed;
    niji: boolean;
};

export type ApimartMjOption = { value: string; label: string; description?: string };

export const defaultApimartMjOptions: ApimartMjOptions = {
    version: "8.2",
    speed: "",
    niji: false,
};

export const apimartMjModeOptions: readonly ApimartMjOption[] = [
    { value: "mj", label: "MJ 写实", description: "Midjourney 主模型" },
    { value: "niji", label: "Niji 动漫", description: "二次元、插画（仅 v6 / v7）" },
];

export const apimartMjVersionOptions: readonly ApimartMjOption[] = [
    { value: "8.2", label: "v8.2", description: "最新版本" },
    { value: "8.1", label: "v8.1", description: "支持 HD / 重塑" },
    { value: "8", label: "v8", description: "" },
    { value: "7", label: "v7", description: "" },
    { value: "6.1", label: "v6.1", description: "" },
    { value: "6", label: "v6", description: "" },
    { value: "5.2", label: "v5.2", description: "旧版" },
    { value: "5.1", label: "v5.1", description: "旧版" },
    { value: "5", label: "v5", description: "旧版" },
];

export const apimartMjSpeedOptions: readonly ApimartMjOption[] = [
    { value: "", label: "Relax", description: "默认，队列较慢" },
    { value: "fast", label: "Fast", description: "加速通道" },
    { value: "turbo", label: "Turbo", description: "最快，单价更高" },
];

export function isApimartMjProtocol(protocol?: string) {
    return (
        String(protocol || "")
            .trim()
            .toLowerCase() === APIMART_MJ_PROTOCOL
    );
}

// Niji 模式下只保留 v6 / v7，避免选出上游不支持的组合。
export function apimartMjVersionChoices(niji: boolean): readonly ApimartMjOption[] {
    if (!niji) return apimartMjVersionOptions;
    return apimartMjVersionOptions.filter((item) => (apimartMjNijiVersions as readonly string[]).includes(item.value));
}

export function normalizeApimartMjOptions(value: unknown): ApimartMjOptions {
    const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const niji = apimartMjTrueValues.includes(
        String(raw.niji ?? "")
            .trim()
            .toLowerCase(),
    );
    const versionRaw = String(raw.version ?? "").trim();
    const version = (apimartMjVersions as readonly string[]).includes(versionRaw) ? (versionRaw as ApimartMjVersion) : defaultApimartMjOptions.version;
    const speedRaw = String(raw.speed ?? "")
        .trim()
        .toLowerCase();
    const speed = (apimartMjSpeedValues as readonly string[]).includes(speedRaw) ? (speedRaw as ApimartMjSpeed) : defaultApimartMjOptions.speed;
    return {
        version: niji && !(apimartMjNijiVersions as readonly string[]).includes(version) ? "7" : version,
        niji,
        speed,
    };
}

// 只提交用户真正选择过的字段：不传 version 时由上游决定默认版本，不传 niji 即上游默认关闭。
export function apimartMjProviderPayload(options: ApimartMjOptions) {
    const payload: Record<string, unknown> = {};
    if (options.version) payload.version = options.version;
    if (options.speed) payload.speed = options.speed;
    if (options.niji) payload.niji = true;
    return payload;
}

export function apimartMjSummary(options: ApimartMjOptions) {
    const parts = [options.niji ? "Niji" : "MJ", `v${options.version}`];
    if (options.speed === "fast") parts.push("Fast");
    if (options.speed === "turbo") parts.push("Turbo");
    return parts.join(" · ");
}
