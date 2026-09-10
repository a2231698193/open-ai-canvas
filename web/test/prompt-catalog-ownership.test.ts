import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CANVAS_READ_TOOL_NAMES, isCanvasReadTool, isWritableToolCall } from "@/lib/canvas/canvas-agent-protocol";
import { CANVAS_ONLINE_AGENT_TOOLS } from "@/lib/canvas/canvas-agent-tools";
import { CANVAS_BUILTIN_PRESETS, IMAGE_PROMPT_REVERSE, parseGeneratedStory, workflowStarterPrompt } from "@/lib/prompts";

const webRoot = resolve(import.meta.dir, "..");

function source(relativePath: string) {
    return readFileSync(resolve(webRoot, relativePath), "utf8");
}

describe("prompt catalog ownership", () => {
    it("keeps product LLM instructions out of page and panel files", () => {
        const cases = [
            ["src/components/canvas/canvas-assistant-panel.tsx", "你是当前创作工作台内置的在线画布助手"],
            ["src/components/canvas/canvas-preset-picker.tsx", "生成角色设定图"],
            ["src/pages/canvas/use-canvas-media-tools.ts", "请根据参考图片反推"],
            ["src/lib/canvas/skill-drafting.ts", "你是一位技能编写助手"],
            ["src/pages/projects/index.tsx", "你是短剧编剧"],
            ["src/lib/canvas/canvas-agent-workflow.ts", "拆分主要角色，并为每个角色生成"],
            ["src/pages/canvas/use-canvas-generation-executor.ts", "请根据要求修改以下文本"],
            ["src/pages/tasks/index.tsx", "请对以下视频结果版本做对比分析"],
            ["src/components/canvas/canvas-local-agent-panel.tsx", 'name === "canvas_get_state" || name === "canvas_get_context"'],
        ] as const;
        for (const [file, snippet] of cases) {
            expect(source(file).includes(snippet), `${file} still embeds ${snippet}`).toBe(false);
        }
    });

    it("owns canvas starter prompts and short-drama parsing in the catalog", () => {
        expect(CANVAS_BUILTIN_PRESETS).toHaveLength(6);
        expect(IMAGE_PROMPT_REVERSE).toContain("只输出提示词正文");
        expect(workflowStarterPrompt("character_cards", "角色卡片", "夜灯")).toContain("拆分主要角色");
        const parsed = parseGeneratedStory('{"title":"夜灯","synopsis":"租客发现房东不是人","chapters":[{"title":"入住","content":"林夏搬进旧公寓。"}]}');
        expect(parsed).toEqual({
            title: "夜灯",
            synopsis: "租客发现房东不是人",
            chapters: [{ title: "入住", content: "林夏搬进旧公寓。" }],
        });
    });

    it("uses one read-tool list for online write-gate and local log classification", () => {
        const toolNames = CANVAS_ONLINE_AGENT_TOOLS.map((tool) => tool.function.name);
        for (const name of CANVAS_READ_TOOL_NAMES) {
            expect(toolNames).toContain(name);
            expect(isCanvasReadTool(name)).toBe(true);
            expect(isWritableToolCall({ id: name, type: "function", function: { name, arguments: "{}" } })).toBe(false);
        }
        expect(isWritableToolCall({ id: "write", type: "function", function: { name: "canvas_apply_ops", arguments: "{}" } })).toBe(true);
    });
});
