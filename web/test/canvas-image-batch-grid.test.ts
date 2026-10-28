import { describe, expect, test } from "bun:test";

import { buildGridSplitBatchNodes, imageBatchGridColumns, isGridImageBatchRoot, orderedImageBatchChildren } from "@/lib/canvas/canvas-image-batch-grid";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { UploadedImage } from "@/services/image-storage";

function imageNode(id: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
        metadata: { status: "success", content: `https://example.com/${id}.png`, storageKey: `resource:${id}`, ...metadata },
    };
}

function uploaded(id: string, width = 512, height = 512): UploadedImage {
    return { url: `https://example.com/${id}.png`, storageKey: `resource:${id}`, width, height, bytes: 128, mimeType: "image/png" };
}

describe("image batch grid detection", () => {
    test("固定批量子图带输出序号时按 2×2 网格显示", () => {
        const children = [0, 1, 2, 3].map((index) => imageNode(`child-${index}`, { batchRootId: "root", batchOutputIndex: index }));
        const root = imageNode("root", { isBatchRoot: true, batchChildIds: children.map((child) => child.id), primaryImageId: "child-0" });
        const byId = new Map([root, ...children].map((node) => [node.id, node]));
        expect(isGridImageBatchRoot(root, byId)).toBe(true);
    });

    test("普通多请求批次没有输出序号时保持原堆叠行为", () => {
        const children = ["child-a", "child-b"].map((id) => imageNode(id, { batchRootId: "root" }));
        const root = imageNode("root", { isBatchRoot: true, batchChildIds: children.map((child) => child.id), primaryImageId: "child-a" });
        const byId = new Map([root, ...children].map((node) => [node.id, node]));
        expect(isGridImageBatchRoot(root, byId)).toBe(false);
    });

    test("显式 batchGrid 标记的 lk888 切图按网格显示", () => {
        const children = ["child-a", "child-b"].map((id) => imageNode(id, { batchRootId: "root" }));
        const root = imageNode("root", { isBatchRoot: true, batchGrid: true, batchChildIds: children.map((child) => child.id) });
        const byId = new Map([root, ...children].map((node) => [node.id, node]));
        expect(isGridImageBatchRoot(root, byId)).toBe(true);
    });

    test("单图或非根节点不进入网格模式", () => {
        const root = imageNode("root", { isBatchRoot: true, batchChildIds: ["child"], primaryImageId: "child" });
        const child = imageNode("child", { batchRootId: "root", batchOutputIndex: 0 });
        const byId = new Map([root, child].map((node) => [node.id, node]));
        expect(isGridImageBatchRoot(root, byId)).toBe(false);
        expect(isGridImageBatchRoot(child, byId)).toBe(false);
    });
});

describe("image batch grid ordering", () => {
    test("按 batchChildIds 顺序返回本批次子图，忽略外来与缺失节点", () => {
        const children = ["a", "b", "c"].map((id) => imageNode(id, { batchRootId: "root" }));
        const root = imageNode("root", { isBatchRoot: true, batchChildIds: ["c", "missing", "a", "foreign", "b"] });
        const foreign = imageNode("foreign", { batchRootId: "other" });
        const byId = new Map([root, ...children, foreign].map((node) => [node.id, node]));
        expect(orderedImageBatchChildren(root, byId).map((node) => node.id)).toEqual(["c", "a", "b"]);
    });

    test("四图两列、六图三列", () => {
        expect(imageBatchGridColumns(4)).toBe(2);
        expect(imageBatchGridColumns(3)).toBe(2);
        expect(imageBatchGridColumns(6)).toBe(3);
        expect(imageBatchGridColumns(1)).toBe(1);
    });
});

describe("lk888 grid split conversion", () => {
    test("把合成图节点原地转换为网格批次，主图与四张子图共享一个根节点", () => {
        const root = imageNode("root", {
            prompt: "四个分镜",
            taskId: "task-1",
            model: "lk888",
            assetId: "composite-asset",
            naturalWidth: 1024,
            naturalHeight: 1024,
            bytes: 999,
            mimeType: "image/png",
        });
        root.width = 512;
        root.height = 512;
        const pieces = [
            { row: 1, column: 1, image: uploaded("piece-3") },
            { row: 0, column: 0, image: uploaded("piece-0") },
            { row: 0, column: 1, image: uploaded("piece-1") },
            { row: 1, column: 0, image: uploaded("piece-2") },
        ];
        let seed = 0;
        const result = buildGridSplitBatchNodes(root, pieces, () => `child-${seed++}`);

        expect(result.children.map((child) => child.id)).toEqual(["child-0", "child-1", "child-2", "child-3"]);
        expect(result.children.map((child) => child.metadata?.batchOutputIndex)).toEqual([0, 1, 2, 3]);
        expect(result.children.map((child) => child.metadata?.content)).toEqual([pieces[1].image.url, pieces[2].image.url, pieces[3].image.url, pieces[0].image.url]);
        expect(result.children.every((child) => child.metadata?.batchRootId === "root" && child.metadata?.prompt === "四个分镜")).toBe(true);

        expect(result.root.id).toBe("root");
        expect(result.root.width).toBe(512);
        expect(result.root.height).toBe(512);
        expect(result.root.metadata).toMatchObject({
            isBatchRoot: true,
            batchGrid: true,
            batchChildIds: ["child-0", "child-1", "child-2", "child-3"],
            primaryImageId: "child-0",
            content: pieces[1].image.url,
            storageKey: pieces[1].image.storageKey,
            status: "success",
            taskId: "task-1",
            prompt: "四个分镜",
            naturalWidth: 512,
            naturalHeight: 512,
            mimeType: "image/png",
        });
        expect(result.root.metadata?.assetId).toBeUndefined();
        expect(result.root.metadata?.imageBatchExpanded).toBeUndefined();
    });
});
