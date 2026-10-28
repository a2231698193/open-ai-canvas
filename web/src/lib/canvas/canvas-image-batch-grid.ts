import { fitImageNodeSize } from "@/lib/canvas/canvas-node-size";
import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { UploadedImage } from "@/services/image-storage";

export type GridSplitPiece = {
    row: number;
    column: number;
    image: UploadedImage;
};

export function orderedImageBatchChildren(root: CanvasNodeData, childById: ReadonlyMap<string, CanvasNodeData>) {
    if (root.type !== CanvasNodeType.Image || !root.metadata?.isBatchRoot) return [];
    return (root.metadata.batchChildIds || []).map((id) => childById.get(id)).filter((child): child is CanvasNodeData => Boolean(child && child.type === CanvasNodeType.Image && child.metadata?.batchRootId === root.id));
}

/** 单次请求返回多图（子图带输出序号）或显式 lk888 切图时展示网格；普通多请求批次保持堆叠。 */
export function isGridImageBatchRoot(root: CanvasNodeData | undefined, childById: ReadonlyMap<string, CanvasNodeData>) {
    if (!root || root.type !== CanvasNodeType.Image || !root.metadata?.isBatchRoot) return false;
    const children = orderedImageBatchChildren(root, childById);
    if (children.length <= 1) return false;
    if (root.metadata.batchGrid) return true;
    return children.every((child) => typeof child.metadata?.batchOutputIndex === "number");
}

export function imageBatchGridColumns(count: number) {
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    return 3;
}

/** lk888 的合成宫格图原地转换：根节点代理第一张，四张切片作为隐藏子节点共享同一批次。 */
export function buildGridSplitBatchNodes(root: CanvasNodeData, pieces: GridSplitPiece[], createId: () => string) {
    const ordered = [...pieces].sort((left, right) => left.row - right.row || left.column - right.column);
    const children = ordered.map((piece, index) => {
        const size = fitImageNodeSize(piece.image.width, piece.image.height);
        return {
            id: createId(),
            type: CanvasNodeType.Image,
            title: `${root.title || "图片"} · 宫格 ${piece.row + 1}-${piece.column + 1}`,
            position: { ...root.position },
            width: size.width,
            height: size.height,
            metadata: {
                ...imageMetadata(piece.image),
                prompt: root.metadata?.prompt,
                producedModel: root.metadata?.producedModel,
                batchRootId: root.id,
                batchOutputIndex: index,
                manualSize: true,
            },
        } satisfies CanvasNodeData;
    });
    const primary = children[0];
    return {
        root: {
            ...root,
            metadata: {
                ...root.metadata,
                isBatchRoot: true,
                batchGrid: true,
                batchChildIds: children.map((child) => child.id),
                batchFailedCount: 0,
                primaryImageId: primary?.id,
                content: primary?.metadata?.content,
                storageKey: primary?.metadata?.storageKey,
                assetId: undefined,
                status: primary?.metadata?.status || "success",
                naturalWidth: primary?.metadata?.naturalWidth,
                naturalHeight: primary?.metadata?.naturalHeight,
                bytes: primary?.metadata?.bytes,
                mimeType: primary?.metadata?.mimeType,
                errorDetails: undefined,
                generationErrorCode: undefined,
                failedPromptFingerprint: undefined,
                imageBatchExpanded: undefined,
            },
        } satisfies CanvasNodeData,
        children,
    };
}
