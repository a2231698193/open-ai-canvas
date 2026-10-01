// 按素材类型清空素材库。只处理一种类型，并且始终重读第一页再删，
// 避免边翻页边删时后面的偏移前移、漏掉素材。

export const LIBRARY_CLEAR_KINDS = ["text", "image", "video", "audio", "model"] as const;

export type LibraryClearKind = (typeof LIBRARY_CLEAR_KINDS)[number];

export const ASSET_CLEAR_PAGE_SIZE = 120;
export const ASSET_CLEAR_BATCH_LIMIT = 1000;
const DEFAULT_MAX_CLEAR_ROUNDS = 2000;

export function isLibraryClearKind(value: string): value is LibraryClearKind {
    return (LIBRARY_CLEAR_KINDS as readonly string[]).includes(value);
}

export function shouldOfferAssetKindClear(value: string, count: number, clearable: boolean) {
    return clearable && count > 0 && isLibraryClearKind(value);
}

function labelGap(label: string) {
    return /^[A-Za-z0-9]/.test(label) ? " " : "";
}

export function libraryClearActionLabel(label: string) {
    return `清空全部${labelGap(label)}${label}`;
}

export function libraryClearCountLabel(count: number, label: string) {
    return `${count} 个${labelGap(label)}${label}`;
}

export function libraryClearDescription(label: string, count: number) {
    return `将彻底删除素材库中的全部 ${libraryClearCountLabel(count, label)}，不限当前搜索、业务分类和文件夹。其他类型会保留。回收站里的该类型素材不会一起删除。未被其他素材共用的文件会释放，画布或任务中的旧引用可能失效，且不能恢复。`;
}

export type ClearableAssetRef = { id?: string; kind?: string; status?: string };

export type ClearAssetPage = {
    assets?: ClearableAssetRef[];
    hasMore: boolean;
};

export function chunkIds(ids: string[], size: number) {
    if (size < 1) throw new Error("分批大小无效");
    const chunks: string[][] = [];
    for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
    return chunks;
}

function uniqueKindIds(assets: ClearableAssetRef[] | undefined, kind: string) {
    if (!Array.isArray(assets)) return [];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const asset of assets) {
        const id = typeof asset?.id === "string" ? asset.id.trim() : "";
        if (!id || asset.kind !== kind || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

export async function clearLibraryAssetsByKind(input: {
    kind: string;
    loggedIn: boolean;
    readLocal: () => ClearableAssetRef[];
    loadPage?: (page: number, pageSize: number) => Promise<ClearAssetPage>;
    deleteRemote: (ids: string[]) => Promise<void>;
    deleteLocal: (ids: string[]) => Promise<void>;
    maxRounds?: number;
}): Promise<{ deleted: number; ids: string[] }> {
    if (!isLibraryClearKind(input.kind)) throw new Error("不能一次清空所有类型");
    const deletedIds: string[] = [];
    const seenRemote = new Set<string>();
    let previousKey = "";
    let deleted = 0;
    const remember = (ids: string[]) => {
        for (const id of ids) {
            deletedIds.push(id);
            seenRemote.add(id);
        }
        deleted += ids.length;
    };
    try {
        if (input.loggedIn) {
            if (!input.loadPage) throw new Error("无法读取素材列表");
            const maxRounds = input.maxRounds ?? DEFAULT_MAX_CLEAR_ROUNDS;
            let finished = false;
            for (let round = 0; round < maxRounds; round += 1) {
                const page = await input.loadPage(1, ASSET_CLEAR_PAGE_SIZE);
                const ids = uniqueKindIds(page.assets, input.kind);
                if (!ids.length) {
                    if (page.hasMore) throw new Error("素材列表没有返回可清空的项目");
                    finished = true;
                    break;
                }
                const key = [...ids].sort().join("\0");
                if (key === previousKey) throw new Error("清空没有继续，请稍后重试");
                previousKey = key;
                for (const chunk of chunkIds(ids, ASSET_CLEAR_BATCH_LIMIT)) {
                    await input.deleteRemote(chunk);
                    remember(chunk);
                }
                if (!page.hasMore) {
                    finished = true;
                    break;
                }
            }
            if (!finished) throw new Error("素材过多，清空未完成，请再试一次");
        }
        const localIds = uniqueKindIds(
            input.readLocal().filter((asset) => asset.status !== "archived"),
            input.kind,
        ).filter((id) => !seenRemote.has(id));
        if (localIds.length) {
            await input.deleteLocal(localIds);
            remember(localIds);
        }
        return { deleted, ids: deletedIds };
    } catch (error) {
        const detail = error instanceof Error && error.message.trim() ? error.message.trim() : "清空失败";
        if (!deleted) throw new Error(detail);
        throw new Error(`已彻底删除 ${deleted} 个，其余清空失败：${detail}`);
    }
}
