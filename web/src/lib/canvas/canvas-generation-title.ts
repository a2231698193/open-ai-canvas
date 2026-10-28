import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const COPY_SUFFIX = /(_copy\d+|\s+Copy)$/i;
const VERSION_SUFFIX = /\s*·\s*([A-Z])\s*$/;
const OUTPUT_INDEX_SUFFIX = /\s*·\s*\d+\s*$/;

/** 新节点的默认名称：图片节点N / 视频节点N，按画布内同类型现有名称递增。 */
export function nextDefaultCanvasNodeTitle(nodes: CanvasNodeData[], type: "image" | "video") {
    const nodeType = type === "image" ? CanvasNodeType.Image : CanvasNodeType.Video;
    const prefix = type === "image" ? "图片节点" : "视频节点";
    let highest = 0;
    for (const node of nodes) {
        if (node.type !== nodeType) continue;
        const match = node.title.trim().match(new RegExp(`^${prefix}(\\d+)$`));
        if (match) highest = Math.max(highest, Number(match[1]));
    }
    return `${prefix}${highest + 1}`;
}

export function nextDefaultCanvasNodeTitles(nodes: CanvasNodeData[], type: "image" | "video", count: number) {
    const first = nextDefaultCanvasNodeTitle(nodes, type);
    const prefix = type === "image" ? "图片节点" : "视频节点";
    const start = Number(first.slice(prefix.length));
    return Array.from({ length: Math.max(0, count) }, (_, index) => `${prefix}${start + index}`);
}

const GENERIC_NODE_TITLES = new Set([
    "图片",
    "生成图片",
    "Generated Image",
    "New Generation",
    "视频",
    "生成视频",
    "Generated Video",
    "Video",
    "音频",
    "生成音频",
    "Generated Audio",
    "Audio",
]);

export function isGenericCanvasNodeTitle(title?: string) {
    const value = title?.trim() || "";
    return !value || GENERIC_NODE_TITLES.has(value);
}

export function mergeLiveCanvasNodeTitles(persistedNodes: CanvasNodeData[], liveNodes: CanvasNodeData[]) {
    if (!liveNodes.length) return persistedNodes;
    const liveById = new Map(liveNodes.map((node) => [node.id, node]));
    let changed = false;
    const next = persistedNodes.map((node) => {
        const liveTitle = liveById.get(node.id)?.title?.trim() || "";
        if (!liveTitle || liveTitle === node.title || isGenericCanvasNodeTitle(liveTitle)) return node;
        changed = true;
        return { ...node, title: liveTitle };
    });
    return changed ? next : persistedNodes;
}

export function buildImageGenerationNodeTitle(prompt: string, sourceNode?: CanvasNodeData, outputIndex?: number, outputCount = 1, options?: { preserveCustomTitle?: boolean }) {
    const preservedTitle = options?.preserveCustomTitle && sourceNode && !isGenericCanvasNodeTitle(sourceNode.title) ? sourceNode.title.trim() : "";
    let title = preservedTitle || prompt.trim().slice(0, 32) || "Generated Image";
    if (sourceNode && !preservedTitle) {
        const sourceTitleWithoutVersion = sourceNode.title.replace(VERSION_SUFFIX, "");
        const copySuffix = sourceTitleWithoutVersion.match(COPY_SUFFIX)?.[1] || "";
        const versionLabel = validVersionLabel(sourceNode.metadata?.versionLabel) || sourceNode.title.match(VERSION_SUFFIX)?.[1] || "";
        const titleWithoutVersion = title.replace(VERSION_SUFFIX, "");
        if (copySuffix && !titleWithoutVersion.toLowerCase().endsWith(copySuffix.toLowerCase())) title += copySuffix;
        if (versionLabel && !title.endsWith(` · ${versionLabel}`)) title += ` · ${versionLabel}`;
    }
    if (outputCount > 1 && outputIndex !== undefined) {
        const baseTitle = title.replace(OUTPUT_INDEX_SUFFIX, "");
        title = `${baseTitle} · ${outputIndex + 1}`;
    }
    return title;
}

function validVersionLabel(value?: string) {
    const normalized = value?.trim().toUpperCase() || "";
    return /^[A-Z]$/.test(normalized) ? normalized : "";
}
