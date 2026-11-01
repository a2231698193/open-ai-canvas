// 时间线导出规格：目标宽高的预设与默认值、片段适配方式汇总。纯函数，供导出弹窗与单测使用。

import { evenDimension, timelineClipFitMode, type TimelineFitMode } from "./timeline-to-ffmpeg";

export type TimelineExportSize = { width: number; height: number };
export type TimelineExportPreset = "first" | "drama" | "9:16" | "16:9" | "1:1";

export const TIMELINE_FALLBACK_EXPORT_SIZE: TimelineExportSize = { width: 1920, height: 1080 };
const MAX_FOLLOW_LONG_EDGE = 1920;

const FIXED_PRESET_SIZES: Record<"9:16" | "16:9" | "1:1", TimelineExportSize> = {
    "9:16": { width: 1080, height: 1920 },
    "16:9": { width: 1920, height: 1080 },
    "1:1": { width: 1080, height: 1080 },
};

/** 与后端 drama_orchestrator.go dramaRenderSize 保持同一张表；未列出的画幅（含 9:16、21:9）按 1080×1920。 */
export function dramaRenderSize(aspect: string): TimelineExportSize {
    switch (aspect) {
        case "16:9":
            return { width: 1920, height: 1080 };
        case "1:1":
            return { width: 1080, height: 1080 };
        case "3:4":
            return { width: 1080, height: 1440 };
        case "4:3":
            return { width: 1440, height: 1080 };
    }
    return { width: 1080, height: 1920 };
}

/** 跟随片段尺寸：保持宽高比，长边不超过 1920，宽高取偶数；尺寸未知时返回 null。 */
export function normalizeTimelineSourceSize(width?: number, height?: number): TimelineExportSize | null {
    if (!width || !height || width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) return null;
    const scale = Math.min(1, MAX_FOLLOW_LONG_EDGE / Math.max(width, height));
    return { width: evenDimension(width * scale), height: evenDimension(height * scale) };
}

export function defaultTimelineExportPreset(dramaAspectRatio?: string): TimelineExportPreset {
    return dramaAspectRatio ? "drama" : "first";
}

export function resolveTimelineExportSize(preset: TimelineExportPreset, options: { firstClipSize?: { width?: number; height?: number } | null; dramaAspectRatio?: string }): TimelineExportSize {
    if (preset === "drama" && options.dramaAspectRatio) return dramaRenderSize(options.dramaAspectRatio);
    if (preset === "9:16" || preset === "16:9" || preset === "1:1") return FIXED_PRESET_SIZES[preset];
    return normalizeTimelineSourceSize(options.firstClipSize?.width, options.firstClipSize?.height) || TIMELINE_FALLBACK_EXPORT_SIZE;
}

export type TimelineExportPresetOption = { value: TimelineExportPreset; label: string; size: TimelineExportSize };

export function timelineExportPresetOptions(options: { firstClipSize?: { width?: number; height?: number } | null; dramaAspectRatio?: string }): TimelineExportPresetOption[] {
    const first = resolveTimelineExportSize("first", options);
    const known = Boolean(normalizeTimelineSourceSize(options.firstClipSize?.width, options.firstClipSize?.height));
    const sizeLabel = (size: TimelineExportSize) => `${size.width}×${size.height}`;
    const items: TimelineExportPresetOption[] = [{ value: "first", label: known ? `跟随首个片段 ${sizeLabel(first)}` : `跟随首个片段（尺寸未知，${sizeLabel(first)}）`, size: first }];
    if (options.dramaAspectRatio) {
        const drama = dramaRenderSize(options.dramaAspectRatio);
        items.push({ value: "drama", label: `短剧画幅 ${options.dramaAspectRatio} ${sizeLabel(drama)}`, size: drama });
    }
    for (const value of ["9:16", "16:9", "1:1"] as const) items.push({ value, label: `${value} ${sizeLabel(FIXED_PRESET_SIZES[value])}`, size: FIXED_PRESET_SIZES[value] });
    return items;
}

/** 汇总全部视频片段相对目标画幅的适配方式；没有片段时返回 null。 */
export function summarizeTimelineFitModes(sources: Array<{ width?: number; height?: number }>, target: TimelineExportSize): TimelineFitMode | "mixed" | null {
    if (!sources.length) return null;
    const modes = new Set(sources.map((source) => timelineClipFitMode(source, target)));
    return modes.size > 1 ? "mixed" : [...modes][0];
}

export function timelineFitModeLabel(mode: TimelineFitMode | "mixed" | null): string {
    if (mode === "crop") return "裁切填满";
    if (mode === "pad") return "补黑边";
    if (mode === "mixed") return "混合（按片段）";
    return "";
}
