import { afterEach, expect, spyOn, test } from "bun:test";
import { http } from "@/services/api/request";
import { applyAgentCanvasPatches, initializeRemoteUserDataSession, refreshCanvasAfterAgent, resetRemoteUserDataSync, subscribeAgentCanvasRefresh } from "@/services/user-data-sync";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";

const initial: CanvasProject = { id: "agent-test", title: "测试", createdAt: "2026-01-01", updatedAt: "2026-01-01", nodes: [], connections: [], chatSessions: [], activeChatId: null, viewport: { x: 0, y: 0, k: 1 } };
const remote: CanvasProject = { ...initial, nodes: [{ id: "text-1", type: CanvasNodeType.Text, title: "剧本", position: { x: 20, y: 20 }, width: 320, height: 240, metadata: { content: "正文" } }] };
let unsubscribe = () => {};
let restore = () => {};
afterEach(() => { unsubscribe(); restore(); resetRemoteUserDataSync(); });

async function setup(project: CanvasProject = remote) {
    useCanvasStore.setState({ projects: [initial] });
    await initializeRemoteUserDataSession("agent-user");
    const mock = spyOn(http, "get").mockResolvedValue({ project });
    restore = () => mock.mockRestore();
    return mock;
}

test("successful Agent refresh projects nodes into the open editor and store", async () => {
    await setup();
    let editor = initial;
    unsubscribe = subscribeAgentCanvasRefresh((project, previous) => {
        expect(previous).toEqual(initial);
        editor = project;
    });
    await refreshCanvasAfterAgent(initial.id);
    expect(editor.nodes).toEqual(remote.nodes);
    expect(useCanvasStore.getState().projects[0].nodes).toEqual(remote.nodes);
});

test("unsaved editor conflicts preserve store and acknowledged baseline", async () => {
    await setup();
    unsubscribe = subscribeAgentCanvasRefresh(() => { throw new Error("本地编辑冲突"); });
    await expect(refreshCanvasAfterAgent(initial.id)).rejects.toThrow("本地编辑冲突");
    expect(useCanvasStore.getState().projects[0]).toEqual(initial);
    unsubscribe();
    await refreshCanvasAfterAgent(initial.id);
    expect(useCanvasStore.getState().projects[0]).toEqual(remote);
});

test("dirty persisted edits are not replaced or delivered to the editor", async () => {
    await setup();
    useCanvasStore.setState({ projects: [{ ...initial, title: "本地修改" }] });
    let notified = false;
    unsubscribe = subscribeAgentCanvasRefresh(() => { notified = true; });
    await expect(refreshCanvasAfterAgent(initial.id)).rejects.toThrow("本地存在未同步编辑");
    expect(notified).toBe(false);
    expect(useCanvasStore.getState().projects[0].title).toBe("本地修改");
});

test("automatic focus and panning do not block Agent updates or reset the local viewport", async () => {
    await setup();
    const viewport = { x: -800, y: -400, k: 0.7 };
    useCanvasStore.setState({ projects: [{ ...initial, viewport, updatedAt: "2026-09-13" }] });
    let editor = initial;
    unsubscribe = subscribeAgentCanvasRefresh((project) => { editor = project; });
    await refreshCanvasAfterAgent(initial.id);
    expect(editor.nodes).toEqual(remote.nodes);
    expect(editor.viewport).toEqual(viewport);
    expect(useCanvasStore.getState().projects[0].viewport).toEqual(viewport);
});

test("replayed completion events do not reapply unchanged canvas nodes", async () => {
    await setup();
    let deliveries = 0;
    unsubscribe = subscribeAgentCanvasRefresh(() => { deliveries += 1; });
    await refreshCanvasAfterAgent(initial.id);
    await refreshCanvasAfterAgent(initial.id);
    expect(deliveries).toBe(1);
});

test("media admission and completion refresh the editor with references and result", async () => {
    const video = { id: "video-1", type: CanvasNodeType.Video, title: "镜头1", position: { x: 500, y: 20 }, width: 360, height: 640, metadata: { taskId: "task-1", status: "loading" as const, referenceNodeIds: ["image-1"] } };
    const project: CanvasProject = { ...remote, nodes: [...remote.nodes, { ...video, id: "image-1", type: CanvasNodeType.Image }, video], connections: [{ id: "edge-1", fromNodeId: "image-1", toNodeId: "video-1" }] };
    const mock = await setup(project);
    let editor = initial;
    unsubscribe = subscribeAgentCanvasRefresh((updated) => { editor = updated; });
    await refreshCanvasAfterAgent(initial.id);
    expect(editor.connections).toEqual(project.connections);
    expect(editor.nodes.find((node) => node.id === "video-1")?.metadata?.referenceNodeIds).toEqual(["image-1"]);
    const complete: CanvasProject = { ...project, nodes: project.nodes.map((node) => node.id === "video-1" ? { ...node, metadata: { ...node.metadata, status: "success", storageKey: "resource:video-result" } } : node) };
    mock.mockResolvedValue({ project: complete });
    await refreshCanvasAfterAgent(initial.id);
    expect(editor.nodes.find((node) => node.id === "video-1")?.metadata?.storageKey).toBe("resource:video-result");
    expect(useCanvasStore.getState().projects[0].nodes).toEqual(complete.nodes);
});


test("incremental batches update the editor once without full canvas requests", async () => {
    const get = await setup();
    let deliveries = 0;
    unsubscribe = subscribeAgentCanvasRefresh(() => { deliveries++; });
    const patch = { canvasId: initial.id, updatedAt: remote.updatedAt, nodes: remote.nodes.map((after) => ({ before: null, after })), connections: [] };
    await applyAgentCanvasPatches(initial.id, [patch, patch]);
    expect(get).not.toHaveBeenCalled();
    expect(deliveries).toBe(1);
    expect(useCanvasStore.getState().projects[0].nodes).toEqual(remote.nodes);
});

test("already projected deltas still advance the remote baseline", async () => {
    await setup();
    useCanvasStore.setState({ projects: [remote] });
    let deliveries = 0;
    unsubscribe = subscribeAgentCanvasRefresh(() => { deliveries++; });
    await applyAgentCanvasPatches(initial.id, [{ canvasId: initial.id, updatedAt: remote.updatedAt, nodes: remote.nodes.map((after) => ({ before: null, after })), connections: [] }]);
    expect(deliveries).toBe(0);
    await expect(refreshCanvasAfterAgent(initial.id)).resolves.toEqual(remote);
    expect(deliveries).toBe(0);
});

test("editor rejection keeps delta projection atomic and retryable", async () => {
    await setup();
    const patch = { canvasId: initial.id, updatedAt: remote.updatedAt, nodes: remote.nodes.map((after) => ({ before: null, after })), connections: [] };
    unsubscribe = subscribeAgentCanvasRefresh(() => { throw new Error("编辑冲突"); });
    await expect(applyAgentCanvasPatches(initial.id, [patch])).rejects.toThrow("编辑冲突");
    expect(useCanvasStore.getState().projects[0]).toEqual(initial);
    unsubscribe();
    await applyAgentCanvasPatches(initial.id, [patch]);
    expect(useCanvasStore.getState().projects[0].nodes).toEqual(remote.nodes);
});


test("50 distinct media completions project once and keep the local viewport", async () => {
    const get = await setup();
    const nodes = Array.from({ length: 50 }, (_, index) => ({ id: `video-${index}`, title: `动画${index}`, type: CanvasNodeType.Video, position: { x: index * 400, y: 100 }, width: 320, height: 180, metadata: { status: "loading" as const, taskId: `task-${index}`, taskStatus: "running" } }));
    const pending = { ...initial, nodes };
    useCanvasStore.setState({ projects: [pending] });
    await initializeRemoteUserDataSession("agent-user");
    let deliveries = 0;
    unsubscribe = subscribeAgentCanvasRefresh(() => { deliveries++; });
    await applyAgentCanvasPatches(initial.id, nodes.map((before, index) => ({ canvasId: initial.id, updatedAt: initial.updatedAt, nodes: [{ before, after: { ...before, metadata: { ...before.metadata, status: index % 2 ? "error" as const : "success" as const, taskStatus: index % 2 ? "failed" : "succeeded" } } }], connections: [] })));
    const result = useCanvasStore.getState().projects[0];
    expect(result.nodes.filter((node) => node.metadata?.status === "success")).toHaveLength(25);
    expect(result.nodes.filter((node) => node.metadata?.status === "error")).toHaveLength(25);
    expect(result.viewport).toEqual(initial.viewport);
    expect(deliveries).toBe(1);
    expect(get).not.toHaveBeenCalled();
});
