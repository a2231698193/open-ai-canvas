import { expect, test } from "bun:test";
import { buildAgentStoryboardDraft, buildAgentStoryboardOperations, validateAgentStoryboardCreation } from "../src/lib/canvas/canvas-agent-storyboard";
import { inspectStoryboardReadiness } from "../src/lib/canvas/canvas-storyboard-context";
import { buildCanvasAgentContext } from "../src/lib/canvas/canvas-agent-context";
import { createShortDramaPipeline } from "../src/lib/canvas/canvas-short-drama";
import { createStoryboardRow } from "../src/lib/canvas/canvas-project-domain";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { prepareAnalysisNodeAction } from "../src/lib/plugins/analysis-node-action";

function fixture() {
    const pipeline = createShortDramaPipeline({ x: 0, y: 0 });
    const script = pipeline.nodes.find((node) => node.type === "script")!;
    script.metadata!.storyboard!.rows = [createStoryboardRow(1, { id: "row-1", videoNodeId: "video-1", imageNodeId: "image-1", dialogue: "旧对白" }), createStoryboardRow(2, { id: "row-2" })];
    const snapshot: CanvasAgentSnapshot = { projectId: "test", title: "test", nodes: pipeline.nodes, connections: pipeline.connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    return { snapshot, script };
}

test("待拆镜入口保存原始剧本但不伪造已完成的镜头", () => {
    const { snapshot } = fixture();
    const result = applyCanvasAgentOps(snapshot, buildAgentStoryboardDraft({ title: "旧机来电", prompt: "手机突然响起", x: 500, y: 100 }));
    const node = result.nodes.find((item) => item.title === "旧机来电")!;
    expect(node.type).toBe("script");
    expect(node.metadata?.composerContent).toBe("手机突然响起");
    expect(node.metadata?.storyboard?.rows).toEqual([]);
    expect(node.metadata?.workflowDescription).toContain("尚未生成");
});

test("Agent 上下文提前指出未选择画风及分镜空行", () => {
    const { snapshot, script } = fixture();
    const readiness = buildCanvasAgentContext(snapshot).storyboardReadiness;
    expect(readiness.canGenerateStoryboard).toBe(false);
    expect(readiness.style.ready).toBe(false);
    expect(readiness.blockingReason).toContain("画风");
    expect(readiness.storyboards.find((item) => item.nodeId === script.id)?.incompleteRowIds).toEqual(["row-1", "row-2"]);
    expect(readiness.nextActions.join(" ")).toContain("canvas_apply_style");
});

test("已应用画风与真实分镜写入后，返回实际总时长", () => {
    const { snapshot, script } = fixture();
    const style = snapshot.nodes.find((node) => node.metadata?.workflowKind === "styleboard")!;
    style.metadata = { ...style.metadata, stylePresetId: "preset", content: "电影写实" };
    script.metadata!.storyboard!.rows = [2, 2, 3, 2, 1].map((durationSeconds, i) => createStoryboardRow(i + 1, { durationSeconds, videoMotionPrompt: `镜头${i + 1}` }));
    const readiness = inspectStoryboardReadiness(snapshot.nodes);
    expect(readiness.canGenerateStoryboard).toBe(true);
    expect(readiness.storyboards[0]).toMatchObject({ rowCount: 5, populated: true, totalDurationSeconds: 10 });
    expect(readiness.nextActions).toEqual([]);
});

test("通用节点创建不能用正文代替真实分镜行", () => {
    expect(() => validateAgentStoryboardCreation([{ type: "add_node", nodeType: "script", metadata: { content: "镜头1：0–2秒近景；镜头2：2–4秒特写" } }])).toThrow("真实镜头行");
    const { script } = fixture();
    expect(() => validateAgentStoryboardCreation([{ type: "add_node", nodeType: "script", metadata: script.metadata }])).toThrow();
});

test("按行修改保留其他镜头及已有生成素材关联", () => {
    const { snapshot, script } = fixture();
    const next = applyCanvasAgentOps(snapshot, buildAgentStoryboardOperations(snapshot, { nodeId: script.id, action: "update", rowId: "row-1", patch: { dialogue: "新对白", durationSeconds: 8 } }));
    const rows = next.nodes.find((node) => node.id === script.id)!.metadata!.storyboard!.rows;
    expect(rows[0]).toMatchObject({ id: "row-1", dialogue: "新对白", durationSeconds: 8, imageNodeId: "image-1", videoNodeId: "video-1" });
    expect(rows[1]).toEqual(script.metadata!.storyboard!.rows[1]);
});

test("移除分镜只更新表格，保留行 ID 并重排序号", () => {
    const { snapshot, script } = fixture();
    const ops = buildAgentStoryboardOperations(snapshot, { nodeId: script.id, action: "remove", rowId: "row-1" });
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("update_node");
    if (ops[0].type === "update_node") expect(ops[0].metadata?.storyboard?.rows[0]).toMatchObject({ id: "row-2", shotNumber: 1 });
});

test("分镜编辑拒绝伪造结果、未知行和非法时长", () => {
    const { snapshot, script } = fixture();
    for (const patch of [{ status: "success" }, { videoNodeId: "fake" }, { durationSeconds: -1 }]) {
        expect(() => buildAgentStoryboardOperations(snapshot, { nodeId: script.id, action: "update", rowId: "row-1", patch })).toThrow();
    }
    expect(() => buildAgentStoryboardOperations(snapshot, { nodeId: script.id, action: "remove", rowId: "missing" })).toThrow();
});

test("分析节点准备复用相同输入且不启动模型", () => {
    const { snapshot, script } = fixture();
    snapshot.nodes.push({ ...script, id: "source", type: "image", metadata: { storageKey: "resource:image" } });
    const action = prepareAnalysisNodeAction("test-analysis", "分析", () => ({}));
    const ops = action.buildOperations({ sourceNodeId: "source" }, snapshot);
    expect(ops.some((op) => op.type === "run_generation")).toBe(false);
    expect(ops.some((op) => op.type === "connect_nodes")).toBe(true);
    snapshot.nodes.push({ ...script, id: "analysis", type: "test-analysis" });
    snapshot.connections.push({ id: "edge", fromNodeId: "source", toNodeId: "analysis" });
    expect(action.buildOperations({ sourceNodeId: "source" }, snapshot)).toEqual([{ type: "select_nodes", ids: ["analysis"] }]);
});
