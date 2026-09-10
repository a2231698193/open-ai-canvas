import { afterEach, expect, test } from "bun:test";
import { registerPlugin, unregisterPlugin } from "../src/lib/plugins/plugin-registry";
import { usePluginStore } from "../src/stores/use-plugin-store";
import { listAgentCapabilities, buildAgentPluginOperations } from "../src/services/agent-capabilities";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { normalizeCreativeProposal, creativeProposalOps } from "../src/lib/creation/creative-agent-state";
import { defaultConfig } from "../src/stores/use-config-store";
import { buildCanvasWorkflowOps } from "../src/lib/canvas/canvas-agent-workflow";

const snapshot: CanvasAgentSnapshot = { projectId: "test", title: "test", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
const pluginId = "agent-extension-test";
afterEach(() => { unregisterPlugin(pluginId); usePluginStore.setState({ runtimeStatuses: {} }); });

test("方案与直接工作流均拒绝只有正文的分镜", () => {
    const nodes = [{ ref: "shots", kind: "script" as const, title: "10秒分镜", content: "0–2秒近景，2–10秒特写" }];
    expect(() => normalizeCreativeProposal({ title: "短剧", summary: "分镜", markdown: "方案", workflow: { nodes, edges: [] }, generationItems: [] }, "p", 1, defaultConfig)).toThrow("script.shots");
    expect(() => buildCanvasWorkflowOps({ nodes, edges: [] }, snapshot, defaultConfig)).toThrow("shots");
});

test("专业方案创建可编辑分镜与上下文连线，不伪造画风已选择或收费任务", () => {
    const proposal = normalizeCreativeProposal({ title: "短剧", summary: "搭建", markdown: "完整方案", workflow: { nodes: [
        { ref: "style", kind: "styleboard", title: "项目画风" },
        { ref: "story", kind: "story_input", title: "故事", content: "两个人重逢" },
        { ref: "shots", kind: "script", title: "分镜", shots: [{ durationSeconds: 5, videoMotionPrompt: "推近人物", dialogue: "好久不见" }] },
    ], edges: [{ from: "style", to: "shots" }, { from: "story", to: "shots" }] }, generationItems: [] }, "p", 1, defaultConfig);
    const result = applyCanvasAgentOps(snapshot, creativeProposalOps("run", proposal, snapshot, defaultConfig));
    expect(result.nodes.find((node) => node.metadata?.workflowKind === "styleboard")?.metadata?.content).toBe("");
    const script = result.nodes.find((node) => node.type === "script")!;
    expect(script.metadata?.storyboard?.rows[0]?.dialogue).toBe("好久不见");
    expect(result.connections.every((edge) => edge.toHandleId === "storyboard:context")).toBe(true);
    expect(proposal.generationItems).toHaveLength(0);
});

test("插件注册后可发现和创建真实类型，停用后立即拒绝新调用", () => {
    registerPlugin({ manifest: { id: pluginId, name: "测试扩展", version: "1", apiVersion: "yingce.plugin/v1", description: "测试", surfaces: ["node"], permissions: ["canvas.write"], runtime: { web: "declarative" }, contributes: { canvasNodes: [{ id: "test-special-node", label: "专用节点", defaultTitle: "测试", defaultSize: { width: 400, height: 300 }, schema: {}, renderer: "declarative" }] } }, agentActions: [{ id: "create", description: "创建", inputSchema: {}, buildOperations: () => [{ type: "add_node", nodeType: "test-special-node" }] }] });
    usePluginStore.setState({ runtimeStatuses: { [pluginId]: "enabled" } });
    expect(listAgentCapabilities("专用节点").length).toBeGreaterThan(0);
    const ops = buildAgentPluginOperations(pluginId, "create", {}, snapshot);
    expect(applyCanvasAgentOps(snapshot, ops).nodes[0]?.type).toBe("test-special-node");
    usePluginStore.setState({ runtimeStatuses: { [pluginId]: "disabled" } });
    expect(listAgentCapabilities("专用节点")).toHaveLength(0);
    expect(() => buildAgentPluginOperations(pluginId, "create", {}, snapshot)).toThrow();
    expect(() => applyCanvasAgentOps(snapshot, ops)).toThrow();
});

test("未知节点不能静默降级成文本", () => {
    expect(() => applyCanvasAgentOps(snapshot, [{ type: "add_node", nodeType: "missing-plugin-node" }])).toThrow();
});
