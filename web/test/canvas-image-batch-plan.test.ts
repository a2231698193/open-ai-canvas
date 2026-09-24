import { describe, expect, test } from "bun:test";

import { resolveImageBatchPlan, resolveResultGridSplit } from "../src/lib/canvas/canvas-image-batch-plan";

describe("图片生成批量计划", () => {
    test("普通模型按用户张数逐个提交上游请求", () => {
        expect(resolveImageBatchPlan(1, 0)).toEqual({ nodeCount: 1, upstreamCalls: 1, batchOutputs: 0 });
        expect(resolveImageBatchPlan(4, 0)).toEqual({ nodeCount: 4, upstreamCalls: 4, batchOutputs: 0 });
        expect(resolveImageBatchPlan(3, undefined)).toEqual({ nodeCount: 3, upstreamCalls: 3, batchOutputs: 0 });
        // 1 等同于"不固定批量"，不能把一次调用当成固定批量。
        expect(resolveImageBatchPlan(3, 1)).toEqual({ nodeCount: 3, upstreamCalls: 3, batchOutputs: 0 });
    });

    test("固定批量协议只提交一次请求，节点数取上游固定张数", () => {
        expect(resolveImageBatchPlan(1, 4)).toEqual({ nodeCount: 4, upstreamCalls: 1, batchOutputs: 4 });
        // 用户选 4 也不能变成 4 次调用：那是 4 组生成、4 倍计费。
        expect(resolveImageBatchPlan(4, 4)).toEqual({ nodeCount: 4, upstreamCalls: 1, batchOutputs: 4 });
        // 用户选的张数少于固定批量时，多出来的张数已经付过费，仍然全部铺出来。
        expect(resolveImageBatchPlan(2, 4)).toEqual({ nodeCount: 4, upstreamCalls: 1, batchOutputs: 4 });
    });

    test("非法输入回落到单张，不产生固定批量", () => {
        expect(resolveImageBatchPlan(0, 0)).toEqual({ nodeCount: 1, upstreamCalls: 1, batchOutputs: 0 });
        expect(resolveImageBatchPlan(Number.NaN, Number.NaN)).toEqual({ nodeCount: 1, upstreamCalls: 1, batchOutputs: 0 });
        expect(resolveImageBatchPlan(2, -4)).toEqual({ nodeCount: 2, upstreamCalls: 2, batchOutputs: 0 });
    });
});

describe("结果宫格自动切分", () => {
    test("lk888-mj 只回合成宫格图，按 2×2 切分", () => {
        expect(resolveResultGridSplit("lk888-mj", 0)).toEqual({ rows: 2, columns: 2 });
        expect(resolveResultGridSplit(" LK888-MJ ", 0)).toEqual({ rows: 2, columns: 2 });
    });

    test("固定批量协议拿到的是单图，不能切分", () => {
        expect(resolveResultGridSplit("apimart-mj", 4)).toBeNull();
        // 即便协议同时命中白名单，固定批量优先：结果是 4 张单图而不是宫格。
        expect(resolveResultGridSplit("lk888-mj", 4)).toBeNull();
    });

    test("其它协议与空值都不切分", () => {
        expect(resolveResultGridSplit("openai-image", 0)).toBeNull();
        expect(resolveResultGridSplit(undefined, 0)).toBeNull();
        expect(resolveResultGridSplit("", 0)).toBeNull();
    });
});
