import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

/**
 * 一个生成输出的素材身份，与后端 `internal/app/task_media_assets.go` 的 generationMediaAssetID 同口径：
 * `generation_` + sha256(`materialize:<taskId>:<输出序号>`)。浏览器物化、服务端登记和画布修复
 * 必须收敛到同一个 ID，否则同一次生成会留下两条素材记录，画布媒体也会因绑定不上而被云端拒绝保存。
 */
export async function generationAssetId(taskId: string, outputIndex: number): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`materialize:${taskId}:${outputIndex}`));
    return `generation_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export type ManagedGenerationIdentity = { taskId: string; outputIndex: number };

/**
 * 受管生成节点：有生成任务、还没绑定素材，且不属于图层组或拆层（它们各自的合成图有自己的素材身份）。
 * 这类节点在云端校验里必须带上属于同一资源的 assetId，否则整张画布都无法保存。
 */
export function unboundManagedGenerationIdentity(node: CanvasNodeData): ManagedGenerationIdentity | null {
    const metadata = node.metadata;
    const taskId = metadata?.taskId;
    if (!taskId || metadata?.assetId || metadata?.imageLayerGroup || metadata?.layerExtraction) return null;
    if (node.type !== "image" && node.type !== "video" && node.type !== "audio") return null;
    if (!metadata.content && !metadata.storageKey) return null;
    return { taskId, outputIndex: metadata.batchOutputIndex ?? 0 };
}

/** 收集这些画布里"还没绑定素材的受管生成节点"身份，调用方可据此按确定性 ID 补齐缺失的物化素材。 */
export function collectUnboundManagedGenerationIdentities(projects: CanvasProject[]): ManagedGenerationIdentity[] {
    const identities = new Map<string, ManagedGenerationIdentity>();
    for (const project of projects) {
        for (const node of project.nodes) {
            const identity = unboundManagedGenerationIdentity(node);
            if (identity) identities.set(`${identity.taskId}:${identity.outputIndex}`, identity);
        }
    }
    return [...identities.values()];
}
