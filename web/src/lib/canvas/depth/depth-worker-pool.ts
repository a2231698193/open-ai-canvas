/** 逐帧深度推理的 Worker 池。
 *
 * 单个 wasm 会话在 518 宽下约 1 秒/帧，串行处理一段 11 秒视频要 5 分钟；
 * 实测 6–8 个 Worker 并行可把每帧摊到 64–78ms，因此这里按并发数各起一个会话。
 * 每个 Worker 自持一份 session，避免跨线程共享推理状态。
 */

export type DepthFrame = { id: number; depth: Float32Array; width: number; height: number };

export type DepthWorkerPoolOptions = {
    /** 并发 Worker 数，默认为可用核心数的一半（留出主线程与解码开销）。 */
    concurrency?: number;
    /** 模型下载与初始化完成的回调，用于显示“首次加载模型”。 */
    onReady?: () => void;
};

const DEFAULT_MAX_CONCURRENCY = 6;

type PendingDepth = {
    resolve: (frame: DepthFrame) => void;
    reject: (error: Error) => void;
};

export class DepthWorkerPool {
    private workers: Worker[] = [];
    private pending = new Map<number, PendingDepth>();
    private queue: Array<{ id: number; bitmap: ImageBitmap }> = [];
    private idle: Worker[] = [];
    private active = new Set<Worker>();
    private nextId = 1;
    private failed: Error | null = null;

    constructor(private readonly options: DepthWorkerPoolOptions = {}) {}

    /** 预热：提前拉模型并启动全部 Worker，让首帧不必等下载。 */
    async warmup() {
        this.ensureWorkers();
    }

    get concurrency() {
        const requested = this.options.concurrency ?? Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2));
        return Math.max(1, Math.min(requested, DEFAULT_MAX_CONCURRENCY));
    }

    /** 对一帧估深。位图所有权转移给 Worker。 */
    infer(bitmap: ImageBitmap): Promise<DepthFrame> {
        if (this.failed) {
            bitmap.close();
            return Promise.reject(this.failed);
        }
        this.ensureWorkers();
        const id = this.nextId++;
        return new Promise<DepthFrame>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.queue.push({ id, bitmap });
            this.drain();
        });
    }

    dispose() {
        this.teardown(new Error("深度捕捉已取消"));
    }

    private teardown(reason: Error) {
        this.workers.forEach((worker) => worker.terminate());
        this.workers = [];
        this.idle = [];
        this.active.clear();
        this.queue.forEach((item) => item.bitmap.close());
        this.queue = [];
        this.pending.forEach((entry) => entry.reject(reason));
        this.pending.clear();
    }

    private ensureWorkers() {
        if (this.workers.length || this.failed) return;
        for (let index = 0; index < this.concurrency; index += 1) {
            const worker = new Worker(new URL("./canvas-depth.worker.ts", import.meta.url), { type: "module" });
            worker.onmessage = (event: MessageEvent<{ id: number; depth?: Float32Array; width?: number; height?: number; error?: string; ready?: boolean }>) => {
                const message = event.data;
                if (message.ready) {
                    this.options.onReady?.();
                    return;
                }
                this.finish(worker);
                const entry = this.pending.get(message.id);
                if (!entry) return;
                this.pending.delete(message.id);
                if (message.error || !message.depth) {
                    entry.reject(new Error(message.error || "深度推理没有返回结果"));
                    return;
                }
                entry.resolve({ id: message.id, depth: message.depth, width: message.width || 0, height: message.height || 0 });
            };
            worker.onerror = (event) => {
                const error = new Error(event.message || "深度推理 Worker 初始化失败");
                this.failAll(error);
            };
            this.workers.push(worker);
            worker.postMessage({ type: "warmup" });
        }
    }

    private drain() {
        while (this.queue.length) {
            const worker = this.idle.pop() || this.workers.find((item) => !this.active.has(item));
            if (!worker) return;
            const job = this.queue.shift()!;
            this.active.add(worker);
            worker.postMessage({ type: "infer", id: job.id, bitmap: job.bitmap }, [job.bitmap]);
        }
    }

    private finish(worker: Worker) {
        this.active.delete(worker);
        if (!this.workers.includes(worker)) return;
        this.idle.push(worker);
        this.drain();
    }

    private failAll(error: Error) {
        this.failed = error;
        this.teardown(error);
    }
}
