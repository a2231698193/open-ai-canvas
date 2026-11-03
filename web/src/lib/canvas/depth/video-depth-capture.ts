/** 视频 → 深度视频的完整管道。
 *
 * 流程：读源视频 → 抽样帧定标（整段共用一组近远端）→ 并行逐帧估深 → WebCodecs 编码 H.264 → mp4-muxer 封装。
 *
 * 关键取舍：
 * - 深度范围整段共用，不逐帧归一化，否则每帧最近点都变成纯白，视频会随镜头呼吸闪烁。
 * - 编码走 WebCodecs + mp4-muxer：wasm 版 ffmpeg 在本项目是单线程构建，
 *   实测 1376×768 下无法在合理时间内跑完 277 帧；WebCodecs 实测 2.8 秒。
 * - 输出静音：深度片是给模型或剪辑做空间参考的数据 pass，音轨没有意义。
 */

import { ArrayBufferTarget, Muxer } from "mp4-muxer";

import { applyDepthRange, depthRangeFromSamples, resampleDepth } from "./depth-model";
import { DepthWorkerPool, type DepthFrame } from "./depth-worker-pool";

export type DepthCapturePhase = "loading" | "calibrating" | "processing" | "encoding";

export type DepthCaptureProgress = {
    phase: DepthCapturePhase;
    done: number;
    total: number;
};

export type DepthCaptureOptions = {
    signal?: AbortSignal;
    /** 源帧率；上传时未记录，缺省按 24 处理。 */
    frameRate?: number;
    onProgress?: (progress: DepthCaptureProgress) => void;
};

/** 定标抽样帧数；再多也不会改善分位点估计，只会拖慢开始时间。 */
const CALIBRATION_SAMPLES = 24;

/** 同时挂在管道上的帧数上限，限制位图与深度结果的内存峰值。 */
const FRAME_WINDOW = 12;

/** 实测 macOS Chrome 只接受 High Profile（Level 3.0 的编码面积上限撑不下 1376×768）。 */
const H264_CODEC = "avc1.640028";

const DEFAULT_FRAME_RATE = 24;

export async function captureVideoDepth(source: Blob, options: DepthCaptureOptions = {}): Promise<Blob> {
    const { signal, onProgress } = options;
    if (typeof OffscreenCanvas === "undefined") throw new Error("当前浏览器不支持深度捕捉所需的离屏画布");
    if (typeof VideoEncoder === "undefined") throw new Error("当前浏览器不支持视频编码，请使用 Chrome 或 Edge");

    const video = await openVideo(source, signal);
    const frameRate = options.frameRate && Number.isFinite(options.frameRate) && options.frameRate > 0 ? options.frameRate : DEFAULT_FRAME_RATE;
    const total = Math.max(1, Math.round(video.duration * frameRate));
    const report = (phase: DepthCapturePhase, done = 0) => onProgress?.({ phase, done, total });

    const pool = new DepthWorkerPool();
    const abort = () => pool.dispose();
    signal?.addEventListener("abort", abort, { once: true });

    try {
        report("loading");
        await pool.warmup();
        throwIfAborted(signal);

        const workCanvas = new OffscreenCanvas(video.width, video.height);
        const workContext = required2d(workCanvas, "无法创建深度推理画布");
        const readFrame = async (index: number): Promise<DepthFrame> => {
            throwIfAborted(signal);
            await seekVideo(video.element, index / frameRate);
            workContext.drawImage(video.element, 0, 0, video.width, video.height);
            const bitmap = await createImageBitmap(workCanvas);
            return pool.infer(bitmap);
        };

        // 1) 定标：均匀抽若干帧估深，用分位点求整段共用的近远端。
        report("calibrating");
        const sampleDepths: Float32Array[] = [];
        for (let index = 0; index < CALIBRATION_SAMPLES; index += 1) {
            const time = (index / CALIBRATION_SAMPLES) * video.duration;
            throwIfAborted(signal);
            await seekVideo(video.element, time);
            workContext.drawImage(video.element, 0, 0, video.width, video.height);
            sampleDepths.push((await pool.infer(await createImageBitmap(workCanvas))).depth);
            report("calibrating", index + 1);
        }
        const range = depthRangeFromSamples(sampleDepths);

        // 2) 编码器与封装器。编码错误先落到变量上，在循环里检查，避免在回调里抛出被吞掉。
        let encoderError: Error | null = null;
        const muxer = new Muxer({
            target: new ArrayBufferTarget(),
            video: { codec: "avc", width: video.width, height: video.height },
            fastStart: "in-memory",
        });
        const encoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: (error) => {
                encoderError = error instanceof Error ? error : new Error("视频编码失败");
            },
        });
        encoder.configure({
            codec: H264_CODEC,
            width: video.width,
            height: video.height,
            bitrate: encoderBitrate(video.width, video.height),
            framerate: frameRate,
        });

        // 3) 逐帧：解码 → 估深 → 映射 → 编码，并发保持在固定窗口内。
        report("processing");
        const frameDurationMicros = Math.round(1_000_000 / frameRate);
        const keyframeInterval = Math.max(1, Math.round(frameRate * 2));
        const outputCanvas = new OffscreenCanvas(video.width, video.height);
        const outputContext = required2d(outputCanvas, "无法创建深度输出画布");

        const inFlight: Array<Promise<DepthFrame>> = [];
        let nextToStart = 0;
        const startNext = () => {
            inFlight.push(readFrame(nextToStart));
            nextToStart += 1;
        };
        while (nextToStart < Math.min(FRAME_WINDOW, total)) startNext();

        try {
            for (let index = 0; index < total; index += 1) {
                if (encoderError) throw encoderError;
                const frame = await inFlight.shift()!;
                if (nextToStart < total) startNext();

                drawDepthFrame(outputContext, frame, range, video.width, video.height);
                const videoFrame = new VideoFrame(outputCanvas, { timestamp: index * frameDurationMicros, duration: frameDurationMicros });
                encoder.encode(videoFrame, { keyFrame: index % keyframeInterval === 0 });
                videoFrame.close();
                report("processing", index + 1);
                // 让出主线程：保证取消能及时生效，也给编码器回压的机会。
                if ((index + 1) % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
            }

            report("encoding", total);
            await encoder.flush();
            if (encoderError) throw encoderError;
        } finally {
            if (encoder.state !== "closed") encoder.close();
            // 未消费的帧也要放掉，否则取消后会留下悬挂的 Worker 任务。
            inFlight.forEach((pending) => void pending.catch(() => undefined));
        }

        muxer.finalize();
        const buffer = (muxer.target as ArrayBufferTarget).buffer;
        if (!buffer) throw new Error("深度视频封装失败");
        return new Blob([buffer], { type: "video/mp4" });
    } finally {
        signal?.removeEventListener("abort", abort);
        pool.dispose();
        video.dispose();
    }
}

/** 把深度帧画成近白远黑的灰度图。 */
function drawDepthFrame(context: OffscreenCanvasRenderingContext2D, frame: DepthFrame, range: { near: number; far: number }, width: number, height: number) {
    const scaled = resampleDepth(frame.depth, frame.width, frame.height, width, height);
    const gray = applyDepthRange(scaled, range.near, range.far);
    const image = context.createImageData(width, height);
    for (let index = 0; index < gray.length; index += 1) {
        const value = gray[index];
        const offset = index * 4;
        image.data[offset] = value;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value;
        image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
}

function encoderBitrate(width: number, height: number) {
    // 深度图信息量远低于照片，但物体边缘是主要可见特征，给到 0.12 bit/px。
    return Math.max(2_000_000, Math.round(width * height * 0.12));
}

function required2d(canvas: OffscreenCanvas, message: string) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error(message);
    return context;
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("深度捕捉已取消", "AbortError");
}

type OpenedVideo = {
    element: HTMLVideoElement;
    width: number;
    height: number;
    duration: number;
    dispose: () => void;
};

/** 打开源视频并统一成可 seek 的元素；对象 URL 与元素一起释放。 */
async function openVideo(source: Blob, signal?: AbortSignal): Promise<OpenedVideo> {
    const url = URL.createObjectURL(source);
    const element = document.createElement("video");
    element.muted = true;
    element.playsInline = true;
    element.preload = "auto";
    const dispose = () => {
        element.pause();
        element.removeAttribute("src");
        element.load();
        URL.revokeObjectURL(url);
    };
    try {
        await new Promise<void>((resolve, reject) => {
            const onAbort = () => reject(new DOMException("深度捕捉已取消", "AbortError"));
            element.addEventListener(
                "loadeddata",
                () => {
                    signal?.removeEventListener("abort", onAbort);
                    resolve();
                },
                { once: true },
            );
            element.addEventListener("error", () => reject(new Error("无法读取视频，请确认格式受浏览器支持")), { once: true });
            signal?.addEventListener("abort", onAbort, { once: true });
            element.src = url;
            element.load();
        });
        if (!element.videoWidth || !element.videoHeight) throw new Error("无法读取视频画面尺寸");
        if (!Number.isFinite(element.duration) || element.duration <= 0) throw new Error("无法确定视频时长");
        return { element, width: element.videoWidth, height: element.videoHeight, duration: element.duration, dispose };
    } catch (error) {
        dispose();
        throw error;
    }
}

/** 定位到指定秒；已落在目标位置时直接返回，避免无谓的 seek 往返。 */
function seekVideo(element: HTMLVideoElement, seconds: number) {
    return new Promise<void>((resolve, reject) => {
        const target = Math.min(Math.max(0, seconds), Math.max(0, element.duration - 0.001));
        if (Math.abs(element.currentTime - target) < 0.0005) {
            resolve();
            return;
        }
        const onSeeked = () => {
            window.clearTimeout(timer);
            resolve();
        };
        const timer = window.setTimeout(() => {
            element.removeEventListener("seeked", onSeeked);
            reject(new Error("视频定位超时"));
        }, 20_000);
        element.addEventListener("seeked", onSeeked, { once: true });
        element.currentTime = target;
    });
}
