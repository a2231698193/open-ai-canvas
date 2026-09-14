import { describe, expect, it } from "bun:test";

import { agentApprovalPresentation } from "@/lib/canvas/agent-approval-presentation";

describe("Agent approval presentation", () => {
    const args = JSON.stringify({ snapshotHash: "private-hash", ops: [
        { type: "add_node", title: "开场分镜", content: "private script" },
        { type: "update_node", title: "结尾台词", content: "private dialogue" },
    ] });

    it("summarizes a persisted approval without exposing tool names or content", () => {
        const view = agentApprovalPresentation({ call: { function: { name: "canvas_apply_ops", arguments: args } } });
        expect(view.title).toBe("确认画布修改");
        expect(view.description).toContain("新增 1 个节点，修改 1 个节点");
        expect(view.items).toEqual(["开场分镜", "结尾台词"]);
        expect(JSON.stringify(view)).not.toContain("private");
        expect(JSON.stringify(view)).not.toContain("canvas_apply_ops");
    });

    it("summarizes an event approval and media request", () => {
        expect(agentApprovalPresentation({ toolName: "canvas_apply_ops", arguments: JSON.parse(args) }).items).toEqual(["开场分镜", "结尾台词"]);
        expect(agentApprovalPresentation({ toolName: "generate_media", arguments: { mode: "video" } }).title).toBe("确认生成视频");
    });

    it("uses a safe fallback for malformed arguments", () => {
        expect(agentApprovalPresentation({ toolName: "canvas_apply_ops", arguments: "{" }).description).toContain("修改当前画布");
    });

    it("shows approved media specifications and references without exposing prompts or IDs", () => {
        const view = agentApprovalPresentation({ toolName: "generate_media", arguments: {
            mode: "video", title: "镜头1", durationSeconds: 12, size: "9:16", quality: "720p",
            videoGenerateAudio: false, referenceNodeIds: ["private-cat", "private-hero"], prompt: "private prompt",
        } });
        expect(view.description).toContain("结果自动回写画布");
        expect(view.items).toEqual(["节点：镜头1", "引用 2 个画布资产，并建立连线", "时长：12 秒", "画幅：9:16", "质量：720p", "音频：关闭"]);
        expect(JSON.stringify(view)).not.toContain("private");
    });

    it("summarizes reference connections as canvas edits without generation", () => {
        const view = agentApprovalPresentation({ toolName: "canvas_apply_ops", arguments: { ops: [
            { type: "add_node", title: "视频节点" }, { type: "connect_nodes" }, { type: "connect_nodes" },
        ] } });
        expect(view.description).toContain("新增 1 个节点，建立 2 条引用连线");
        expect(view.description).not.toContain("提交任务");
    });

    it("shows the real catalog model and states that a draft is not a submitted task", () => {
        const view = agentApprovalPresentation({ modelName: "用户选择的模型", toolName: "generate_media", arguments: { mode: "video", channelModelKey: "internal-key", size: "16:9" } });
        expect(view.items).toContain("模型：用户选择的模型");
        expect(view.items).toContain("画幅：16:9");
        expect(view.description).toContain("尚未提交生成");
        expect(view.description).toContain("拒绝则保留草稿");
    });
});
