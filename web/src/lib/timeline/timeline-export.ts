// 第三期：时间线导出运行时。把 buildTimelineRenderPlan 产出的步骤交给 runTimelineRenderPlan 在 ffmpeg.wasm 中执行，
// 复用 canvas-video-merge.ts 的 loadFFmpeg（本地同源加载 core/wasm），媒体读写与清理逻辑保持一致。
import { fetchFile } from "@ffmpeg/util";

import { loadFFmpeg } from "@/lib/canvas/canvas-video-merge";
import { getMediaBlob } from "@/services/file-storage";
import type { TimelineProject } from "@/types/timeline";
import { runTimelineRenderPlan, type TimelineExportProgress, type TimelineExportResult } from "./timeline-export-runner";
import { buildTimelineRenderPlan, type TimelineRenderContext, type TimelineRenderSource } from "./timeline-to-ffmpeg";

export type { TimelineExportProgress, TimelineExportResult } from "./timeline-export-runner";

export type TimelineExportOptions = {
    onProgress?: (progress: TimelineExportProgress) => void;
    context?: Partial<TimelineRenderContext>;
};

async function fetchSourceBlob(source: TimelineRenderSource): Promise<Blob> {
    if (source.storageKey) {
        const stored = await getMediaBlob(source.storageKey);
        if (stored) return stored;
    }
    if (source.url) {
        const response = await fetch(source.url);
        if (!response.ok) throw new Error("视频资源请求失败（" + response.status + "）");
        return response.blob();
    }
    throw new Error("找不到素材 " + source.nodeId + " 的媒体文件");
}

/** 导出时间线为 MP4：写媒体 → 按计划逐步执行 → 返回成片与降级提示（下载由调用方处理） */
export async function exportTimelineToMp4(timeline: TimelineProject, sources: TimelineRenderSource[], options: TimelineExportOptions = {}): Promise<TimelineExportResult> {
    const { onProgress, context } = options;
    onProgress?.({ phase: "loading", percent: 0, detail: "加载 FFmpeg" });
    const ffmpeg = await loadFFmpeg(({ phase, progress }) => onProgress?.({ phase: phase === "loading" ? "loading" : "reading", percent: progress, detail: phase === "loading" ? "加载 FFmpeg" : "读取素材" }));
    const plan = buildTimelineRenderPlan(timeline, sources, context);
    return runTimelineRenderPlan(ffmpeg, timeline, sources, plan, {
        readSource: async (source) => fetchFile(await fetchSourceBlob(source)),
        onProgress,
    });
}
