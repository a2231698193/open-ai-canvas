import { isBareResourceFileUrl } from "@/lib/resource-locator";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/** 云端同步曾把文本节点正文替换成 /api/resources/:id/file。prompt 仍保留原文时可直接还原。 */
export function restorePersistedTextNodeContent(nodes: CanvasNodeData[]): CanvasNodeData[] {
    let changed = false;
    const next = nodes.map((node) => {
        const restored = restoreOneTextNode(node);
        if (restored !== node) changed = true;
        return restored;
    });
    return changed ? next : nodes;
}

export function restoreOneTextNode(node: CanvasNodeData): CanvasNodeData {
    if (node.type !== CanvasNodeType.Text) return node;
    const content = node.metadata?.content || "";
    if (!isBareResourceFileUrl(content)) return node;
    const prompt = node.metadata?.prompt || "";
    if (!prompt || isBareResourceFileUrl(prompt) || prompt === content) return node;
    return { ...node, metadata: { ...node.metadata, content: prompt } };
}
