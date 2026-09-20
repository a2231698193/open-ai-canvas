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
    if (metadata?.videoStartFrameNodeId || metadata?.videoEditOperation === "image_to_video") return "image";
    return legacyInput ? inferVideoGenerationMode(legacyInput) : "text";
}
