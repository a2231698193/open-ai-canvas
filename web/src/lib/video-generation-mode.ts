import type { ModelInputSummary } from "@/lib/model-selection";

export type VideoGenerationMode = "text" | "image" | "keyframes" | "reference";
export type VideoImageRole = "first_frame" | "last_frame" | "reference_image";

export const VIDEO_GENERATION_MODE_OPTIONS: Array<{ value: VideoGenerationMode; label: string; description: string }> = [
    { value: "text", label: "文生视频", description: "只使用提示词" },
    { value: "image", label: "图生视频", description: "单张图片作为首帧" },
    { value: "keyframes", label: "首尾帧参考", description: "用首帧和尾帧控制镜头" },
    { value: "reference", label: "全能参考", description: "使用图片、视频或音频参考" },
];

export function videoModeOperation(mode: VideoGenerationMode) {
    return mode === "text" ? "text_to_video" : mode === "reference" ? "reference_to_video" : "image_to_video";
}

export function videoModeImageRoles(mode: VideoGenerationMode): VideoImageRole[] {
    if (mode === "image") return ["first_frame"];
    if (mode === "keyframes") return ["first_frame", "last_frame"];
    if (mode === "reference") return ["reference_image"];
    return [];
}

export function inferVideoGenerationMode(input: ModelInputSummary): VideoGenerationMode {
    const imageCount = input.imageCount + input.characterCount;
    if (input.videoCount > 0 || input.audioCount > 0 || imageCount > 2) return "reference";
    if (imageCount === 2) return "keyframes";
    if (imageCount === 1) return "image";
    return "text";
}

export function normalizeVideoGenerationMode(value: unknown): VideoGenerationMode | undefined {
    return value === "text" || value === "image" || value === "keyframes" || value === "reference" ? value : undefined;
}

// 只取判定模式所需的最小结构，避免 lib 之间互相 import 造成循环依赖。
export type VideoModeCapabilityLike = {
    operations?: string[];
    references?: { imageRoles?: string[]; maxImages?: number; maxVideos?: number; maxAudios?: number };
};

/**
 * 模型能力允许的视频模式。模式到能力的映射必须和 videoModeOperation / videoModeImageRoles 一致：
 * 首尾帧参考走 image_to_video 但需要 last_frame 角色，全能参考需要 reference_to_video 与参考输入槽位。
 * 能力缺失（模型未配置/未解析）时保留全部模式，不能把可选项清空。
 */
export function supportedVideoGenerationModes(profile?: VideoModeCapabilityLike | null): VideoGenerationMode[] {
    const all = VIDEO_GENERATION_MODE_OPTIONS.map((option) => option.value);
    if (!profile) return all;
    const operations = profile.operations?.length ? profile.operations : ["text_to_video", "image_to_video"];
    const roles = profile.references?.imageRoles?.length ? profile.references.imageRoles : ["first_frame"];
    const referenceInputs = (profile.references?.maxVideos ?? 0) > 0 || (profile.references?.maxAudios ?? 0) > 0;
    return all.filter((mode) => {
        if (mode === "text") return operations.includes("text_to_video");
        if (mode === "image") return operations.includes("image_to_video") && roles.includes("first_frame");
        if (mode === "keyframes") return operations.includes("image_to_video") && roles.includes("first_frame") && roles.includes("last_frame");
        return operations.includes("reference_to_video") && (roles.includes("reference_image") || referenceInputs);
    });
}

/** 把模式收敛到能力支持的第一项；已支持或没有任何可选项时原样返回。 */
export function clampVideoGenerationMode(mode: VideoGenerationMode, profile?: VideoModeCapabilityLike | null): VideoGenerationMode {
    const allowed = supportedVideoGenerationModes(profile);
    return allowed.includes(mode) || !allowed.length ? mode : allowed[0];
}

export function videoModeInputSummary(mode: VideoGenerationMode, input: ModelInputSummary): ModelInputSummary {
    if (mode === "text") return { ...input, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 };
    if (mode === "image") return { ...input, imageCount: Math.min(1, input.imageCount), videoCount: 0, audioCount: 0, characterCount: 0 };
    if (mode === "keyframes") return { ...input, imageCount: Math.min(2, input.imageCount), videoCount: 0, audioCount: 0, characterCount: 0 };
    return input;
}

export function videoGenerationModeFromMetadata(
    metadata?: { videoMode?: string; videoEditOperation?: string; videoStartFrameNodeId?: string; videoEndFrameNodeId?: string },
    legacyInput?: ModelInputSummary,
): VideoGenerationMode {
    const explicit = normalizeVideoGenerationMode(metadata?.videoMode);
    if (explicit) return explicit;
    if (metadata?.videoEditOperation === "reference_to_video") return "reference";
    if (metadata?.videoEndFrameNodeId) return "keyframes";
    if (metadata?.videoStartFrameNodeId) {
        // 只选了首帧、但画布上仍是「两张图」的输入时依然是首尾帧模式：否则用户在面板上
        // 刚点完首帧，模式就被推导成图生视频，尾帧下拉直接消失、再也选不了（实测）。
        return legacyInput && inferVideoGenerationMode(legacyInput) === "keyframes" ? "keyframes" : "image";
    }
    if (metadata?.videoEditOperation === "image_to_video") return "image";
    return legacyInput ? inferVideoGenerationMode(legacyInput) : "text";
}

// 选首帧/尾帧时顺带把当前模式固定下来：只写帧字段会让模式在"两张图"和"一张图"之间
// 反复推导，用户选完首帧就会丢掉尾帧入口。返回的是可直接并入节点 metadata 的补丁。
export function videoFrameSelectionPatch(
    mode: VideoGenerationMode,
    key: "videoStartFrameNodeId" | "videoEndFrameNodeId",
    value: string | undefined,
): { videoMode: VideoGenerationMode; videoEditOperation: ReturnType<typeof videoModeOperation>; videoStartFrameNodeId?: string; videoEndFrameNodeId?: string } {
    return {
        videoMode: mode,
        videoEditOperation: videoModeOperation(mode),
        ...(key === "videoStartFrameNodeId" ? { videoStartFrameNodeId: value } : { videoEndFrameNodeId: value }),
    };
}
