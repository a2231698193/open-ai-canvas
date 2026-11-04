import { describe, expect, test } from "bun:test";

import { canvasNodeRendersStatusContent } from "@/components/canvas/canvas-node-content";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType } from "@/types/canvas";

/** 深度捕捉的占位节点必须让用户看到「生成中」，而不是一块空白。 */
function depthPlaceholder() {
    const node = createCanvasNode(
        CanvasNodeType.Video,
        { x: 0, y: 0 },
        {
            prompt: "「打斗」的深度视频",
            workflowKind: "reference_video",
            workflowTitle: "打斗 · 深度",
            assetTags: ["深度捕捉"],
            status: "loading",
        },
    );
    node.title = "打斗 · 深度";
    return node;
}

describe("depth capture placeholder node", () => {
    test("is a video node in the loading state so the canvas shows progress", () => {
        const node = depthPlaceholder();
        expect(node.type).toBe(CanvasNodeType.Video);
        expect(node.metadata?.status).toBe("loading");
        // 内容区会自己渲染加载态，用户能立刻看到「生成中」。
        expect(canvasNodeRendersStatusContent(node, { isBatchRoot: false, isEditingContent: false, hasCustomRenderer: false })).toBe(true);
    });

    test("completes in place instead of leaving a second node behind", () => {
        const node = depthPlaceholder();
        // 完成时只改同一个节点的媒体与状态，节点身份保持不变。
        const finished = {
            ...node,
            metadata: { ...node.metadata, status: "success" as const, content: "/api/resources/x/file", storageKey: "resource:x" },
        };
        expect(finished.id).toBe(node.id);
        expect(finished.title).toBe(node.title);
        expect(canvasNodeRendersStatusContent(finished, { isBatchRoot: false, isEditingContent: false, hasCustomRenderer: false })).toBe(false);
    });

    test("carries provenance tags that distinguish it from a normal generation", () => {
        const node = depthPlaceholder();
        expect(node.metadata?.assetTags).toContain("深度捕捉");
        expect(node.metadata?.workflowKind).toBe("reference_video");
        // 深度片不是模型产出，不应带模型徽章。
        expect(node.metadata?.producedModel).toBeUndefined();
    });
});
