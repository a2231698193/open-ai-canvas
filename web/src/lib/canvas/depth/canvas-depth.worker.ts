/// <reference lib="webworker" />

// 深度推理放在 Worker 里，避免逐帧推理阻塞画布交互。
// 模型与 wasm 都是同源资产，不依赖 CDN；单线程 wasm，因为部署未开启 COOP/COEP，
// SharedArrayBuffer 不可用，多线程 wasm 会直接初始化失败。
// 吞吐靠多个 Worker 并行（见 depth-worker-pool.ts），而不是靠线程内多核。

import * as ort from "onnxruntime-web/wasm";
// 走包导出的子路径（不带 dist/），wasm 由 Vite 作为同源资产发出，不依赖 CDN。
import ortWasmURL from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

import { depthInputSize, normalizeDepthInput } from "./depth-model";

const MODEL_URL = "/depth/models/depth-anything-v2-small-quantized.onnx";

type WarmupRequest = { type: "warmup" };
type InferRequest = { type: "infer"; id: number; bitmap: ImageBitmap };
type DepthRequest = WarmupRequest | InferRequest;

type DepthResponse = {
    id: number;
    ready?: boolean;
    depth?: Float32Array;
    width?: number;
    height?: number;
    error?: string;
};

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession() {
    if (!sessionPromise) {
        ort.env.wasm.wasmPaths = { wasm: ortWasmURL };
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.simd = true;
        sessionPromise = ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] }).catch((error) => {
            sessionPromise = null;
            throw error;
        });
    }
    return sessionPromise;
}

/** 把位图缩到模型输入尺寸并取出像素。缩放交给 OffscreenCanvas，避免在 JS 里做重采样。 */
function readScaledPixels(bitmap: ImageBitmap) {
    const { width, height } = depthInputSize(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法创建深度推理画布");
    context.drawImage(bitmap, 0, 0, width, height);
    return { pixels: context.getImageData(0, 0, width, height).data, width, height };
}

self.onmessage = async (event: MessageEvent<DepthRequest>) => {
    const request = event.data;
    if (request.type === "warmup") {
        try {
            await getSession();
            self.postMessage({ id: 0, ready: true } satisfies DepthResponse);
        } catch (error) {
            self.postMessage({ id: 0, error: error instanceof Error ? error.message : "深度模型加载失败" } satisfies DepthResponse);
        }
        return;
    }

    const response: DepthResponse = { id: request.id };
    try {
        const session = await getSession();
        const input = readScaledPixels(request.bitmap);
        const tensor = new ort.Tensor("float32", normalizeDepthInput(input.pixels, input.width, input.height), [1, 3, input.height, input.width]);
        const output = await session.run({ pixel_values: tensor });
        const predicted = output.predicted_depth;
        if (!predicted) throw new Error("深度模型没有返回 predicted_depth");
        response.depth = predicted.data as Float32Array;
        response.width = Number(predicted.dims[2]);
        response.height = Number(predicted.dims[1]);
    } catch (error) {
        response.error = error instanceof Error ? error.message : "深度推理失败";
    } finally {
        request.bitmap.close();
    }
    self.postMessage(response, response.depth ? [response.depth.buffer] : []);
};

export {};
