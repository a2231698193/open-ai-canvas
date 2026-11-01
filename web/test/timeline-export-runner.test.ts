import { describe, expect, test } from "bun:test";

import { TIMELINE_METADATA_UNAVAILABLE_WARNING, TIMELINE_SUBTITLE_UNAVAILABLE_WARNING, runTimelineRenderPlan, type TimelineFFmpeg } from "../src/lib/timeline/timeline-export-runner";
import { buildTimelineRenderPlan, type TimelineRenderSource } from "../src/lib/timeline/timeline-to-ffmpeg";
import type { TimelineClip, TimelineProject } from "../src/types/timeline";

type ExecRule = (args: string[]) => { exitCode: number; log?: string } | undefined;

/** 假 ffmpeg：按规则决定每条命令的退出码与日志，记录执行过的命令。 */
function fakeFFmpeg(rule: ExecRule) {
    const files = new Map<string, Uint8Array | string>();
    const listeners = new Set<(event: { message: string }) => void>();
    const executed: string[][] = [];
    const ffmpeg: TimelineFFmpeg = {
        writeFile: async (path, data) => void files.set(path, data),
        readFile: async (path) => {
            const file = files.get(path);
            if (file === undefined) throw new Error("missing " + path);
            return file;
        },
        deleteFile: async (path) => void files.delete(path),
        exec: async (args) => {
            executed.push(args);
            const result = rule(args) || { exitCode: 0 };
            if (result.log) listeners.forEach((listener) => listener({ message: result.log! }));
            if (result.exitCode === 0) files.set(args[args.length - 1], new Uint8Array([1, 2, 3]));
            return result.exitCode;
        },
        on: (_event, callback) => void listeners.add(callback),
        off: (_event, callback) => void listeners.delete(callback),
    };
    return { ffmpeg, executed };
}

const clips: TimelineClip[] = [
    { id: "v", kind: "video", nodeId: "a", trackId: "video", startMs: 0, durationMs: 3_000, title: "a", sourceStartMs: 0, sourceDurationMs: 3_000 },
    { id: "s", kind: "subtitle", nodeId: "a", trackId: "subtitle", startMs: 0, durationMs: 1_000, title: "你好", text: "你好" },
];
const timeline: TimelineProject = { version: 2, tracks: [], clips, durationMs: 3_000 };
const sources: TimelineRenderSource[] = [{ nodeId: "a", fileName: "input-0.mp4", durationMs: 3_000, url: "file:///a.mp4", width: 1080, height: 1920 }];
const plan = buildTimelineRenderPlan(timeline, sources, { width: 1080, height: 1920, fps: 30, outputName: "out.mp4", propagateId: "p" });
const readSource = async () => new Uint8Array([0]);
const isBurn = (args: string[]) => args.includes("subtitles=timeline.srt");
const hasMetadata = (args: string[]) => args.includes("-metadata");

describe("runTimelineRenderPlan 字幕烧录与元数据降级", () => {
    test("全部成功：字幕已烧录、无警告", async () => {
        const { ffmpeg } = fakeFFmpeg(() => undefined);
        const result = await runTimelineRenderPlan(ffmpeg, timeline, sources, plan, { readSource });
        expect(result.subtitlesBurned).toBe(true);
        expect(result.warnings).toEqual([]);
        expect(result.blob.size).toBe(3);
    });

    test("烧录步骤因缺少 subtitles 滤镜返回 1：回退无字幕输出并报告警告，不算成功烧录", async () => {
        const { ffmpeg, executed } = fakeFFmpeg((args) => (isBurn(args) ? { exitCode: 1, log: "[AVFilterGraph @ 0x1] No such filter: 'subtitles'" } : undefined));
        const result = await runTimelineRenderPlan(ffmpeg, timeline, sources, plan, { readSource });
        expect(result.subtitlesBurned).toBe(false);
        expect(result.warnings).toEqual([TIMELINE_SUBTITLE_UNAVAILABLE_WARNING]);
        const last = executed.at(-1)!;
        expect(last).toContain("copy");
        expect(hasMetadata(last)).toBe(true);
    });

    test("烧录步骤因其他原因失败：直接报错，不静默回退", async () => {
        const { ffmpeg, executed } = fakeFFmpeg((args) => (isBurn(args) ? { exitCode: 1, log: "Aborted(OOM)" } : undefined));
        await expect(runTimelineRenderPlan(ffmpeg, timeline, sources, plan, { readSource })).rejects.toThrow("烧录字幕并输出");
        expect(executed.some((args) => args.includes("copy") && !isBurn(args))).toBe(false);
    });

    test("非烧录步骤失败照常报错", async () => {
        const { ffmpeg } = fakeFFmpeg((args) => (args.includes("trim-0.mp4") ? { exitCode: 1 } : undefined));
        await expect(runTimelineRenderPlan(ffmpeg, timeline, sources, plan, { readSource })).rejects.toThrow("裁切片段 1");
    });

    test("ffmpeg 拒绝元数据参数：去掉元数据重试成功，成片可用并报告警告", async () => {
        const { ffmpeg, executed } = fakeFFmpeg((args) => (hasMetadata(args) ? { exitCode: 1, log: "Unrecognized option 'movflags'" } : undefined));
        const result = await runTimelineRenderPlan(ffmpeg, timeline, sources, plan, { readSource });
        expect(result.subtitlesBurned).toBe(true);
        expect(result.warnings).toEqual([TIMELINE_METADATA_UNAVAILABLE_WARNING]);
        expect(isBurn(executed.at(-1)!) && !hasMetadata(executed.at(-1)!)).toBe(true);
    });

    test("字幕与元数据都不可用：两条警告都报告", async () => {
        const { ffmpeg } = fakeFFmpeg((args) => {
            if (isBurn(args)) return { exitCode: 1, log: "Error initializing filter 'subtitles'" };
            if (hasMetadata(args)) return { exitCode: 1 };
            return undefined;
        });
        const result = await runTimelineRenderPlan(ffmpeg, timeline, sources, plan, { readSource });
        expect(result.subtitlesBurned).toBe(false);
        expect(result.warnings).toEqual([TIMELINE_SUBTITLE_UNAVAILABLE_WARNING, TIMELINE_METADATA_UNAVAILABLE_WARNING]);
    });
});
