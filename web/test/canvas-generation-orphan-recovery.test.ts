import { describe, expect, test } from "bun:test";

import { generationTaskMode, generationTaskNodeId } from "@/lib/canvas/canvas-generation-task-sync";
import type { GenerationTask } from "@/services/api/task-center";

/**
 * 孤儿结果认领的判定条件，与 use-canvas-generation 的 recoverInterruptedGenerationTasks 保持一致：
 * 只认领「任务成功 + 有节点 ID + 画布上完全没有这个节点」的任务。
 */
function isOrphanTask(task: GenerationTask, existingNodeIds: Set<string>) {
    const nodeId = generationTaskNodeId(task);
    return Boolean(task.status === "succeeded" && task.type.startsWith("canvas_") && nodeId && !existingNodeIds.has(nodeId));
}

function videoTask(overrides: Partial<GenerationTask> = {}): GenerationTask {
    return {
        id: "task-1",
        type: "canvas_video",
        status: "succeeded",
        projectId: "canvas-1",
        clientContext: { nodeId: "video-1793691670242-vdqfe" },
        ...overrides,
    } as GenerationTask;
}

describe("orphaned generation result adoption", () => {
    test("adopts a succeeded task whose node is missing from the canvas", () => {
        expect(isOrphanTask(videoTask(), new Set())).toBe(true);
    });

    test("ignores a task whose node still exists on the canvas", () => {
        expect(isOrphanTask(videoTask(), new Set(["video-1793691670242-vdqfe"]))).toBe(false);
    });

    test("ignores unfinished or failed tasks so retries are not duplicated", () => {
        for (const status of ["running", "queued", "failed", "cancelled", "succeeded"] as const) {
            const expected = status === "succeeded";
            expect(isOrphanTask(videoTask({ status }), new Set())).toBe(expected);
        }
    });

    test("ignores tasks without a node id or outside the canvas task namespace", () => {
        expect(isOrphanTask(videoTask({ clientContext: {} }), new Set())).toBe(false);
        expect(isOrphanTask(videoTask({ type: "drama_video" }), new Set())).toBe(false);
    });

    test("maps orphan task types to canvas node types", () => {
        expect(generationTaskMode(videoTask())).toBe("video");
        expect(generationTaskMode(videoTask({ type: "canvas_image" }))).toBe("image");
        expect(generationTaskMode(videoTask({ type: "canvas_audio" }))).toBe("audio");
        expect(generationTaskMode(videoTask({ type: "canvas_text" }))).toBe("text");
    });

    test("the reported 7 successful generations would all be adopted", () => {
        // 真实数据：同一个节点 7 次成功（doubao ×3 + MiniMax ×4），画布上该节点已消失。
        const tasks = Array.from({ length: 7 }, (_, index) => videoTask({ id: `task-${index}`, clientContext: { nodeId: "video-1793691670242-vdqfe" } }));
        const adopted = new Set<string>();
        for (const task of tasks) {
            if (isOrphanTask(task, new Set())) adopted.add(generationTaskNodeId(task));
        }
        // 同一个节点只补建一次，避免重复节点。
        expect(adopted.size).toBe(1);
    });
});
