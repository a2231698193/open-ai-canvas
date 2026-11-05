import { expect, test } from "bun:test";
import { DEFAULT_VIDEO_PROMPT_MAX_CHARS, defaultModelCapabilityConfig, normalizeModelCapabilityConfig, videoDurationAllowed, videoDurationOptions } from "../src/lib/model-capabilities";

test("lk888-video MiniMax H3 uses vendor ratios and resolutions", () => {
    expect(defaultModelCapabilityConfig("lk888-video", "minimax-h3").video).toMatchObject({
        defaultRatio: "adaptive",
        ratios: ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        resolutions: ["768P", "1080P", "2K", "4K"],
        defaultResolution: "768P",
    });
});

test("lk888-kling-video motion control is reference-video driven", () => {
    const profile = defaultModelCapabilityConfig("lk888-kling-video", "kling-motion-control-v3").video!;
    expect(profile.operations).toEqual(["reference_to_video"]);
    expect(profile.defaultOperation).toBe("reference_to_video");
    expect(profile.references).toMatchObject({
        minImages: 1,
        maxImages: 1,
        maxImageBytes: 10 * 1024 * 1024,
        maxVideos: 1,
        maxVideoBytes: 100 * 1024 * 1024,
        maxVideoDurationSeconds: 30,
        maxAudios: 0,
        imageRoles: ["reference_image"],
    });
    // 成片时长由参考视频决定，画布不提供时长与画幅输入。
    expect(profile.durationSupported).toBe(false);
    expect(profile.ratios).toEqual([]);
    expect(profile.resolutions).toEqual(["720p", "1080p"]);
    expect(profile.generateAudio).toEqual({ supported: true, default: false });
    // 时长控件整体隐藏，也不应再用全局时长把模型判为不兼容。
    expect(videoDurationOptions(profile)).toEqual([]);
    expect(videoDurationAllowed(profile, 13)).toBe(true);
});

test("lk888-kling-video v4 exposes 3-30s text/image/reference modes", () => {
    const profile = defaultModelCapabilityConfig("lk888-kling-video", "kling-v4-video").video!;
    expect(profile.operations).toEqual(["text_to_video", "image_to_video", "reference_to_video"]);
    expect(profile.references).toMatchObject({ maxImages: 10, maxVideos: 5, maxVideoDurationSeconds: 30, imageRoles: ["first_frame", "reference_image"] });
    expect(profile.duration).toEqual({ selection: "range", min: 3, max: 30, step: 1, default: 5 });
    expect(profile.ratios).toEqual(["16:9", "9:16", "1:1", "21:9"]);
    expect(profile.resolutions).toEqual(["720p", "1080p"]);
    expect(profile.defaultResolution).toBe("720p");
});

test("lk888-video kling v3 defaults are unchanged by the kling plugin", () => {
    expect(defaultModelCapabilityConfig("lk888-video", "kling-v3-video").video).toMatchObject({
        duration: { selection: "enum", values: [5, 10, 15], default: 5 },
        references: { maxImages: 2, maxVideos: 0 },
    });
});

test("lk888-seedance includes adaptive ratio", () => {
    expect(defaultModelCapabilityConfig("lk888-seedance", "doubao-seedance-2-0-260128").video).toMatchObject({
        defaultRatio: "adaptive",
        ratios: ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        resolutions: ["480p", "720p", "1080p", "4k"],
        defaultResolution: "720p",
    });
    expect(defaultModelCapabilityConfig("lk888-seedance-anmiao", "doubao-seedance-2-0-fast-260128").video).toMatchObject({
        defaultRatio: "adaptive",
        resolutions: ["480p", "720p"],
    });
});

test("legacy video prompt limit 1000 normalizes to 8000", () => {
    const profile = defaultModelCapabilityConfig("lk888-seedance", "doubao-seedance-2-0-260128").video!;
    expect(profile.references.promptMaxChars).toBe(DEFAULT_VIDEO_PROMPT_MAX_CHARS);
    profile.references.promptMaxChars = 1000;
    expect(normalizeModelCapabilityConfig({ version: 1, video: profile }).video?.references.promptMaxChars).toBe(8000);
});

test("lk888-video video-enhance is video-to-video with 2K-to-8K output", () => {
    expect(defaultModelCapabilityConfig("lk888-video", "video-enhance").video).toMatchObject({
        defaultResolution: "1080p",
        resolutions: ["720p", "1080p", "2k", "4k", "8k"],
        operations: ["video_to_video"],
        defaultOperation: "video_to_video",
        references: {
            minImages: 0,
            maxImages: 0,
            maxVideos: 1,
            maxVideoDurationSeconds: 600,
        },
    });
});
