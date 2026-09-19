import { describe, expect, test } from "bun:test";

import { restorePersistedTextNodeContent } from "@/lib/canvas/restore-text-resource-nodes";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function textNode(content: string, prompt?: string): CanvasNodeData {
    return {
        id: "text-1",
        type: CanvasNodeType.Text,
        title: "Note",
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
        metadata: { content, prompt, status: "success" },
    };
}

describe("restore persisted text nodes", () => {
    test("用 prompt 还原被写成资源地址的正文", () => {
        const nodes = restorePersistedTextNodeContent([
            textNode("/api/resources/abc_123/file", "女主从雨里走出来。"),
        ]);
        expect(nodes[0].metadata?.content).toBe("女主从雨里走出来。");
    });

    test("普通文本和图片节点不改", () => {
        const text = textNode("普通正文", "普通正文");
        const image: CanvasNodeData = {
            ...textNode("/api/resources/img/file"),
            type: CanvasNodeType.Image,
            title: "图片",
        };
        expect(restorePersistedTextNodeContent([text, image])).toEqual([text, image]);
    });
});
