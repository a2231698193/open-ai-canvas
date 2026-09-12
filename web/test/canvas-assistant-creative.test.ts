import { describe, expect, test } from "bun:test";

import { CANVAS_ONLINE_AGENT_TOOLS } from "@/lib/canvas/canvas-agent-tools";
import { buildToolAgentMessages } from "@/components/canvas/canvas-assistant-online-tools";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasAssistantMessage } from "@/types/canvas";

const snapshot: CanvasAgentSnapshot = {
    projectId: "canvas",
    title: "测试画布",
    nodes: [],
    connections: [],
    selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 },
};

describe("画布在线创作交互", () => {
    test("在线工具清单包含 creative_respond", () => {
        expect(CANVAS_ONLINE_AGENT_TOOLS.some((tool) => tool.function.name === "creative_respond")).toBe(true);
    });

    test("创作请求携带创作指导和结构化上下文", async () => {
        const history: CanvasAssistantMessage[] = [{ id: "user-1", role: "user", text: "我想做一个短片" }];
        const messages = await buildToolAgentMessages(snapshot, history, { id: "user-2", role: "user", text: "先问我关键需求" }, [], {
            creative: {
                scene: "short-film",
                brief: {},
                executionResults: [],
                references: [{ id: "asset-1", title: "参考图", kind: "image" }],
            },
        });
        const system = messages.find((message) => message.role === "system");
        const user = messages.findLast((message) => message.role === "user");
        expect(system?.content).toContain("多步骤创作使用 creative_respond");
        expect(user?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("创作上下文") })]));
    });
});
