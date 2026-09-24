/**
 * 图片生成的批量计划。
 *
 * 画布批量原本是「每个子节点各发一次上游请求」——这对一次只回一张图的模型是对的。但固定批量协议
 * （Midjourney 一次 imagine 固定回四张）按张数发多次请求会变成 N 组生成、按 N 次计费，而且每次
 * 返回的其余图片都被丢掉。这类协议必须只发一次请求，再把 N 张按输出序号铺成 N 个节点。
 */
export type ImageBatchPlan = {
    /** 画布上要铺的子节点数量。 */
    nodeCount: number;
    /** 需要提交的上游生成任务数量。 */
    upstreamCalls: number;
    /** 上游单次调用固定返回的张数；0 表示不固定。 */
    batchOutputs: number;
};

export function resolveImageBatchPlan(requestedCount: number, batchOutputs?: number): ImageBatchPlan {
    const requested = Number.isFinite(requestedCount) && requestedCount > 0 ? Math.floor(requestedCount) : 1;
    const fixed = typeof batchOutputs === "number" && Number.isFinite(batchOutputs) && batchOutputs > 1 ? Math.floor(batchOutputs) : 0;
    if (!fixed) return { nodeCount: requested, upstreamCalls: requested, batchOutputs: 0 };
    return { nodeCount: fixed, upstreamCalls: 1, batchOutputs: fixed };
}
