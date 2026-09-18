import { expect, test } from "bun:test";

import {
    defaultVideoEnhanceParams,
    estimateVideoEnhanceCredits,
    findVideoEnhanceModel,
    formatVideoEnhanceCredits,
    isVideoEnhanceModel,
    videoEnhanceDurationError,
    videoEnhanceDurationSeconds,
    videoEnhanceProviderOptions,
} from "../src/lib/canvas/canvas-video-enhance";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store";

function configWithVideoModels(models: Array<{ model: string; displayName: string; protocol?: string }>): AiConfig {
    return {
        ...defaultConfig,
        channels: [{
            id: "CHANNEL_000010",
            name: "云桥",
            scope: "system",
            baseUrl: "https://api.lk888.ai",
            apiKey: "test",
            apiFormat: "openai",
            interfaceType: "lk888-video",
            models: models.map((item) => item.model),
            modelCosts: models.map((item) => ({
                model: item.model,
                displayName: item.displayName,
                protocol: item.protocol || "lk888-video",
                capability: "video" as const,
                billingMode: "per_second" as const,
                unitPriceMicrocredits: 240000,
            })),
        }],
    };
}

test("finds video-enhance by upstream key or display name", () => {
    const config = configWithVideoModels([
        { model: "minimax-h3", displayName: "MiniMax H3" },
        { model: "video-enhance", displayName: "视频超分" },
    ]);
    expect(findVideoEnhanceModel(config)).toContain("video-enhance");
    expect(isVideoEnhanceModel(config, "CHANNEL_000010::video-enhance")).toBe(true);
});

test("caps source duration and estimates credits with multipliers", () => {
    expect(videoEnhanceDurationSeconds()).toBe(1);
    expect(videoEnhanceDurationSeconds(1500)).toBe(2);
    expect(videoEnhanceDurationError(11 * 60 * 1000)).toContain("10 分钟");
    expect(videoEnhanceDurationError(30_000)).toBe("");
    expect(estimateVideoEnhanceCredits(defaultVideoEnhanceParams, 10)).toBeCloseTo(4.74, 5);
    expect(estimateVideoEnhanceCredits({ ...defaultVideoEnhanceParams, resolution: "720p", toolVersion: "professional", fps: "60" }, 10)).toBeCloseTo(47.4, 5);
    expect(formatVideoEnhanceCredits(4.74)).toBe("4.74 积分");
});

test("omits scene for professional version", () => {
    expect(videoEnhanceProviderOptions({ resolution: "1080p", fps: "keep", toolVersion: "standard", scene: "aigc", enhanceStyle: "hd" })).toEqual({
        fps: "keep",
        tool_version: "standard",
        scene: "aigc",
        enhance_style: "hd",
    });
    expect(videoEnhanceProviderOptions({ resolution: "4k", fps: "120", toolVersion: "professional", scene: "aigc" })).toEqual({
        fps: "120",
        tool_version: "professional",
    });
});

