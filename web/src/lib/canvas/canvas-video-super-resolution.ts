import { modelDisplayName, modelOptionName, modelOptionsFromChannels, type AiConfig } from "@/stores/use-config-store";

export const VIDEO_ENHANCE_MODEL_KEY = "video-enhance";
export const VIDEO_ENHANCE_MAX_SECONDS = 600;

export type VideoEnhanceResolution = "720p" | "1080p" | "2k" | "4k" | "8k";
export type VideoEnhanceFps = "keep" | "60" | "120";
export type VideoEnhanceVersion = "standard" | "professional";
export type VideoEnhanceScene = "aigc" | "short_series" | "ugc" | "old_film";
export type VideoEnhanceStyle = "natural" | "hd";

export type VideoEnhanceParams = {
    resolution: VideoEnhanceResolution;
    fps: VideoEnhanceFps;
    toolVersion: VideoEnhanceVersion;
    scene?: VideoEnhanceScene;
    enhanceStyle?: VideoEnhanceStyle;
};

export const VIDEO_ENHANCE_RESOLUTION_OPTIONS: Array<{ value: VideoEnhanceResolution; label: string }> = [
    { value: "720p", label: "720P" },
    { value: "1080p", label: "1080P" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
    { value: "8k", label: "8K" },
];

export const VIDEO_ENHANCE_FPS_OPTIONS: Array<{ value: VideoEnhanceFps; label: string; description: string }> = [
    { value: "keep", label: "原帧率", description: "保持源视频帧率" },
    { value: "60", label: "60fps", description: "插帧到 60" },
    { value: "120", label: "120fps", description: "插帧到 120" },
];

export const VIDEO_ENHANCE_VERSION_OPTIONS: Array<{ value: VideoEnhanceVersion; label: string; description: string }> = [
    { value: "standard", label: "标准版", description: "默认可选场景" },
    { value: "professional", label: "专业版", description: "画质更高，价格 10 倍" },
];

export const VIDEO_ENHANCE_SCENE_OPTIONS: Array<{ value: VideoEnhanceScene; label: string }> = [
    { value: "aigc", label: "AIGC" },
    { value: "short_series", label: "短剧" },
    { value: "ugc", label: "UGC" },
    { value: "old_film", label: "老片修复" },
];

export const VIDEO_ENHANCE_STYLE_OPTIONS: Array<{ value: VideoEnhanceStyle; label: string }> = [
    { value: "natural", label: "自然" },
    { value: "hd", label: "高清" },
];

export const defaultVideoEnhanceParams: VideoEnhanceParams = {
    resolution: "1080p",
    fps: "keep",
    toolVersion: "standard",
};

const RESOLUTION_MULTIPLIER: Record<VideoEnhanceResolution, number> = {
    "720p": 1,
    "1080p": 2,
    "2k": 4,
    "4k": 8,
    "8k": 32,
};

const FPS_MULTIPLIER: Record<VideoEnhanceFps, number> = {
    keep: 1,
    "60": 2,
    "120": 4,
};

const VERSION_MULTIPLIER: Record<VideoEnhanceVersion, number> = {
    standard: 1,
    professional: 10,
};

const BASE_YUAN_PER_SECOND = 0.0237;
const CREDITS_PER_YUAN = 10;

export function isVideoEnhanceModel(config: AiConfig, model: string) {
    const key = modelOptionName(model).trim().toLowerCase();
    const name = modelDisplayName(config, model).trim().toLowerCase();
    return key === VIDEO_ENHANCE_MODEL_KEY || name.includes("超分") || name.includes("video enhance") || name.includes("video-enhance");
}

export function findVideoEnhanceModel(config: AiConfig) {
    return modelOptionsFromChannels(config.channels).find((model) => isVideoEnhanceModel(config, model));
}

export function videoEnhanceDurationSeconds(durationMs?: number) {
    if (!durationMs || durationMs <= 0) return 1;
    return Math.max(1, Math.ceil(durationMs / 1000));
}

export function videoEnhanceDurationError(durationMs?: number) {
    if (!durationMs || durationMs <= 0) return "";
    if (videoEnhanceDurationSeconds(durationMs) > VIDEO_ENHANCE_MAX_SECONDS) return "源视频超过 10 分钟，上游暂不支持超分";
    return "";
}

export function estimateVideoEnhanceCredits(params: VideoEnhanceParams, seconds: number) {
    const duration = Math.max(1, Math.floor(Number(seconds) || 1));
    return BASE_YUAN_PER_SECOND * CREDITS_PER_YUAN * RESOLUTION_MULTIPLIER[params.resolution] * FPS_MULTIPLIER[params.fps] * VERSION_MULTIPLIER[params.toolVersion] * duration;
}

export function formatVideoEnhanceCredits(value: number) {
    return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 积分`;
}

export function videoEnhanceProviderOptions(params: VideoEnhanceParams) {
    const options: Record<string, unknown> = {
        fps: params.fps,
        tool_version: params.toolVersion,
    };
    if (params.toolVersion === "standard" && params.scene) options.scene = params.scene;
    if (params.enhanceStyle) options.enhance_style = params.enhanceStyle;
    return options;
}

