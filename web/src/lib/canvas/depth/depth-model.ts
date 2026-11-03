// 单目深度估计的纯计算部分，便于单测；推理本身在 Worker 中完成。

/** DPT 系列的编码器按 14 像素下采样，输入宽高必须是 14 的整数倍。 */
export const DEPTH_MODEL_MULTIPLE = 14;

/** 训练分辨率。保持与模型预处理一致，不随视频尺寸变化。 */
export const DEPTH_MODEL_LONG_EDGE = 518;

/** ImageNet 归一化参数，与模型自带的 preprocessor_config.json 一致。 */
const IMAGE_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGE_STD = [0.229, 0.224, 0.225] as const;

export type DepthInputSize = { width: number; height: number };

function alignToMultiple(value: number, multiple: number) {
    return Math.max(multiple, Math.round(value / multiple) * multiple);
}

/**
 * 按长边 518、保持宽高比算出模型输入尺寸，并对齐到 14 的倍数。
 * 输出必然是正方形或扁平矩形，不会因为奇数长宽产生半像素。
 */
export function depthInputSize(width: number, height: number): DepthInputSize {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error("深度估计需要有效的画面尺寸");
    }
    const scale = DEPTH_MODEL_LONG_EDGE / Math.max(width, height);
    return {
        width: alignToMultiple(width * scale, DEPTH_MODEL_MULTIPLE),
        height: alignToMultiple(height * scale, DEPTH_MODEL_MULTIPLE),
    };
}

/**
 * RGBA 像素转成模型需要的 CHW Float32 张量（已归一化）。
 * 输入必须已经缩放到模型尺寸，缩放交给 canvas 做，避免在这里再实现一遍采样。
 */
export function normalizeDepthInput(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number): Float32Array {
    const expected = width * height * 4;
    if (pixels.length !== expected) {
        throw new Error(`深度输入像素尺寸不匹配：期望 ${expected}，实际 ${pixels.length}`);
    }
    const plane = width * height;
    const output = new Float32Array(plane * 3);
    for (let index = 0; index < plane; index += 1) {
        const source = index * 4;
        for (let channel = 0; channel < 3; channel += 1) {
            output[channel * plane + index] = (pixels[source + channel] / 255 - IMAGE_MEAN[channel]) / IMAGE_STD[channel];
        }
    }
    return output;
}

/**
 * 从抽样帧的深度值推导整段视频共用的近远端。
 *
 * 逐帧各自归一化会让每帧的最近点都变成纯白，深度视频会随镜头呼吸闪烁；
 * 因此这里用分位点一次性定标，整段复用（与预演台深度导出的固定米制范围同一思路）。
 */
export function depthRangeFromSamples(samples: ArrayLike<number>[], lowPercentile = 1, highPercentile = 99) {
    const values = samples.flatMap((sample) => Array.from(sample)).filter((value) => Number.isFinite(value));
    if (!values.length) throw new Error("没有可用于定标的深度采样");
    values.sort((left, right) => left - right);
    const at = (percentile: number) => values[Math.min(values.length - 1, Math.max(0, Math.round((percentile / 100) * (values.length - 1))))];
    const near = at(lowPercentile);
    const far = at(highPercentile);
    return { near, far: far > near ? far : near + 1e-6 };
}

/**
 * 把原始深度映射成 0–255 灰度：越近越白。
 * Depth Anything 输出的是相对深度，数值越大表示越近。
 */
export function applyDepthRange(depth: ArrayLike<number>, near: number, far: number): Uint8ClampedArray {
    if (!Number.isFinite(near) || !Number.isFinite(far) || far <= near) {
        throw new Error("深度范围必须满足 near < far");
    }
    const span = far - near;
    const output = new Uint8ClampedArray(depth.length);
    for (let index = 0; index < depth.length; index += 1) {
        const normalized = (Number(depth[index]) - near) / span;
        output[index] = Math.round(Math.min(1, Math.max(0, normalized)) * 255);
    }
    return output;
}

/**
 * 按平均池化把深度图缩到目标尺寸。
 *
 * 深度是连续量，不能像照片那样双三次插值——边缘会被插出并不存在的中间深度。
 * 池化只做平均，保持单调性，且不会在物体边界外扩。
 */
export function resampleDepth(depth: ArrayLike<number>, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): Float32Array {
    if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
        throw new Error("深度重采样尺寸无效");
    }
    const output = new Float32Array(targetWidth * targetHeight);
    const scaleX = sourceWidth / targetWidth;
    const scaleY = sourceHeight / targetHeight;
    for (let y = 0; y < targetHeight; y += 1) {
        const startY = Math.floor(y * scaleY);
        const endY = Math.max(startY + 1, Math.floor((y + 1) * scaleY));
        for (let x = 0; x < targetWidth; x += 1) {
            const startX = Math.floor(x * scaleX);
            const endX = Math.max(startX + 1, Math.floor((x + 1) * scaleX));
            let sum = 0;
            let count = 0;
            for (let sourceY = startY; sourceY < endY && sourceY < sourceHeight; sourceY += 1) {
                for (let sourceX = startX; sourceX < endX && sourceX < sourceWidth; sourceX += 1) {
                    sum += Number(depth[sourceY * sourceWidth + sourceX]);
                    count += 1;
                }
            }
            output[y * targetWidth + x] = count ? sum / count : 0;
        }
    }
    return output;
}
