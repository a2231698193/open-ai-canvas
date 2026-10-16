import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { generationAssetId } from "@/lib/canvas/generation-asset-identity";

// Isolate transport/storage without leaking module mocks into other test suites.
// Sync, resource conversion, content comparison and progress use production code.
const dir = mkdtempSync(join(tmpdir(), "canvas-sync-progress-"));
const root = new URL("../src/", import.meta.url);
const stubPath = join(dir, "dependencies.ts");
const paths: Record<string, string> = {
    "json-canonicalize": import.meta.resolve("json-canonicalize"),
    zustand: import.meta.resolve("zustand"),
    "@/services/api/resources": join(dir, "resources.ts"),
    "@/lib/canvas/canvas-content": join(dir, "content.ts"),
    "@/lib/canvas/generation-asset-identity": join(dir, "identity.ts"),
    "@/stores/use-sync-progress-store": join(dir, "progress.ts"),
    "./user-data-sync-media": join(dir, "media.ts"),
};
function copySource(source: string, name: string) {
    const code = readFileSync(new URL(source, root), "utf8");
    const imports = code.replace(/"(@\/[^\"]+|\.\/user-data-sync-media|json-canonicalize|zustand)"/g, (_, specifier: string) => JSON.stringify(paths[specifier] ?? stubPath));
    writeFileSync(join(dir, name), "const window = { setTimeout, clearTimeout, addEventListener: () => {} };\n" + imports);
}
writeFileSync(
    stubPath,
    `
import { createStore } from ${JSON.stringify(import.meta.resolve("zustand/vanilla"))};
export const fixture = { remote: undefined, writes: [], reads: 0, flushes: 0, beforeFlush: undefined, readHook: undefined, flushError: undefined, shouldReject: undefined, remoteAssets: [], assetRequests: [], data: new Map() };
export const useCanvasStore = createStore((set, get) => ({ projects: [], openProject: id => get().projects.find(project => project.id === id) }));
export const useAssetStore = createStore(() => ({ assets: [] }));
export const getActiveUserScope = () => "sync-test-user";
export const localForageStorageForScope = () => ({ getItem: async key => fixture.data.get(key) ?? null, setItem: async (key, value) => { fixture.data.set(key, value); }, removeItem: async key => { fixture.data.delete(key); } });
export async function flushCanvasStorePersistence() { fixture.flushes++; const hook = fixture.beforeFlush; fixture.beforeFlush = undefined; hook?.(); if (fixture.flushError) throw fixture.flushError; }
export const flushAssetStorePersistence = async () => {};
export const getGenerationAssetDefaults = () => undefined;
export const appQueryClient = { invalidateQueries: async () => {} };
	export const accountFileStorageUsageQueryKey = ["account-file-storage"];
	export const isLibraryClearKind = () => false;
export const repairMissingCanvasAssets = () => ({ createdAssets: 0, updatedProjects: 0 });
export class ApiError extends Error { retryable = false; status; reason; constructor(message, options) { super(message); this.status = options?.status; this.reason = options?.reason; } }
export const apiBaseURL = "/api";
const unexpected = () => { throw new Error("unexpected dependency call"); };
	export const clearLibraryAssetsByKind = unexpected;
export const http = { get: unexpected, post: unexpected, put: unexpected, patch: unexpected, delete: unexpected };
export async function applyRemoteCanvasOperations(id, request) {
    fixture.writes.push(structuredClone(request));
    if (fixture.shouldReject?.(request)) throw new ApiError("画布媒体尚未进入素材库，请等待同步完成后重试", { status: 400, reason: "bad_request" });
    for (const operation of request.operations) {
        if (operation.type !== "set_field") throw new Error("unexpected operation");
        if (fixture.remote[operation.field] !== operation.beforeValue) throw new Error("invalid operation baseline");
        fixture.remote = { ...fixture.remote, [operation.field]: operation.value };
    }
    fixture.remote = { ...fixture.remote, revision: fixture.remote.revision + 1 };
    return { project: fixture.remote };
}
export async function getRemoteCanvasProject() { fixture.reads++; const hook = fixture.readHook; fixture.readHook = undefined; hook?.(); return { project: structuredClone(fixture.remote) }; }
export const deleteRemoteAssets = unexpected, deleteRemoteCanvasProject = unexpected, getRemoteAsset = unexpected, getRemoteUserDataSnapshot = unexpected, listRemoteAssetsPage = unexpected, upsertRemoteAsset = unexpected;
export async function getRemoteAssetsByIds(ids) { fixture.assetRequests.push(ids); return { assets: fixture.remoteAssets.filter((asset) => ids.includes(asset.id)) }; }
export const getImageBlob = unexpected, getMediaBlob = unexpected, assetForRemoteSync = unexpected, canvasNodeToAsset = unexpected;
export const parseAssetRecordList = (assets) => assets;
export const applyAgentCanvasPatch = unexpected, mergeAgentCanvasEditor = unexpected, mergeThreeWayValue = unexpected;
export const useCanvasHistoryStore = {};
`,
);
copySource("services/api/resources.ts", "resources.ts");
copySource("services/user-data-sync-media.ts", "media.ts");
copySource("lib/canvas/canvas-content.ts", "content.ts");
copySource("lib/canvas/generation-asset-identity.ts", "identity.ts");
copySource("stores/use-sync-progress-store.ts", "progress.ts");
copySource("services/user-data-sync.ts", "sync.ts");
const sync: typeof import("@/services/user-data-sync") = await import(join(dir, "sync.ts"));
const { useSyncProgressStore }: typeof import("@/stores/use-sync-progress-store") = await import(join(dir, "progress.ts"));
const { fixture, useCanvasStore, useAssetStore } = await import(stubPath);
sync.installRemoteUserDataAutoSync();

const base = (): CanvasProject => ({
    id: "canvas",
    revision: 7,
    title: "Canvas",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    nodes: [{ id: "image", type: "image", title: "Image", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { storageKey: "resource:image", assetId: "asset", content: "/api/resources/image/file" } }] as CanvasProject["nodes"],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "dots",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    previsScenes: [],
});
function withCdnUrl(project = base()): CanvasProject {
    return { ...project, nodes: project.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, content: "https://cdn.example.com/image.png" } })) };
}
function live(): CanvasProject {
    return useCanvasStore.getState().openProject("canvas");
}
function edit(patch: Partial<CanvasProject>) {
    useCanvasStore.setState({ projects: [{ ...live(), ...patch }] });
}
beforeEach(async () => {
    sync.resetRemoteUserDataSync();
    fixture.remote = base();
    fixture.data.clear();
    fixture.writes = [];
    fixture.reads = fixture.flushes = 0;
    fixture.beforeFlush = fixture.readHook = fixture.flushError = fixture.shouldReject = undefined;
    fixture.remoteAssets = [];
    fixture.assetRequests = [];
    useCanvasStore.setState({ projects: [base()] });
    await sync.initializeRemoteUserDataSession("sync-test-user");
});
afterEach(() => sync.resetRemoteUserDataSync());
afterAll(() => {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("unexpected fixture directory");
    rmSync(dir, { recursive: true, force: true });
});

describe("画布云端同步状态收尾", () => {
    test("资源地址差异产生空操作时结束同步，后续保存不再重复处理", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl()] });
        await sync.saveRemoteUserDataNow("canvas");
        expect(useSyncProgressStore.getState().syncingProjects.canvas).toMatchObject({ phase: "done", total: 0, pendingChanges: 0, cloudRevision: 7 });
        expect(useSyncProgressStore.getState().isAnySyncing()).toBe(false);
        expect(live().nodes[0].metadata?.content).toBe("/api/resources/image/file");
        expect(fixture.writes).toHaveLength(0);
        expect(fixture.reads).toBe(0);
        expect(fixture.flushes).toBe(1);
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.flushes).toBe(1);
    });

    test("实际提交后采用云端资源地址，只保存一次并结束同步", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl({ ...base(), title: "Renamed" })] });
        await sync.saveRemoteUserDataNow("canvas");
        expect(live().title).toBe("Renamed");
        expect(live().nodes[0].metadata?.content).toBe("/api/resources/image/file");
        expect(fixture.writes).toHaveLength(1);
        expect(fixture.reads).toBe(1);
        expect(fixture.flushes).toBe(1);
        expect(useSyncProgressStore.getState().syncingProjects.canvas).toMatchObject({ phase: "done", pendingChanges: 0, cloudRevision: 8 });
    });

    test("空操作收尾期间的新编辑保留并继续提交", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl()] });
        fixture.beforeFlush = () => edit({ title: "Edited during persistence" });
        const phases: string[] = [];
        const stop = useSyncProgressStore.subscribe((state) => phases.push(state.syncingProjects.canvas?.phase));
        try {
            await sync.saveRemoteUserDataNow("canvas");
        } finally {
            stop();
        }
        expect(phases).toContain("pending");
        expect(live().title).toBe("Edited during persistence");
        expect(fixture.remote.title).toBe(live().title);
        expect(fixture.writes).toHaveLength(1);
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    });

    test("云端回读期间的视口更新保留", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl({ ...base(), title: "Renamed" })] });
        const viewport = { x: 40, y: 90, k: 2 };
        fixture.readHook = () => edit({ viewport });
        await sync.saveRemoteUserDataNow("canvas");
        expect(live().viewport).toEqual(viewport);
        expect(fixture.writes).toHaveLength(1);
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    });

    test("空操作收尾的本地保存失败仍显示错误", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl()] });
        fixture.flushError = new Error("local persistence failed");
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("local persistence failed");
        expect(useSyncProgressStore.getState().syncingProjects.canvas).toMatchObject({ phase: "error", pendingChanges: 1, errorKind: "local" });
        expect(useSyncProgressStore.getState().isAnySyncing()).toBe(true);
    });

    test.each([false, true])("重放 journal 时保留后续编辑（有新编辑：%s）", async (newerEdit) => {
        sync.resetRemoteUserDataSync();
        const prepared = { ...base(), title: "Queued edit" };
        fixture.data.set(
            "yingce:canvas-mutation-journal",
            JSON.stringify([
                { projectId: "canvas", request: { mutationId: "pending-mutation", baseRevision: 7, operations: [{ type: "set_field", field: "title", value: prepared.title, beforeValue: "Canvas" }] }, baseline: base(), prepared, createdAt: "2026-01-01" },
            ]),
        );
        const title = newerEdit ? "Newer edit" : prepared.title;
        useCanvasStore.setState({ projects: [withCdnUrl({ ...base(), title })] });
        await sync.initializeRemoteUserDataSession("sync-test-user");
        await sync.saveRemoteUserDataNow("canvas");
        expect(live().title).toBe(title);
        expect(fixture.remote.title).toBe(title);
        expect(fixture.writes).toHaveLength(newerEdit ? 2 : 1);
        expect(fixture.writes[0].mutationId).toBe("pending-mutation");
        expect(fixture.data.has("yingce:canvas-mutation-journal")).toBe(false);
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    });

    test("journal 被服务端永久拒绝时丢弃日志并按当前内容重建", async () => {
        sync.resetRemoteUserDataSync();
        const prepared = { ...base(), title: "Queued edit" };
        fixture.data.set(
            "yingce:canvas-mutation-journal",
            JSON.stringify([
                { projectId: "canvas", request: { mutationId: "rejected-mutation", baseRevision: 7, operations: [{ type: "set_field", field: "title", value: prepared.title, beforeValue: "Canvas" }] }, baseline: base(), prepared, createdAt: "2026-01-01" },
            ]),
        );
        fixture.shouldReject = (request) => request.mutationId === "rejected-mutation";
        useCanvasStore.setState({ projects: [withCdnUrl({ ...base(), title: "Newer edit" })] });
        await sync.initializeRemoteUserDataSession("sync-test-user");
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.writes).toHaveLength(2);
        expect(fixture.writes[0].mutationId).toBe("rejected-mutation");
        expect(live().title).toBe("Newer edit");
        expect(fixture.remote.title).toBe("Newer edit");
        expect(fixture.data.has("yingce:canvas-mutation-journal")).toBe(false);
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    });

    test("重建后仍被同一原因拒绝时停止重建并如实报错", async () => {
        sync.resetRemoteUserDataSync();
        const prepared = { ...base(), title: "Poisoned" };
        fixture.data.set(
            "yingce:canvas-mutation-journal",
            JSON.stringify([
                { projectId: "canvas", request: { mutationId: "poisoned-mutation", baseRevision: 7, operations: [{ type: "set_field", field: "title", value: prepared.title, beforeValue: "Canvas" }] }, baseline: base(), prepared, createdAt: "2026-01-01" },
            ]),
        );
        fixture.shouldReject = () => true;
        useCanvasStore.setState({ projects: [withCdnUrl(prepared)] });
        await sync.initializeRemoteUserDataSession("sync-test-user");
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("画布媒体尚未进入素材库");
        // 重放 + 一次重建，之后不再重建，避免与重放互相触发成死循环。
        expect(fixture.writes).toHaveLength(2);
        expect(fixture.data.has("yingce:canvas-mutation-journal")).toBe(true);
        expect(useSyncProgressStore.getState().syncingProjects.canvas).toMatchObject({ phase: "error", pendingChanges: 1 });
    });

    test("画布缺少物化素材时按确定性 ID 从服务端补回素材库", async () => {
        sync.resetRemoteUserDataSync();
        const taskId = "task-missing-asset";
        const assetId = await generationAssetId(taskId, 0);
        const unbound = { ...base().nodes[0], metadata: { ...base().nodes[0].metadata, assetId: undefined, taskId, storageKey: "resource:R1", content: "/api/resources/R1/file" } };
        const project = (title: string) => ({ ...base(), title, nodes: [unbound] });
        fixture.remote = project("Canvas");
        fixture.remoteAssets = [
            {
                id: assetId,
                kind: "image",
                title: "生成图片",
                coverUrl: "",
                tags: [],
                createdAt: "2026-01-01",
                updatedAt: "2026-01-01",
                data: { dataUrl: "/api/resources/R1/file", storageKey: "resource:R1", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
                metadata: { taskId, outputIndex: 0 },
            },
        ];
        useCanvasStore.setState({ projects: [project("Canvas")] });
        await sync.initializeRemoteUserDataSession("sync-test-user");
        // 节点与云端一致，只改标题让画布变脏，确保这一步只验证素材补齐。
        useCanvasStore.setState({ projects: [project("Renamed")] });
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.assetRequests).toEqual([[assetId]]);
        expect(useAssetStore.getState().assets.map((asset) => asset.id)).toEqual([assetId]);
    });
});
