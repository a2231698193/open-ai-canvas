// 时间线导出执行器：按 buildTimelineRenderPlan 的步骤在 ffmpeg 实例中执行。
// ffmpeg 与素材读取由调用方注入（timeline-export.ts 接 ffmpeg.wasm），这里不依赖浏览器加载逻辑，便于单测。
import type { TimelineProject } from "@/types/timeline";
import { SUBTITLE_FILE, buildSubtitleSrt, getOrderedSubtitleClips, type TimelineRenderPlan, type TimelineRenderSource } from "./timeline-to-ffmpeg";

export type TimelineExportProgress = {
    phase: "loading" | "reading" | "encoding";
    percent: number;
    detail: string;
};

export type TimelineExportResult = {
    blob: Blob;
    /** 字幕已烧录进画面；没有字幕或烧录不可用时为 false */
    subtitlesBurned: boolean;
    /** 成片仍可用但与预期不一致的地方（字幕未烧录、元数据未写入），调用方必须展示 */
    warnings: string[];
};

type LogListener = (event: { message: string }) => void;

/** ffmpeg.wasm FFmpeg 实例中执行导出所需的最小接口。 */
export type TimelineFFmpeg = {
    writeFile(path: string, data: Uint8Array | string): Promise<unknown>;
    readFile(path: string): Promise<Uint8Array | string>;
    deleteFile(path: string): Promise<unknown>;
    exec(args: string[]): Promise<number>;
    on(event: "log", callback: LogListener): void;
    off(event: "log", callback: LogListener): void;
};

export const TIMELINE_SUBTITLE_UNAVAILABLE_WARNING = "当前 FFmpeg 不支持字幕烧录，成片未包含字幕，可单独下载 SRT";
export const TIMELINE_METADATA_UNAVAILABLE_WARNING = "当前 FFmpeg 不支持写入 AIGC 标识元数据，成片未携带隐式标识";

// burn 步骤的 -vf 只有 subtitles 一个滤镜，滤镜图初始化失败即可判定为字幕能力缺失（无 libass / 无法打开 SRT）。
const SUBTITLE_FILTER_UNAVAILABLE = /No such filter:\s*'?subtitles|Filter not found|libass|Error (?:initializing|opening|reinitializing) filters?|Unable to open timeline\.srt|Error initializing filter 'subtitles'/i;

export function isSubtitleFilterUnavailable(logs: string[]): boolean {
    return SUBTITLE_FILTER_UNAVAILABLE.test(logs.join("\n"));
}

async function execWithLogs(ffmpeg: TimelineFFmpeg, args: string[]): Promise<{ exitCode: number; logs: string[] }> {
    const logs: string[] = [];
    const onLog: LogListener = ({ message }) => {
        if (message) logs.push(message);
    };
    ffmpeg.on("log", onLog);
    try {
        return { exitCode: await ffmpeg.exec(["-y", ...args]), logs };
    } finally {
        ffmpeg.off("log", onLog);
    }
}

/** 成片输出：先带元数据执行；失败时去掉元数据再试一次，成功则记录警告。 */
async function execOutput(ffmpeg: TimelineFFmpeg, args: string[], argsWithoutMetadata: string[] | undefined, warnings: string[]) {
    const first = await execWithLogs(ffmpeg, args);
    if (first.exitCode === 0 || !argsWithoutMetadata) return first;
    const retry = await execWithLogs(ffmpeg, argsWithoutMetadata);
    if (retry.exitCode === 0 && !warnings.includes(TIMELINE_METADATA_UNAVAILABLE_WARNING)) warnings.push(TIMELINE_METADATA_UNAVAILABLE_WARNING);
    return { exitCode: retry.exitCode, logs: [...first.logs, ...retry.logs] };
}

export async function runTimelineRenderPlan(
    ffmpeg: TimelineFFmpeg,
    timeline: TimelineProject,
    sources: TimelineRenderSource[],
    plan: TimelineRenderPlan,
    options: { readSource: (source: TimelineRenderSource) => Promise<Uint8Array>; onProgress?: (progress: TimelineExportProgress) => void },
): Promise<TimelineExportResult> {
    const { readSource, onProgress } = options;
    const writtenFiles = new Set<string>();
    const warnings: string[] = [];
    let subtitlesBurned = false;

    try {
        for (const source of sources) {
            onProgress?.({ phase: "reading", percent: 5, detail: "读取素材 " + source.fileName });
            await ffmpeg.writeFile(source.fileName, await readSource(source));
            writtenFiles.add(source.fileName);
        }

        const executableSteps = plan.steps.filter((step) => step.kind !== "subtitle");
        let stepIndex = 0;
        for (const step of plan.steps) {
            if (step.kind === "subtitle") {
                const srt = buildSubtitleSrt(getOrderedSubtitleClips(timeline));
                if (srt) {
                    await ffmpeg.writeFile(SUBTITLE_FILE, new TextEncoder().encode(srt));
                    writtenFiles.add(SUBTITLE_FILE);
                }
                continue;
            }
            if (step.args.includes("concat.txt")) {
                const content = plan.concatEntries.map((file) => "file '" + file + "'").join("\n");
                await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(content));
                writtenFiles.add("concat.txt");
            }
            onProgress?.({ phase: "encoding", percent: Math.round(10 + (stepIndex / Math.max(1, executableSteps.length)) * 75), detail: step.description });

            if (step.kind === "burn") {
                const burned = await execOutput(ffmpeg, step.args, step.argsWithoutMetadata, warnings);
                if (burned.exitCode === 0) {
                    subtitlesBurned = true;
                } else if (step.fallback && isSubtitleFilterUnavailable(burned.logs)) {
                    warnings.push(TIMELINE_SUBTITLE_UNAVAILABLE_WARNING);
                    onProgress?.({ phase: "encoding", percent: 92, detail: "字幕烧录不可用，改为输出无字幕成片" });
                    const copied = await execOutput(ffmpeg, step.fallback.args, step.fallback.argsWithoutMetadata, warnings);
                    if (copied.exitCode !== 0) throw new Error("导出失败：字幕烧录不可用，无字幕输出也失败");
                } else {
                    throw new Error("导出失败：" + step.description + "（FFmpeg 退出码 " + burned.exitCode + "）");
                }
            } else if (step.argsWithoutMetadata) {
                const result = await execOutput(ffmpeg, step.args, step.argsWithoutMetadata, warnings);
                if (result.exitCode !== 0) throw new Error("导出失败：" + step.description);
            } else {
                const { exitCode } = await execWithLogs(ffmpeg, step.args);
                if (exitCode !== 0) throw new Error("导出失败：" + step.description);
            }
            writtenFiles.add(step.output);
            stepIndex += 1;
        }

        const output = await ffmpeg.readFile(plan.finalOutput);
        onProgress?.({ phase: "encoding", percent: 100, detail: warnings.length ? "导出完成（有提示）" : "导出完成" });
        return { blob: new Blob([output as BlobPart], { type: "video/mp4" }), subtitlesBurned, warnings };
    } finally {
        await Promise.all([...writtenFiles, "concat.txt", plan.finalOutput].map((file) => ffmpeg.deleteFile(file).catch(() => undefined)));
    }
}
