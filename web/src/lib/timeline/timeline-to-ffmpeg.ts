// 第三期：时间线 → FFmpeg 命令序列的纯函数规划层。
// 不直接调用 FFmpeg，只产出可执行的参数计划，方便单测与运行时逐步执行；
// 运行时负责把媒体源写入 ffmpeg 工作区、写 SRT、执行 args 并清理文件。
// 数据流：TimelineProject + 节点媒体 → trim（按 sourceStart/sourceDuration 裁切）→ 黑场补齐空隙 → concat → 字幕 SRT → 烧录。

import { nanoid } from "nanoid";

import type { TimelineClip, TimelineProject } from "@/types/timeline";

export type TimelineRenderSource = {
    nodeId: string;
    /** 已写入 ffmpeg 工作区的文件名（如 input-0.mp4） */
    fileName: string;
    durationMs: number;
    /** 媒体定位（运行时用）：本地缓存 storageKey 或远程资源地址，至少提供一个 */
    storageKey?: string;
    url?: string;
    /** 源画面像素尺寸；未知时该片段按补黑边适配 */
    width?: number;
    height?: number;
};

/** 成片输出命令的一对参数：带 AIGC 元数据与不带元数据（ffmpeg 拒绝元数据参数时重试用）。 */
export type TimelineOutputArgs = {
    args: string[];
    argsWithoutMetadata: string[];
};

export type TimelineRenderStep = {
    kind: "trim" | "gap" | "concat" | "subtitle" | "burn";
    /** 本步骤输出文件名 */
    output: string;
    /** ffmpeg 参数数组（不含可执行文件名与 -y 覆盖参数） */
    args: string[];
    description: string;
    /** 该步骤依赖 libass（subtitles 滤镜）；当前 ffmpeg.wasm 内核可能不含，运行时需探测回退 */
    requiresLibass?: boolean;
    /** 成片输出步骤：去掉 AIGC 元数据参数的同一命令 */
    argsWithoutMetadata?: string[];
    /** burn 步骤：字幕滤镜不可用时改用的无字幕输出命令 */
    fallback?: TimelineOutputArgs & { description: string };
};

export type TimelineRenderContext = {
    width: number;
    height: number;
    fps: number;
    /** 是否烧录字幕；false 时跳过 burn 步骤 */
    burnSubtitles: boolean;
    /** 最终输出文件名 */
    outputName: string;
    /** 隐式标识里的传播编号（PropagateID）；缺省时每次规划生成一个 */
    propagateId?: string;
};

export type TimelineRenderPlan = {
    steps: TimelineRenderStep[];
    finalOutput: string;
    /** concat 输入文件列表（trim/gap 输出），运行时据此写 concat.txt */
    concatEntries: string[];
    /** 实际使用的输出规格（宽高已取偶数） */
    target: { width: number; height: number; fps: number };
};

export const SUBTITLE_FILE = "timeline.srt";

/**
 * 隐式标识中的传播服务提供者编码（GB 45438 ContentPropagator）。
 * 占位值：部署方必须替换为自己在主管部门登记的服务提供者编码，后端合成使用同一常量语义。
 */
export const TIMELINE_AIGC_PLATFORM = "yingce";

/** 源与目标宽高比的相对差不超过该值时裁切填满，否则补黑边（与后端合成规则一致）。 */
export const TIMELINE_FIT_ASPECT_TOLERANCE = 0.03;

export type TimelineFitMode = "crop" | "pad";

type FrameSize = { width?: number; height?: number };

/** libx264 + yuv420p 要求宽高为偶数。 */
export function evenDimension(value: number): number {
    return Math.max(2, Math.round(value / 2) * 2);
}

export function timelineClipFitMode(source: FrameSize, target: { width: number; height: number }): TimelineFitMode {
    if (!source.width || !source.height || source.width <= 0 || source.height <= 0) return "pad";
    // 与后端 renderSegmentFit 同一算式 |源宽高比 ÷ 目标宽高比 − 1|，浮点边界上两端判定一致。
    const ratio = source.width / source.height / (target.width / target.height);
    return Math.abs(ratio - 1) <= TIMELINE_FIT_ASPECT_TOLERANCE ? "crop" : "pad";
}

/** 单个片段统一到目标画幅的视频滤镜：近似同比例裁切填满，否则等比缩放补黑边；再统一 SAR 与帧率。 */
export function buildTimelineFitFilter(source: FrameSize, target: { width: number; height: number }, fps: number): string {
    const { width, height } = target;
    const fit =
        timelineClipFitMode(source, target) === "crop"
            ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
            : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
    return `${fit},setsar=1,fps=${fps}`;
}

/** GB 45438 隐式标识字段（字段名与顺序按标准；生成方字段留空，由后端或运营方补齐）。 */
export function buildTimelineAigcLabel(propagateId: string): string {
    return JSON.stringify({
        Label: "1",
        ContentProducer: "",
        ProduceID: "",
        ReservedCode1: "",
        ContentPropagator: TIMELINE_AIGC_PLATFORM,
        PropagateID: propagateId,
        ReservedCode2: "",
    });
}

/** 成片元数据参数：丢弃源文件继承的全局元数据，写入 AIGC 隐式标识与来源说明。 */
export function buildTimelineProvenanceArgs(propagateId: string, sourceClipCount: number): string[] {
    return ["-map_metadata", "-1", "-movflags", "+faststart+use_metadata_tags", "-metadata", `AIGC=${buildTimelineAigcLabel(propagateId)}`, "-metadata", `comment=影策时间线合成；来源片段：${sourceClipCount} 个`];
}

function outputArgs(head: string[], provenance: string[], output: string): TimelineOutputArgs {
    return { args: [...head, ...provenance, output], argsWithoutMetadata: [...head, output] };
}

export function getOrderedVideoClips(timeline: TimelineProject): TimelineClip[] {
    return timeline.clips
        .filter((clip) => clip.kind === "video")
        .slice()
        .sort((a, b) => a.startMs - b.startMs || a.trackId.localeCompare(b.trackId));
}

export function getOrderedSubtitleClips(timeline: TimelineProject): TimelineClip[] {
    return timeline.clips
        .filter((clip) => clip.kind === "subtitle")
        .slice()
        .sort((a, b) => a.startMs - b.startMs || a.trackId.localeCompare(b.trackId));
}

/** 毫秒 → SRT 时间码 hh:mm:ss,mmm */
export function formatSrtTimestamp(ms: number): string {
    const safe = Math.max(0, Math.round(ms));
    const pad = (value: number, length = 2) => String(value).padStart(length, "0");
    const hours = Math.floor(safe / 3_600_000);
    const minutes = Math.floor((safe % 3_600_000) / 60_000);
    const seconds = Math.floor((safe % 60_000) / 1_000);
    const millis = safe % 1_000;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/** 字幕轨片段 → SRT 文件内容（时间线全局时间，直接用于烧录） */
export function buildSubtitleSrt(clips: TimelineClip[]): string {
    return getOrderedSubtitleClips({ version: 2, tracks: [], clips, durationMs: 0 })
        .filter((clip) => clip.text && clip.durationMs > 0)
        .map((clip, index) => {
            const text = (clip.text || "").replace(/\r?\n/g, " ").trim();
            return [String(index + 1), `${formatSrtTimestamp(clip.startMs)} --> ${formatSrtTimestamp(clip.startMs + clip.durationMs)}`, text].join("\n");
        })
        .join("\n\n");
}

function defaultContext(): TimelineRenderContext {
    return { width: 1920, height: 1080, fps: 30, burnSubtitles: true, outputName: "export.mp4" };
}

/**
 * 生成导出计划。
 * 视频轨按 startMs 顺序裁切并补齐空隙（lavfi 黑场 + 静音），最后 concat；
 * 字幕轨独立生成 SRT 并在末步烧录（libass 滤镜），音频轨暂按现有音频片段拼接（第三期迭代）。
 */
export function buildTimelineRenderPlan(timeline: TimelineProject, sources: TimelineRenderSource[], context: Partial<TimelineRenderContext> = {}): TimelineRenderPlan {
    const merged: TimelineRenderContext = { ...defaultContext(), ...context };
    const cfg: TimelineRenderContext = { ...merged, width: evenDimension(merged.width), height: evenDimension(merged.height) };
    const target = { width: cfg.width, height: cfg.height };
    const sourceByNode = new Map(sources.map((item) => [item.nodeId, item]));
    const steps: TimelineRenderStep[] = [];
    const concatEntries: string[] = [];
    const videoClips = getOrderedVideoClips(timeline);

    // 1)+2) 逐片段裁切，并按时间线顺序在片段前补黑场（含静音音轨），输出统一编码便于 concat。
    // 黑场必须插入对应片段之前的 concat 位置：concat 按列表顺序拼接，若先收完所有 trim 再把 gap 追加到
    // 结尾，任何存在空隙的时间线（如 A(0-15s) 与 B(25-40s) 之间的 10s）都会把黑场拼到片尾、字幕整体错位。
    // 无源片段（如节点已被删除）既不产 trim 也不补自己的黑场，直接跳过：cursor 不推进，其跨度由下一个
    // 有源片段前的单个 gap 统一覆盖。若先为无源片段补 gap 再等 cursor，同一段空隙会被重复计长、成片超长
    // （线上实锤：缺源片段前有空隙时黑场翻倍、字幕继续漂移）。
    let cursorMs = 0;
    videoClips.forEach((clip, index) => {
        const source = sourceByNode.get(clip.nodeId);
        if (!source) return;
        const gapMs = clip.startMs - cursorMs;
        if (gapMs > 100) {
            const output = `gap-${index}.mp4`;
            const durationSec = gapMs / 1000;
            steps.push({
                kind: "gap",
                output,
                args: [
                    "-f",
                    "lavfi",
                    "-i",
                    `color=c=black:s=${cfg.width}x${cfg.height}:r=${cfg.fps}:d=${durationSec}`,
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=r=44100:cl=stereo",
                    "-t",
                    String(durationSec),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "20",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-shortest",
                    output,
                ],
                description: `补黑场 ${(gapMs / 1000).toFixed(2)}s`,
            });
            concatEntries.push(output);
        }
        const output = `trim-${index}.mp4`;
        // 裁切时长取时间线片段时长（clip.durationMs），而不是源素材剩余时长：
        // 左缘裁剪后 sourceStartMs 前移但 sourceDurationMs 仍为源全长，若按源时长 -t 会把旧片段尾部多裁出来，
        // 表现为「裁剪后播放仍从最原始视频开始/出现旧片段」；-ss 已定位源内起点，-t 必须等于片段展示时长。
        // -ss 必须放在 -i 之后（输出 seek）：放在 -i 之前是输入 seek，MP4/H.264 只会定位到目标时间戳
        // 之前最近的关键帧，切点会偏移最多一个 GOP（常见 0.5-2s）、片尾被 -t 截掉、音视频在切点处错位。
        // 本步骤已 -c:v libx264 重编码，输出 seek 帧精确，代价只是多解码。
        // 每段在这里统一到目标宽高/SAR/帧率：concat 要求各段规格一致，否则成片沿用首段尺寸或直接拼接失败。
        const durationSec = Math.max(0.1, clip.durationMs / 1000);
        steps.push({
            kind: "trim",
            output,
            args: [
                "-i",
                source.fileName,
                "-ss",
                String((clip.sourceStartMs || 0) / 1000),
                "-t",
                String(durationSec),
                "-vf",
                buildTimelineFitFilter(source, target, cfg.fps),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                output,
            ],
            description: `裁切片段 ${index + 1}（${clip.title || clip.nodeId}）`,
        });
        concatEntries.push(output);
        cursorMs = clip.startMs + clip.durationMs;
    });

    // 3) concat 拼接视频轨。
    const concatOutput = "timeline-video.mp4";
    if (concatEntries.length) {
        steps.push({
            kind: "concat",
            output: concatOutput,
            args: ["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", concatOutput],
            description: "拼接视频轨",
        });
    }

    // 4) 字幕轨 → SRT 内容（运行时写入 SUBTITLE_FILE）。
    const subtitleClips = getOrderedSubtitleClips(timeline);
    if (cfg.burnSubtitles && subtitleClips.some((clip) => clip.text)) {
        steps.push({
            kind: "subtitle",
            output: SUBTITLE_FILE,
            args: [],
            description: "生成字幕 SRT",
        });
    }

    // 5) 烧录字幕并输出最终文件（subtitles 滤镜需要 libass）；成片步骤统一写入 AIGC 隐式标识。
    const finalOutput = cfg.outputName;
    const sourceClipCount = steps.filter((step) => step.kind === "trim").length;
    const provenance = buildTimelineProvenanceArgs(cfg.propagateId || nanoid(), sourceClipCount);
    const copyOutput = outputArgs(["-i", concatOutput, "-c", "copy"], provenance, finalOutput);
    if (concatEntries.length && steps.some((step) => step.kind === "subtitle")) {
        const burnOutput = outputArgs(["-i", concatOutput, "-vf", `subtitles=${SUBTITLE_FILE}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy"], provenance, finalOutput);
        steps.push({
            kind: "burn",
            output: finalOutput,
            ...burnOutput,
            description: "烧录字幕并输出",
            requiresLibass: true,
            fallback: { ...copyOutput, description: "输出成片（字幕烧录不可用）" },
        });
    } else if (concatEntries.length) {
        steps.push({
            kind: "concat",
            output: finalOutput,
            ...copyOutput,
            description: "输出成片（无字幕）",
        });
    }

    return { steps, finalOutput, concatEntries, target: { ...target, fps: cfg.fps } };
}

/** 供导出对话框/文档展示的人类可读命令预览 */
export function describeRenderPlan(plan: TimelineRenderPlan): string {
    return plan.steps.map((step) => `# ${step.description}\nffmpeg -y ${step.args.join(" ")}`).join("\n\n");
}
