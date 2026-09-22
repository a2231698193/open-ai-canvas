import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rebaseEditedProjectOntoRemote } from "../src/lib/canvas/canvas-storage-revision";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "../src/types/canvas";

function canvas(overrides: Partial<CanvasProject> = {}): CanvasProject {
    return {
        id: "canvas",
        revision: 1,
        title: "画布",
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
        nodes: [{ id: "image-a", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 100, height: 100 }],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
        ...overrides,
    };
}

function withNode(project: CanvasProject, id: string, title = id): CanvasProject {
    return { ...project, nodes: [...project.nodes, { ...project.nodes[0], id, title }] };
}

function withNodeTitle(project: CanvasProject, id: string, title: string): CanvasProject {
    return { ...project, nodes: project.nodes.map((node) => (node.id === id ? { ...node, title } : node)) };
}

describe("画布版本冲突重新对齐", () => {
    test("远端新增节点与本地的其它改动合并，两边都保留", () => {
        const base = canvas();
        const local = withNodeTitle(base, "image-a", "本地改名");
        const durable = withNode({ ...base, revision: 2 }, "cli-node", "命令行新增");
        const { project, conflicts } = rebaseEditedProjectOntoRemote({ base, local, durable, baseRevision: base.revision });

        expect(conflicts).toEqual([]);
        expect(project.revision).toBe(2);
        expect(project.nodes.map((node) => node.id).sort()).toEqual(["cli-node", "image-a"]);
        expect(project.nodes.find((node) => node.id === "image-a")?.title).toBe("本地改名");
    });

    test("本地没有改动时直接采用远端版本", () => {
        const base = canvas();
        const durable = withNode({ ...base, revision: 2 }, "cli-node");
        const { project, conflicts } = rebaseEditedProjectOntoRemote({ base, local: base, durable, baseRevision: base.revision });

        expect(conflicts).toEqual([]);
        expect(project.revision).toBe(2);
        expect(project.nodes.map((node) => node.id)).toContain("cli-node");
    });

    test("两边改同一个字段时报冲突，交给调用方保留草稿", () => {
        const base = canvas();
        const local = withNodeTitle(base, "image-a", "本地改名");
        const durable = withNodeTitle({ ...base, revision: 2 }, "image-a", "命令行改名");
        const { conflicts } = rebaseEditedProjectOntoRemote({ base, local, durable, baseRevision: base.revision });

        expect(conflicts.length).toBeGreaterThan(0);
    });

    test("缺少基线或基线版本不一致时不合并", () => {
        const base = canvas();
        const local = withNodeTitle(base, "image-a", "本地改名");
        const durable = withNode({ ...base, revision: 2 }, "cli-node");

        const missingBase = rebaseEditedProjectOntoRemote({ base: undefined, local, durable, baseRevision: 0 });
        expect(missingBase.project).toBe(local);
        expect(missingBase.conflicts.length).toBeGreaterThan(0);

        const mismatchedBase = rebaseEditedProjectOntoRemote({ base: { ...base, revision: 7 }, local, durable, baseRevision: 7 });
        expect(mismatchedBase.project).toBe(local);
        expect(mismatchedBase.conflicts.length).toBeGreaterThan(0);
    });

    test("保存遇到版本冲突时先重新对齐，再回落到冲突提示", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/services/user-data-sync.ts"), "utf8");
        expect(source).toContain("rebaseEditedProjectOntoRemote({ base, local: current, durable: remote");
        expect(source).toContain("if (conflict && await realignProjectAfterConflict(source)) continue;");
        expect(source).toContain("realignedProjectsThisDrain = new Set();");
    });
});
