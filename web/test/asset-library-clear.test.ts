import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import localforage from "localforage";

import { apiClient } from "@/services/api/request";
import { ASSET_CLEAR_BATCH_LIMIT, ASSET_CLEAR_PAGE_SIZE, clearLibraryAssetsByKind, libraryClearActionLabel, libraryClearCountLabel, shouldOfferAssetKindClear } from "@/services/asset-library-clear";
import { clearActiveAssetsByKind, initializeRemoteUserDataSession, resetRemoteUserDataSync } from "@/services/user-data-sync";
import { flushAssetStorePersistence, useAssetStore, type Asset } from "@/stores/use-asset-store";

const image = (id: string, status?: Asset["status"]): Asset =>
    ({
        id,
        kind: "image",
        title: id,
        coverUrl: `https://example.com/${id}.png`,
        tags: [],
        createdAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
        ...(status ? { status } : {}),
        data: { dataUrl: `https://example.com/${id}.png`, width: 8, height: 8, bytes: 8, mimeType: "image/png" },
    }) as Asset;

const video = (id: string): Asset =>
    ({
        id,
        kind: "video",
        title: id,
        coverUrl: "",
        tags: [],
        createdAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
        data: { url: `https://example.com/${id}.mp4`, width: 8, height: 8, bytes: 8, mimeType: "video/mp4" },
    }) as Asset;

describe("asset kind clear rules", () => {
    test("offers one clear action per media kind and never for all kinds", () => {
        expect(shouldOfferAssetKindClear("all", 4, true)).toBe(false);
        expect(shouldOfferAssetKindClear("entity", 2, true)).toBe(false);
        expect(shouldOfferAssetKindClear("image", 0, true)).toBe(false);
        expect(shouldOfferAssetKindClear("video", 3, false)).toBe(false);
        for (const kind of ["text", "image", "video", "audio", "model"]) {
            expect(shouldOfferAssetKindClear(kind, 1, true)).toBe(true);
        }
        expect(libraryClearActionLabel("图片")).toBe("清空全部图片");
        expect(libraryClearActionLabel("3D 模型")).toBe("清空全部 3D 模型");
        expect(libraryClearCountLabel(2, "3D 模型")).toBe("2 个 3D 模型");
    });

    test("drains the first page repeatedly and leaves other kinds untouched", async () => {
        const pages = [
            {
                assets: [
                    { id: "image-1", kind: "image" },
                    { id: "image-1", kind: "image" },
                    { id: "video-1", kind: "video" },
                    { id: " ", kind: "image" },
                ],
                hasMore: true,
            },
            { assets: [{ id: "image-2", kind: "image" }], hasMore: false },
        ];
        const deleted: string[][] = [];
        const requested: number[] = [];
        const result = await clearLibraryAssetsByKind({
            kind: "image",
            loggedIn: true,
            readLocal: () => [
                { id: "image-1", kind: "image" },
                { id: "local-image", kind: "image" },
                { id: "archived-image", kind: "image", status: "archived" },
                { id: "video-1", kind: "video" },
            ],
            loadPage: async (page, pageSize) => {
                requested.push(page, pageSize);
                const next = pages.shift();
                if (!next) throw new Error("不应继续翻页");
                return next;
            },
            deleteRemote: async (ids) => {
                deleted.push(ids);
            },
            deleteLocal: async (ids) => {
                deleted.push(ids);
            },
        });

        expect(requested).toEqual([1, ASSET_CLEAR_PAGE_SIZE, 1, ASSET_CLEAR_PAGE_SIZE]);
        expect(deleted).toEqual([["image-1"], ["image-2"], ["local-image"]]);
        expect(result).toEqual({ deleted: 3, ids: ["image-1", "image-2", "local-image"] });
    });

    test("splits a page at the remote delete limit", async () => {
        const ids = Array.from({ length: ASSET_CLEAR_BATCH_LIMIT + 1 }, (_, index) => `image-${index}`);
        const deleted: number[] = [];
        await clearLibraryAssetsByKind({
            kind: "image",
            loggedIn: true,
            readLocal: () => [],
            loadPage: async () => ({ assets: ids.map((id) => ({ id, kind: "image" })), hasMore: false }),
            deleteRemote: async (chunk) => {
                deleted.push(chunk.length);
            },
            deleteLocal: async () => {
                throw new Error("不应删除本地");
            },
        });
        expect(deleted).toEqual([ASSET_CLEAR_BATCH_LIMIT, 1]);
    });

    test("keeps local-only assets when logged out and does not read remote pages", async () => {
        let remote = false;
        const removed: string[] = [];
        const result = await clearLibraryAssetsByKind({
            kind: "video",
            loggedIn: false,
            readLocal: () => [
                { id: "video-1", kind: "video" },
                { id: "image-1", kind: "image" },
                { id: "video-archived", kind: "video", status: "archived" },
            ],
            loadPage: async () => {
                remote = true;
                return { assets: [], hasMore: false };
            },
            deleteRemote: async () => {
                remote = true;
            },
            deleteLocal: async (ids) => {
                removed.push(...ids);
            },
        });
        expect(remote).toBe(false);
        expect(removed).toEqual(["video-1"]);
        expect(result.deleted).toBe(1);
    });

    test("stops after a partial remote failure and does not delete unsynced local assets", async () => {
        let calls = 0;
        let local = false;
        await expect(
            clearLibraryAssetsByKind({
                kind: "audio",
                loggedIn: true,
                readLocal: () => [{ id: "local-audio", kind: "audio" }],
                loadPage: async () => {
                    calls += 1;
                    if (calls === 1) return { assets: [{ id: "audio-1", kind: "audio" }], hasMore: true };
                    return { assets: [{ id: "audio-2", kind: "audio" }], hasMore: false };
                },
                deleteRemote: async (ids) => {
                    if (ids[0] === "audio-2") throw new Error("网络中断");
                },
                deleteLocal: async () => {
                    local = true;
                },
            }),
        ).rejects.toThrow("已彻底删除 1 个，其余清空失败：网络中断");
        expect(local).toBe(false);
    });

    test("does not delete the same page again when the list does not advance", async () => {
        let remoteDeletes = 0;
        await expect(
            clearLibraryAssetsByKind({
                kind: "text",
                loggedIn: true,
                readLocal: () => [],
                loadPage: async () => ({ assets: [{ id: "text-1", kind: "text" }], hasMore: true }),
                deleteRemote: async () => {
                    remoteDeletes += 1;
                },
                deleteLocal: async () => {
                    throw new Error("不应删除本地");
                },
            }),
        ).rejects.toThrow("已彻底删除 1 个，其余清空失败：清空没有继续，请稍后重试");
        expect(remoteDeletes).toBe(1);
    });

    test("refuses to clear every kind at once", async () => {
        await expect(
            clearLibraryAssetsByKind({
                kind: "all",
                loggedIn: true,
                readLocal: () => [{ id: "image-1", kind: "image" }],
                deleteRemote: async () => {
                    throw new Error("不应删除");
                },
                deleteLocal: async () => {
                    throw new Error("不应删除");
                },
            }),
        ).rejects.toThrow("不能一次清空所有类型");
    });
});

describe("asset kind clear sync", () => {
    const originalAdapter = apiClient.defaults.adapter;
    let originalWindow: PropertyDescriptor | undefined;
    const originalGet = localforage.getItem;
    const originalSet = localforage.setItem;
    const originalRemove = localforage.removeItem;

    beforeEach(async () => {
        originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
        const storage = new Map<string, string>();
        const indexed = new Map<string, unknown>();
        localforage.getItem = (async (key: string) => indexed.get(key) ?? null) as typeof localforage.getItem;
        localforage.setItem = (async (key: string, value: unknown) => {
            indexed.set(key, value);
            return value;
        }) as typeof localforage.setItem;
        localforage.removeItem = async (key: string) => {
            indexed.delete(key);
        };
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {
                setTimeout: globalThis.setTimeout,
                clearTimeout: globalThis.clearTimeout,
                localStorage: {
                    getItem: (key: string) => storage.get(key) ?? null,
                    setItem: (key: string, value: string) => storage.set(key, value),
                    removeItem: (key: string) => storage.delete(key),
                },
            },
        });
        useAssetStore.setState({ assets: [] });
        await flushAssetStorePersistence();
        await initializeRemoteUserDataSession("clear-kind-user");
    });

    afterEach(async () => {
        apiClient.defaults.adapter = originalAdapter;
        resetRemoteUserDataSync();
        useAssetStore.setState({ assets: [] });
        await flushAssetStorePersistence();
        localforage.getItem = originalGet;
        localforage.setItem = originalSet;
        localforage.removeItem = originalRemove;
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
        else delete (globalThis as { window?: unknown }).window;
    });

    function page(assets: Asset[], hasMore: boolean) {
        return {
            assets,
            kindCounts: {},
            categoryCounts: {},
            folderCounts: {},
            page: 1,
            pageSize: ASSET_CLEAR_PAGE_SIZE,
            total: assets.length,
            hasMore,
        };
    }

    test("clears only the requested kind across pages, including unsynced local assets", async () => {
        useAssetStore.setState({ assets: [image("remote-1"), image("remote-2"), image("local-only"), image("archived", "archived"), video("keep-video")] });
        const posts: unknown[] = [];
        let gets = 0;
        apiClient.defaults.adapter = async (config) => {
            if (config.method === "get") {
                gets += 1;
                expect(config.params).toMatchObject({ page: 1, pageSize: ASSET_CLEAR_PAGE_SIZE, kind: "image", status: "active" });
                const assets = gets === 1 ? [image("remote-1")] : [image("remote-2")];
                return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: page(assets, gets === 1), msg: "ok" } };
            }
            posts.push(typeof config.data === "string" ? JSON.parse(config.data) : config.data);
            return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { ids: posts.at(-1) }, msg: "ok" } };
        };

        const result = await clearActiveAssetsByKind("image");

        expect(posts).toEqual([["remote-1"], ["remote-2"]]);
        expect(result.ids).toEqual(["remote-1", "remote-2", "local-only"]);
        expect(useAssetStore.getState().assets.map((asset) => asset.id)).toEqual(["archived", "keep-video"]);
    });

    test("a refused delete leaves every local asset in place", async () => {
        useAssetStore.setState({ assets: [image("remote-1"), video("keep-video")] });
        apiClient.defaults.adapter = async (config) => {
            if (config.method === "get") {
                return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: page([image("remote-1")], false), msg: "ok" } };
            }
            return { config, headers: {}, status: 200, statusText: "OK", data: { code: 400, data: null, msg: "拒绝删除", reason: "invalid_argument" } };
        };

        await expect(clearActiveAssetsByKind("image")).rejects.toThrow("拒绝删除");
        expect(useAssetStore.getState().assets.map((asset) => asset.id)).toEqual(["remote-1", "keep-video"]);
    });

    test("does not request a clear of every kind", async () => {
        apiClient.defaults.adapter = async () => {
            throw new Error("不应请求");
        };
        await expect(clearActiveAssetsByKind("all")).rejects.toThrow("不能一次清空所有类型");
    });
});

describe("asset kind clear wiring", () => {
    test("the library offers a clear control only on media kinds", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        const panels = readFileSync(resolve(import.meta.dir, "../src/pages/assets/asset-library-panels.tsx"), "utf8");
        const sync = readFileSync(resolve(import.meta.dir, "../src/services/user-data-sync.ts"), "utf8");
        const kindStart = page.indexOf('title="素材类型"');
        const categoryStart = page.indexOf('title="业务分类"');
        const folderStart = page.indexOf("我的分类");
        expect(kindStart).toBeGreaterThanOrEqual(0);
        expect(categoryStart).toBeGreaterThan(kindStart);
        const kindGroup = page.slice(kindStart, categoryStart);
        const categoryGroup = page.slice(categoryStart, folderStart);
        expect(kindGroup).toContain('clearable={viewMode === "library"}');
        expect(kindGroup).toContain("onClear={clearAssetKind}");
        expect(categoryGroup).not.toContain("onClear");
        expect(categoryGroup).not.toContain("clearable");
        expect(page).not.toContain("清空全部素材");
        expect(panels).toContain("shouldOfferAssetKindClear");
        expect(panels).toContain('triggerLabel="清空"');

        const start = sync.indexOf("export async function clearActiveAssetsByKind");
        const end = sync.indexOf("export async function deleteCanvasProjectsWithRemoteSync");
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const body = sync.slice(start, end);
        expect(body).toContain("withRemoteUserDataSyncExclusive");
        expect(body).toContain("clearLibraryAssetsByKind");
        expect(body).not.toContain("deleteAssetsWithRemoteSync(");
    });
});
