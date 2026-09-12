import { nanoid } from "nanoid";
import { type AiTextMessage, type ResponseInputMessage, type ResponseToolCall } from "@/services/api/image";
import { runBackendToolGenerationTask } from "@/services/api/generation-task";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { normalizeModelOptionValue, resolveModelRequestConfig, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType, type CanvasAssistantMessage, type CanvasAssistantReference, type CanvasAssistantSession, type CanvasNodeData } from "@/types/canvas";
import { previewCanvasAgentOps, type CanvasAgentOp, type CanvasAgentOperationImpact, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { isWritableToolCall, buildCanvasOnlineAgentSystemContent } from "@/lib/canvas/canvas-agent-protocol";
import { CANVAS_ONLINE_AGENT_TOOLS } from "@/lib/canvas/canvas-agent-tools";
import { buildOrderedCanvasResourceReferences, canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import { buildCanvasWorkflowOps, looksLikeWorkflowRequest, type CanvasWorkflowInput } from "@/lib/canvas/canvas-agent-workflow";
import type { Skill } from "@/services/api/skills";
import { AGENT_CAPABILITY_GUIDANCE } from "@/services/agent-capabilities";
import { budgetCanvasAgentHistory } from "@/lib/canvas/canvas-agent-context-budget";
import { CREATIVE_AGENT_SYSTEM_PROMPT } from "@/lib/creation/creative-agent-tools";
import { creativeScenarioPrompt, type CreativeBrief, type CreativeScenarioId } from "@/lib/creation/creative-agent-contract";
import type { CreativeDynamicPlan } from "@/lib/creation/creative-plan";
import type { CreativeReference } from "@/lib/creation/creative-agent-state";

export type OnlineToolResult = { ok: true; message: string; data?: unknown; waitForUser?: boolean } | { ok: false; message: string };

export type CreativeOnlineContext = {
    scene: CreativeScenarioId;
    brief: CreativeBrief;
    plan?: CreativeDynamicPlan;
    previousProposal?: unknown;
    rejectedProposal?: unknown;
    previousQuestions?: unknown;
    answers?: unknown;
    executionResults: unknown[];
    media?: unknown;
    references: CreativeReference[];
    sourceContext?: unknown[];
};

export type BuildToolAgentMessagesOptions = {
    config?: AiConfig;
    confirmTools?: boolean;
    creative?: CreativeOnlineContext;
};

export function objectDetail(value: unknown) {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function describeCanvasSnapshot(snapshot: CanvasAgentSnapshot) {
    const counts = snapshot.nodes.reduce<Record<string, number>>((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
    }, {});
    return `当前画布有 ${snapshot.nodes.length} 个节点、${snapshot.connections.length} 条连线。背板 ${counts[CanvasNodeType.Frame] || 0} 个，文本 ${counts[CanvasNodeType.Text] || 0} 个，绘图 ${counts[CanvasNodeType.Drawing] || 0} 个，分镜脚本 ${counts[CanvasNodeType.Script] || 0} 个，技能 ${counts[CanvasNodeType.Skill] || 0} 个，图片 ${counts[CanvasNodeType.Image] || 0} 个，生成配置 ${counts[CanvasNodeType.Config] || 0} 个，视频 ${counts[CanvasNodeType.Video] || 0} 个，音频 ${counts[CanvasNodeType.Audio] || 0} 个。`;
}

export function parseToolArguments(value: string) {
    try {
        const parsed = JSON.parse(value || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("工具参数必须是 JSON 对象");
        return parsed as Record<string, unknown>;
    } catch {
        throw new Error("工具参数不是合法 JSON 对象");
    }
}

/**
 * 把在线 Agent 的工具调用转换为可审计的画布操作，不在这里直接修改 store。
 * 只读工具不会进入该函数；写操作先由上层确认，并以 snapshot 生成的 revision/hash 做并发保护，执行失败时保留原始工具消息和错误。
 */

export function onlineToolToOps(name: string, input: Record<string, unknown>, snapshot: CanvasAgentSnapshot, config: AiConfig): CanvasAgentOp[] {
    if (name === "canvas_apply_ops") return requireOps(input.ops);
    if (name === "canvas_create_workflow") return buildCanvasWorkflowOps(input as unknown as CanvasWorkflowInput, snapshot, config);
    if (name === "canvas_create_node") {
        const nodeType = requireNodeType(input.nodeType);
        const x = numberOr(input.x, nextCanvasX(snapshot));
        const y = numberOr(input.y, 0);
        return [{ type: "add_node", nodeType, title: stringOptional(input.title), position: { x, y }, width: numberOptional(input.width), height: numberOptional(input.height), metadata: recordOptional(input.metadata) as CanvasNodeData["metadata"] }];
    }
    if (name === "canvas_create_text_node") return [textNodeOp(input, numberOr(input.x, nextCanvasX(snapshot)), numberOr(input.y, 0))];
    if (name === "canvas_create_text_nodes") {
        const items = requireRecordArray(input.items, "items");
        const textBatch = items.map((item) => `${String(item.title || "")} ${String(item.text || "")}`).join(" ");
        if (looksLikeWorkflowRequest(textBatch)) throw new Error("检测到流水线/工作流意图，请使用 canvas_create_workflow 创建真实类型节点和连线。");
        const x = numberOr(input.x, nextCanvasX(snapshot));
        const y = numberOr(input.y, 0);
        const gap = numberOr(input.gap, 40);
        const direction = input.direction === "row" ? "row" : "column";
        return items.map((item, index) =>
            textNodeOp(
                { ...item, text: requireString(item.text, "text") },
                numberOr(item.x, direction === "row" ? x + index * (NODE_DEFAULT_SIZE[CanvasNodeType.Text].width + gap) : x),
                numberOr(item.y, direction === "row" ? y : y + index * (NODE_DEFAULT_SIZE[CanvasNodeType.Text].height + gap)),
            ),
        );
    }
    if (name === "canvas_create_image_prompt_flow") return generationFlowOps({ ...input, mode: "image" }, snapshot, config);
    if (name === "canvas_create_generation_flow") return generationFlowOps(input, snapshot, config);
    if (name === "canvas_generate_text") return generationFlowOps({ ...input, mode: "text", autoRun: true }, snapshot, config);
    if (name === "canvas_generate_image") return generationFlowOps({ ...input, mode: "image", autoRun: true }, snapshot, config);
    if (name === "canvas_generate_video") return generationFlowOps({ ...input, mode: "video", autoRun: true }, snapshot, config);
    if (name === "canvas_generate_audio") return generationFlowOps({ ...input, mode: "audio", autoRun: true }, snapshot, config);
    if (name === "canvas_update_node") return [{ type: "update_node", id: requireString(input.id, "id"), patch: recordOptional(input.patch) as Partial<CanvasNodeData> | undefined, metadata: recordOptional(input.metadata) as CanvasNodeData["metadata"] }];
    if (name === "canvas_update_node_text")
        return [{ type: "update_node", id: requireString(input.id, "id"), patch: stringOptional(input.title) ? { title: stringOptional(input.title) } : undefined, metadata: { content: requireString(input.text, "text"), status: "success" } }];
    if (name === "canvas_move_nodes") {
        return requireRecordArray(input.items, "items").map((item) => {
            const id = requireString(item.id, "id");
            const current = snapshot.nodes.find((node) => node.id === id);
            return { type: "update_node", id, patch: { position: { x: numberOr(item.x, (current?.position.x || 0) + numberOr(item.dx, 0)), y: numberOr(item.y, (current?.position.y || 0) + numberOr(item.dy, 0)) } } };
        });
    }
    if (name === "canvas_resize_node")
        return [
            {
                type: "update_node",
                id: requireString(input.id, "id"),
                patch: { width: requireNumber(input.width, "width"), height: requireNumber(input.height, "height") },
                metadata: typeof input.freeResize === "boolean" ? { freeResize: input.freeResize } : undefined,
            },
        ];
    if (name === "canvas_delete_nodes") return [{ type: "delete_node", ids: requireStringArray(input.ids, "ids") }];
    if (name === "canvas_connect_nodes")
        return requireRecordArray(input.connections, "connections").map((connection) => ({ type: "connect_nodes", fromNodeId: requireString(connection.fromNodeId, "fromNodeId"), toNodeId: requireString(connection.toNodeId, "toNodeId") }));
    if (name === "canvas_select_nodes") return [{ type: "select_nodes", ids: requireStringArray(input.ids, "ids") }];
    if (name === "canvas_set_viewport") return [{ type: "set_viewport", viewport: requireViewport(input.viewport) }];
    if (name === "canvas_run_generation") return [runGenerationOp(requireString(input.nodeId, "nodeId"), generationMode(input.mode), stringOptional(input.prompt), input.retry === true)];
    throw new Error(`不支持的工具：${name}`);
}

function generationFlowOps(input: Record<string, unknown>, snapshot: CanvasAgentSnapshot, config: AiConfig): CanvasAgentOp[] {
    const mode = generationMode(input.mode);
    const prompt = requireString(input.prompt, "prompt");
    const x = numberOr(input.x, nextCanvasX(snapshot));
    const y = numberOr(input.y, 0);
    const textId = `text-${nanoid()}`;
    const targetId = `${mode}-${nanoid()}`;
    const referenceNodeIds = Array.isArray(input.referenceNodeIds) ? input.referenceNodeIds.filter((id): id is string => typeof id === "string") : [];
    const promptNode: CanvasNodeData = {
        id: textId,
        type: CanvasNodeType.Text,
        title: stringOptional(input.title) || "提示词",
        position: { x, y },
        width: NODE_DEFAULT_SIZE[CanvasNodeType.Text].width,
        height: NODE_DEFAULT_SIZE[CanvasNodeType.Text].height,
        metadata: { content: prompt },
    };
    const referenceNodes = referenceNodeIds.flatMap((id) => {
        const node = snapshot.nodes.find((candidate) => candidate.id === id);
        return node ? [node] : [];
    });
    const tokens = buildOrderedCanvasResourceReferences([promptNode, ...referenceNodes]).map(canvasResourceMentionToken);
    return [
        textNodeOp({ id: textId, text: prompt, title: stringOptional(input.title) || "提示词" }, x, y),
        generationTargetNodeOp(targetId, { ...input, prompt: tokens.join("\n") }, x + NODE_DEFAULT_SIZE[CanvasNodeType.Text].width + 80, y, config),
        { type: "connect_nodes", fromNodeId: textId, toNodeId: targetId },
        ...referenceNodeIds.map((fromNodeId) => ({ type: "connect_nodes" as const, fromNodeId, toNodeId: targetId })),
        { type: "select_nodes", ids: [targetId] },
        ...(input.autoRun ? [runGenerationOp(targetId, mode, tokens.join("\n"))] : []),
    ];
}

function textNodeOp(input: Record<string, unknown>, x: number, y: number): CanvasAgentOp {
    return {
        type: "add_node",
        id: stringOptional(input.id),
        nodeType: CanvasNodeType.Text,
        title: stringOptional(input.title),
        position: { x, y },
        width: numberOptional(input.width),
        height: numberOptional(input.height),
        metadata: { content: stringOptional(input.text), status: "success", fontSize: 14 },
    };
}

function generationTargetNodeOp(id: string, input: Record<string, unknown>, x: number, y: number, config: AiConfig): CanvasAgentOp {
    const mode = generationMode(input.mode);
    const prompt = stringOptional(input.prompt);
    const nodeType = generationNodeType(mode);
    return {
        type: "add_node",
        id,
        nodeType,
        title: stringOptional(input.title) || generationTitle(mode),
        position: { x, y },
        width: numberOptional(input.width),
        height: numberOptional(input.height),
        metadata: cleanRecord({
            content: "",
            fontSize: nodeType === CanvasNodeType.Text ? 14 : undefined,
            generationMode: mode,
            composerContent: prompt,
            prompt,
            status: "idle",
            model: resolveGenerationModel(config, mode, stringOptional(input.model)),
            size: stringOptional(input.size) || config.size,
            quality: stringOptional(input.quality) || config.quality,
            transparentBackground: stringOptional(input.transparentBackground) || config.transparentBackground,
            count: numberOptional(input.count) ?? generationCount(mode === "image" ? config.canvasImageCount || config.count : config.count),
            seconds: stringOptional(input.seconds) || config.videoSeconds,
            vquality: stringOptional(input.vquality) || config.vquality,
            generateAudio: stringOptional(input.generateAudio) || config.videoGenerateAudio,
            watermark: stringOptional(input.watermark) || config.videoWatermark,
            audioVoice: stringOptional(input.audioVoice) || config.audioVoice,
            audioFormat: stringOptional(input.audioFormat) || config.audioFormat,
            audioSpeed: stringOptional(input.audioSpeed) || config.audioSpeed,
            audioInstructions: stringOptional(input.audioInstructions) || config.audioInstructions,
        }) as CanvasNodeData["metadata"],
    };
}

function generationNodeType(mode: "text" | "image" | "video" | "audio") {
    if (mode === "text") return CanvasNodeType.Text;
    if (mode === "video") return CanvasNodeType.Video;
    if (mode === "audio") return CanvasNodeType.Audio;
    return CanvasNodeType.Image;
}

function runGenerationOp(nodeId: string, mode: "text" | "image" | "video" | "audio", prompt?: string, retry?: boolean): CanvasAgentOp {
    return { type: "run_generation", nodeId, mode, prompt, ...(retry ? { retry: true } : {}) };
}

export function toolCallsFromDetail(detail: Record<string, unknown>): ResponseToolCall[] {
    return Array.isArray(detail.toolCalls) ? (detail.toolCalls.filter(isResponseToolCall) as ResponseToolCall[]) : [];
}

function isResponseToolCall(value: unknown): value is ResponseToolCall {
    const item = objectDetail(value);
    const fn = objectDetail(item.function);
    return typeof item.id === "string" && item.type === "function" && typeof fn.name === "string" && typeof fn.arguments === "string";
}

export function toolCallToResponseInput(call: ResponseToolCall): ResponseInputMessage {
    return { type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments, ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) };
}

// 上游兼容兜底：DeepSeek 等 OpenAI 兼容渠道的思考/推理模式不允许
// tool_choice=required（后端归类文案见 providerPayloadErrorCategory）。
// required 只用于对话首步把智能体拖入工具循环；遇到该类拒绝时降级为 auto
// 重试一次——auto 在思考模式下可用，对话与工具调用均不受影响。
// 语义与 image.ts 对非 auto tool_choice 的兼容降级策略一致。
const THINKING_MODE_TOOL_CHOICE_REJECTION = "不支持强制工具调用";

export async function requestOnlineAgentModel(config: AiConfig, messages: ResponseInputMessage[], toolChoice: "auto" | "required", prompt: string, onDelta: (text: string) => void) {
    const submit = (choice: "auto" | "required") => runBackendToolGenerationTask({ prompt, config, messages, tools: CANVAS_ONLINE_AGENT_TOOLS, toolChoice: choice, onDelta });
    try {
        return await submit(toolChoice);
    } catch (error) {
        if (toolChoice !== "required" || !(error instanceof Error) || !error.message.includes(THINKING_MODE_TOOL_CHOICE_REJECTION)) {
            throw error;
        }
        return submit("auto");
    }
}

export function summarizeToolCalls(calls: ResponseToolCall[]) {
    return calls.map((call) => toolCallLabel(call.function.name)).join("，") || "工具调用";
}

/** 返回待确认工具批次的用户可读类别，避免主交互流程重复猜测工具语义。 */
export function capabilityBatchTitle(calls: ResponseToolCall[]) {
    const names = calls.map((call) => call.function.name);
    if (names.some((name) => name.startsWith("canvas_") && (name.includes("skill") || name.includes("plugin")))) return "技能与插件";
    if (names.some((name) => name.startsWith("canvas_"))) return "画布操作";
    return "工具调用";
}

export function previewOnlineToolCalls(calls: ResponseToolCall[], snapshot: CanvasAgentSnapshot, config: AiConfig): CanvasAgentOperationImpact {
    const ops: CanvasAgentOp[] = [];
    let deferredCinematicCount = 0;
    calls.filter(isWritableToolCall).forEach((call) => {
        if (call.function.name === "canvas_create_cinematic_session") {
            deferredCinematicCount += 1;
            return;
        }
        try {
            ops.push(...onlineToolToOps(call.function.name, parseToolArguments(call.function.arguments), snapshot, config));
        } catch {
            // 参数错误会在真正执行时显式失败；预览阶段只展示可确定的影响。
        }
    });
    const impact = previewCanvasAgentOps(ops, snapshot);
    if (!deferredCinematicCount) return impact;
    return {
        ...impact,
        operationCount: impact.operationCount + deferredCinematicCount,
        items: [...impact.items, "启动影视 Agent，会话完成后将剧本、分镜和生成节点写回当前画布"].slice(0, 8),
        warning: [impact.warning, "影视 Agent 的具体写回范围将在后端完成拆解后确定。"].filter(Boolean).join(" "),
    };
}

function toolCallLabel(name: string) {
    if (name === "canvas_list_skills") return "列出技能";
    if (name === "canvas_get_skill") return "读取技能入口";
    if (name === "canvas_list_skill_files") return "列出技能文件";
    if (name === "canvas_read_skill_file") return "读取技能文件";
    if (name === "canvas_search_skill_files") return "搜索技能文件";
    if (name === "canvas_apply_ops") return "画布操作";
    if (name === "canvas_get_state") return "读取画布";
    if (name === "canvas_get_context") return "读取上下文";
    if (name === "canvas_find_nodes") return "检索节点";
    if (name === "canvas_get_node") return "读取节点";
    if (name === "canvas_get_connection") return "读取连线";
    if (name === "canvas_get_generation_tasks") return "读取生成任务";
    if (name === "canvas_get_resources") return "读取资源";
    if (name === "canvas_validate_ops") return "校验操作";
    if (name === "canvas_get_selection") return "读取选区";
    if (name === "canvas_export_snapshot") return "导出快照";
    if (name === "canvas_create_cinematic_session") return "创建影视项目";
    if (name === "canvas_create_workflow") return "创建工作流";
    if (name === "canvas_create_node") return "创建节点";
    if (name === "canvas_create_text_node") return "创建文本";
    if (name === "canvas_create_text_nodes") return "批量创建文本";
    if (name === "canvas_create_image_prompt_flow") return "创建生图流程";
    if (name === "canvas_create_generation_flow") return "创建生成流程";
    if (name === "canvas_generate_text") return "生成文本";
    if (name === "canvas_generate_image") return "生成图片";
    if (name === "canvas_generate_video") return "生成视频";
    if (name === "canvas_generate_audio") return "生成音频";
    if (name === "canvas_update_node") return "更新节点";
    if (name === "canvas_update_node_text") return "更新文本";
    if (name === "canvas_move_nodes") return "移动节点";
    if (name === "canvas_resize_node") return "调整节点尺寸";
    if (name === "canvas_delete_nodes") return "删除节点";
    if (name === "canvas_connect_nodes") return "连接节点";
    if (name === "canvas_select_nodes") return "选择节点";
    if (name === "canvas_set_viewport") return "调整视口";
    if (name === "canvas_run_generation") return "触发生成";
    return name;
}

export function toolResultText(result: OnlineToolResult) {
    return result.message;
}

function requireStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value)) throw new Error(`${field} 必须是字符串数组`);
    if (!value.every((item) => typeof item === "string" && Boolean(item))) throw new Error(`${field} 必须只包含非空字符串`);
    return value as string[];
}

export function requireOps(value: unknown): CanvasAgentOp[] {
    if (!Array.isArray(value)) throw new Error("ops 必须是数组");
    return value.map(toCanvasAgentOp);
}

function toCanvasAgentOp(value: unknown): CanvasAgentOp {
    const item = objectDetail(value);
    const type = item.type;
    if (type === "add_node") {
        return {
            type,
            id: stringOptional(item.id),
            nodeType: item.nodeType ? requireNodeType(item.nodeType) : undefined,
            title: stringOptional(item.title),
            position: recordOptional(item.position) ? { x: requireNumber(objectDetail(item.position).x, "position.x"), y: requireNumber(objectDetail(item.position).y, "position.y") } : undefined,
            x: numberOptional(item.x),
            y: numberOptional(item.y),
            width: numberOptional(item.width),
            height: numberOptional(item.height),
            metadata: recordOptional(item.metadata) as CanvasNodeData["metadata"],
        };
    }
    if (type === "update_node") return { type, id: requireString(item.id, "id"), patch: recordOptional(item.patch) as Partial<CanvasNodeData> | undefined, metadata: recordOptional(item.metadata) as CanvasNodeData["metadata"] };
    if (type === "delete_node") return { type, id: stringOptional(item.id), ids: Array.isArray(item.ids) ? requireStringArray(item.ids, "ids") : undefined };
    if (type === "delete_connections") return { type, id: stringOptional(item.id), ids: Array.isArray(item.ids) ? requireStringArray(item.ids, "ids") : undefined, all: typeof item.all === "boolean" ? item.all : undefined };
    if (type === "connect_nodes") return { type, id: stringOptional(item.id), fromNodeId: requireString(item.fromNodeId, "fromNodeId"), toNodeId: requireString(item.toNodeId, "toNodeId") };
    if (type === "set_viewport") return { type, viewport: requireViewport(item.viewport) };
    if (type === "select_nodes") return { type, ids: requireStringArray(item.ids, "ids") };
    if (type === "run_generation") return { type, nodeId: requireString(item.nodeId, "nodeId"), mode: generationMode(item.mode), prompt: stringOptional(item.prompt), ...(item.retry === true ? { retry: true } : {}) };
    throw new Error("不支持的画布操作类型");
}

function requireRecordArray(value: unknown, field: string): Record<string, unknown>[] {
    if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`);
    return value.map((item) => {
        const record = objectDetail(item);
        if (!Object.keys(record).length) throw new Error(`${field} 必须只包含对象`);
        return record;
    });
}

export function requireString(value: unknown, field: string) {
    if (typeof value !== "string" || !value) throw new Error(`${field} 必须是非空字符串`);
    return value;
}

function requireNumber(value: unknown, field: string) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} 必须是数字`);
    return value;
}

function requireNodeType(value: unknown): CanvasNodeType {
    if (Object.values(CanvasNodeType).includes(value as CanvasNodeType)) return value as CanvasNodeType;
    throw new Error("节点类型必须是 text、image、config、video 或 audio");
}

function requireViewport(value: unknown) {
    const item = objectDetail(value);
    return { x: requireNumber(item.x, "viewport.x"), y: requireNumber(item.y, "viewport.y"), k: requireNumber(item.k, "viewport.k") };
}

function recordOptional(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringOptional(value: unknown) {
    return typeof value === "string" ? value : "";
}

function numberOptional(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberOr(value: unknown, fallback: number) {
    return numberOptional(value) ?? fallback;
}

function nextCanvasX(snapshot: CanvasAgentSnapshot) {
    return snapshot.nodes.length ? Math.max(...snapshot.nodes.map((node) => node.position.x + node.width)) + 80 : 0;
}

function generationMode(value: unknown): "text" | "image" | "video" | "audio" {
    return value === "text" || value === "video" || value === "audio" ? value : "image";
}

function generationTitle(mode: "text" | "image" | "video" | "audio") {
    if (mode === "text") return "文本生成";
    if (mode === "video") return "视频生成";
    if (mode === "audio") return "音频生成";
    return "图片生成";
}

function defaultGenerationModel(config: AiConfig, mode: "text" | "image" | "video" | "audio") {
    if (mode === "image") return config.imageModel || config.model;
    if (mode === "video") return config.videoModel || config.model;
    if (mode === "audio") return config.audioModel || config.model;
    return config.textModel || config.model;
}

function resolveGenerationModel(config: AiConfig, mode: "text" | "image" | "video" | "audio", model?: string) {
    const normalized = normalizeModelOptionValue(model, config.channels);
    return normalized && selectableModelsByCapability(config, mode).includes(normalized) ? normalized : defaultGenerationModel(config, mode);
}

function generationCount(value: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 1)));
}

function cleanRecord(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

export function snapshotSignature(snapshot: CanvasAgentSnapshot) {
    return JSON.stringify({ nodes: snapshot.nodes, connections: snapshot.connections, selectedNodeIds: snapshot.selectedNodeIds, viewport: snapshot.viewport });
}

export function explainNoop(ops: CanvasAgentOp[], snapshot: CanvasAgentSnapshot) {
    if (!ops.length) return "模型没有返回可执行的画布操作。";
    const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
    const connectionIds = new Set(snapshot.connections.map((conn) => conn.id));
    const deleteConnectionOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "delete_connections" }> => op.type === "delete_connections");
    const connectOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "connect_nodes" }> => op.type === "connect_nodes");
    const deleteNodeOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "delete_node" }> => op.type === "delete_node");
    const updateOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "update_node" }> => op.type === "update_node");
    const selectOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "select_nodes" }> => op.type === "select_nodes");
    const generationOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation");
    if (deleteConnectionOps.length && !snapshot.connections.length) return "画布当前没有连线可删除。";
    if (deleteConnectionOps.length && deleteConnectionOps.every((op) => !op.all && [...(op.ids || []), ...(op.id ? [op.id] : [])].every((id) => !connectionIds.has(id)))) return "没有找到要删除的连线。";
    if (connectOps.length && connectOps.every((op) => snapshot.connections.some((conn) => conn.fromNodeId === op.fromNodeId && conn.toNodeId === op.toNodeId))) return "这些节点已经存在对应连线，无需重复连接。";
    if (connectOps.length && connectOps.every((op) => !nodeIds.has(op.fromNodeId) || !nodeIds.has(op.toNodeId))) return "没有找到要连接的节点。";
    if (deleteNodeOps.length && deleteNodeOps.every((op) => op.nodeType === CanvasNodeType.Config) && !snapshot.nodes.some((node) => node.type === CanvasNodeType.Config)) return "画布当前没有生成配置节点可删除。";
    if (deleteNodeOps.length && deleteNodeOps.every((op) => [...(op.ids || []), ...(op.id ? [op.id] : [])].every((id) => !nodeIds.has(id)))) return "没有找到要删除的节点。";
    if (updateOps.length && updateOps.every((op) => !nodeIds.has(op.id))) return "没有找到要更新的节点。";
    if (selectOps.length && selectOps.every((op) => !(op.ids || []).some((id) => nodeIds.has(id)))) return "没有找到要选择的节点。";
    if (generationOps.length && generationOps.every((op) => !nodeIds.has(op.nodeId))) return "没有找到要触发生成的节点。";
    if (ops.every((op) => op.type === "set_viewport")) return "视图已经是目标状态。";
    if (selectOps.length && selectOps.every((op) => JSON.stringify(op.ids || []) === JSON.stringify(snapshot.selectedNodeIds))) return "选区已经是目标状态。";
    return "工具已执行，但画布状态没有变化；请在日志 tab 查看工具参数和执行前后状态。";
}

export function nodeToReference(node: CanvasNodeData): CanvasAssistantReference | null {
    if (node.type === CanvasNodeType.Image && (node.metadata?.content || node.metadata?.storageKey)) {
        return { id: node.id, type: node.type, title: node.title, dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
    }
    if (node.type === CanvasNodeType.Text && node.metadata?.content) {
        return { id: node.id, type: node.type, title: node.title, text: node.metadata.content };
    }
    if (node.type === CanvasNodeType.Skill && node.metadata?.skillSnapshot) {
        return { id: node.id, type: node.type, title: node.title, text: [node.metadata.skillSnapshot.name, node.metadata.skillSnapshot.template, node.metadata.skillSnapshot.outputContract].filter(Boolean).join("\n\n") };
    }
    return null;
}

export function buildAssistantReferences(nodes: CanvasNodeData[], selectedNodeIds: Set<string>) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return Array.from(selectedNodeIds)
        .map((id) => nodeById.get(id))
        .filter((node): node is CanvasNodeData => Boolean(node))
        .map(nodeToReference)
        .filter((item): item is CanvasAssistantReference => Boolean(item));
}

export async function buildToolAgentMessages(snapshot: CanvasAgentSnapshot, history: CanvasAssistantMessage[], userMessage: CanvasAssistantMessage, skills: Skill[] = [], options: BuildToolAgentMessagesOptions = {}): Promise<ResponseInputMessage[]> {
    const refs = userMessage.references || [];
    const imageRefs = refs.filter((item) => item.type === CanvasNodeType.Image);
    const unavailableImageRefs = imageRefs.filter((item) => !resourceIdFromStorageKey(item.storageKey));
    if (unavailableImageRefs.length) {
        const names = unavailableImageRefs.map((item) => item.title || item.id).join("、");
        throw new Error(`引用图片尚未同步到服务器：${names}。请等待上传完成后重试`);
    }
    const skillCatalog = skills
        .filter((skill) => skill.isAdded)
        .slice(0, 40)
        .map((skill) => `- ${skill.skillName}（${skill.skillId}，v${skill.version || "1"}，${skill.fileCount || 1} 文件）：${skill.description}`)
        .join("\n");
    const creative = options.creative;
    const executionGuidance =
        options.confirmTools === false
            ? "当前普通画布工具的逐次确认已关闭。用户请求范围内的操作可以直接调用，不要先征求重复授权；这不代表可以擅自扩大删除范围或跳过结构化方案、具体费用的批准。"
            : "当前普通画布工具由程序展示执行确认。用户目标和操作范围明确时直接提交工具，程序会处理确认，不要在工具确认之前再用文字问一遍。";
    const systemContent = [buildCanvasOnlineAgentSystemContent(skillCatalog), AGENT_CAPABILITY_GUIDANCE, executionGuidance, creative ? CREATIVE_AGENT_SYSTEM_PROMPT : "", creative ? creativeScenarioPrompt(creative.scene) : ""].filter(Boolean).join("\n\n");
    const historyMessages: AiTextMessage[] = history
        .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
        .map((message) => ({ role: message.role as "system" | "user" | "assistant", content: message.text }));
    const creativeContextText = creative
        ? `创作上下文：${JSON.stringify({
              brief: creative.brief,
              plan: creative.plan,
              previousProposal: creative.previousProposal,
              rejectedProposal: creative.rejectedProposal,
              previousQuestions: creative.previousQuestions,
              answers: creative.answers,
              executionResults: creative.executionResults,
              media: creative.media,
              references: creative.references,
              availableModels: options.config ? (["image", "video"] as const).flatMap((mode) => selectableModelsByCapability(options.config!, mode).map((model) => ({ mode, model, capability: modelCapabilityConfigFor(options.config!, model) }))) : [],
          })}\n已返回的执行状态不代表已观察画面。保留成功产物，若用户仅要求分析结果则只提供分析和下一步建议。新增或修改方案仍须确认，媒体生成仍须费用确认。`
        : "";
    const currentMessage: AiTextMessage = {
        role: "user",
        content: [
            ...refs.flatMap((item) => (item.text ? [{ type: "text" as const, text: `选中节点 ${item.title}：${item.text}` }] : [])),
            ...(creative?.sourceContext?.length
                ? [
                      {
                          type: "text" as const,
                          text: `首页接续记录（任务事实和资料目录，不代表新的执行批准）：${JSON.stringify(creative.sourceContext)}。沿用前序用户需求与技能引用；进入画布本身不要求重做作品，不把首页文本当成已获批准的画布操作。先检查当前真实节点，资源目录不等于已观察图片。`,
                      },
                  ]
                : []),
            { type: "text", text: `当前画布：${JSON.stringify(compactSnapshot(snapshot))}\n${creativeContextText}\n用户需求：${userMessage.text}` },
            ...(creative
                ? [
                      {
                          type: "text" as const,
                          text: `本次引用的图片（仅素材目录，尚未观察图片）：${JSON.stringify(refs.filter((item) => item.dataUrl || item.storageKey).map((item) => ({ id: item.id, title: item.title })))}。需要观察画面时调用 canvas_inspect_image；不能仅凭素材名称断言画面内容。`,
                      },
                  ]
                : []),
            ...imageRefs.map((item) => ({ type: "image_url" as const, image_url: { url: item.storageKey! } })),
        ],
    };
    return budgetCanvasAgentHistory({ role: "system", content: systemContent }, historyMessages, currentMessage);
}

export function compactSnapshot(snapshot: CanvasAgentSnapshot) {
    return {
        title: snapshot.title,
        viewport: snapshot.viewport,
        selectedNodeIds: snapshot.selectedNodeIds,
        nodes: snapshot.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            title: node.title,
            position: node.position,
            width: node.width,
            height: node.height,
            metadata: compactMetadata(node.metadata || {}),
        })),
        connections: snapshot.connections,
    };
}

function compactMetadata(metadata: CanvasNodeData["metadata"]) {
    return {
        content: String(metadata?.content || "").slice(0, 500),
        prompt: String(metadata?.prompt || metadata?.composerContent || "").slice(0, 500),
        status: metadata?.status,
        skillName: metadata?.skillSnapshot?.name,
        skillVersion: metadata?.skillSnapshot?.version,
        generationMode: metadata?.generationMode,
        model: metadata?.model,
        size: metadata?.size,
        assetTags: metadata?.assetTags,
        workflowKind: metadata?.workflowKind,
        workflowTitle: metadata?.workflowTitle,
        workflowDescription: metadata?.workflowDescription,
        characterName: metadata?.characterName,
        characterAssetId: metadata?.characterAssetId,
        characterVersionId: metadata?.characterVersionId,
        chapterId: metadata?.chapterId,
        chapterTitle: metadata?.chapterTitle,
        shotIndex: metadata?.shotIndex,
    };
}

export function backendAgentProviderConfig(config: ReturnType<typeof resolveModelRequestConfig>) {
    return {
        channelId: config.channelId,
        apiFormat: config.apiFormat,
        interfaceType: config.interfaceType,
        baseUrl: config.baseUrl,
        allowLocalChannel: config.allowLocalChannel === true,
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        model: config.model,
        size: config.size,
        quality: config.quality,
        transparentBackground: config.transparentBackground,
        count: config.count,
        videoSeconds: config.videoSeconds,
        vquality: config.vquality,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
        systemPrompt: config.systemPrompt,
    };
}

export function cinematicSessionMessageId(backendSessionId: string) {
    return `cinematic-session:${backendSessionId}`;
}

export function upsertAssistantMessage(messages: CanvasAssistantMessage[], message: CanvasAssistantMessage) {
    const exists = messages.some((item) => item.id === message.id);
    return exists ? messages.map((item) => (item.id === message.id ? { ...item, ...message } : item)) : [...messages, message];
}

export function createSession(): CanvasAssistantSession {
    const now = new Date().toISOString();
    return { id: nanoid(), title: "新对话", messages: [], createdAt: now, updatedAt: now };
}
