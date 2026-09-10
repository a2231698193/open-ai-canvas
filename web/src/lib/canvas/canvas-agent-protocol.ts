import { SKILL_RUNTIME_AGENT_GUIDANCE, skillRuntime } from "@/services/skill-runtime";
import type { ResponseToolCall } from "@/services/api/image";

export const CANVAS_ONLINE_AGENT_PROMPT =
    `你是当前创作工作台内置的在线画布助手。首轮必须先调用 canvas_get_context；涉及已有节点时用 canvas_find_nodes 获取真实 id，涉及媒体参考时用 canvas_get_resources。流水线、工作流、管线、节点图或用户要求连线时，必须使用 canvas_create_workflow：把需求拆成有语义的节点类型、真实内容/提示词、边和布局，禁止把业务阶段退化成几个空文本卡片；工具会自动分配 id、布局并建立连线。复杂写操作先 canvas_validate_ops，再执行 canvas_apply_ops。任何写入后都必须检查工具返回的真实节点类型、connectionCount、overlapWarnings 和 verification；没有真实连线时绝不能说已连线，没有生成资源时绝不能说已完成。不要输出 JSON ops、不要猜 id、不要把未就绪资源当作可用素材、不要编造执行结果。需要用户选择时，给出可点击的短选项，不要只让用户输入 1、2、3。${SKILL_RUNTIME_AGENT_GUIDANCE}`;

export const CANVAS_READ_TOOL_NAMES = [
    "canvas_get_state",
    "canvas_get_context",
    "canvas_find_nodes",
    "canvas_get_node",
    "canvas_get_connection",
    "canvas_get_generation_tasks",
    "canvas_get_resources",
    "canvas_validate_ops",
    "canvas_get_selection",
    "canvas_export_snapshot",
] as const;

const CANVAS_READ_TOOL_NAME_SET = new Set<string>(CANVAS_READ_TOOL_NAMES);

export function isCanvasReadTool(name: string) {
    return CANVAS_READ_TOOL_NAME_SET.has(name) || skillRuntime.agentToolNames("onlineAgent").has(name);
}

export function isWritableToolCall(call: ResponseToolCall) {
    return !isCanvasReadTool(call.function.name);
}

export function buildCanvasOnlineAgentSystemContent(skillCatalog: string) {
    return [CANVAS_ONLINE_AGENT_PROMPT, skillCatalog ? `当前可按需加载的技能（仅元数据）：\n${skillCatalog}` : ""].filter(Boolean).join("\n\n");
}
