import { getNodeDefinition, listNodeDefinitions } from "@/lib/canvas/node-registry";
import { getRegisteredPlugin, listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import { isPluginEffectivelyEnabled } from "@/stores/use-plugin-store";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";

// Query live registries on every discovery; installation is not execution availability.
export function listAgentCapabilities(query = "") {
    const nodes = listNodeDefinitions().filter((node) => !node.plugin || isPluginEffectivelyEnabled(node.plugin.pluginId)).map((node) => ({
        id: node.type, name: node.label, source: node.plugin?.pluginId || "builtin",
        scope: "canvas", actions: node.type === "script" ? ["create", "canvas_read_storyboard", "canvas_edit_storyboard"] : ["create", "read", "update"],
        defaultMetadata: node.defaultMetadata, defaultSize: node.defaultSize,
        inputKind: node.acceptsInputKind, schema: node.plugin?.schema,
        execution: node.plugin ? "仅开放节点创建和数据更新；插件专用执行需提供动作适配器，不能用媒体生成替代。" : "通过已有画布工具操作；专业节点不等同于普通媒体生成。",
    }));
    const plugins = listRegisteredPlugins().filter((plugin) => isPluginEffectivelyEnabled(plugin.manifest.id)).map(({ manifest, agentActions, readAgentNode }) => ({
        id: manifest.id, name: manifest.name, source: manifest.id, version: manifest.version,
        description: manifest.description, contributions: manifest.contributes,
        actions: (agentActions || []).map(({ id, description, inputSchema }) => ({ id, description, inputSchema })),
        readTool: readAgentNode ? "canvas_read_plugin_node" : undefined,
        execution: agentActions?.length ? "使用 canvas_plugin_action 调用 actions 中的真实动作。" : "贡献声明是发现信息，不是任意命令执行入口。只调用已挂载工具。",
    }));
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return [...nodes, ...plugins, { id: "project-style", name: "项目画风", source: "builtin", actions: ["canvas_list_styles", "canvas_apply_style"], scope: "canvas", description: "读取系统或个人风格，通过同一保存入口应用画风并同步关联项目。" }].filter((item) => terms.every((term) => JSON.stringify(item).toLocaleLowerCase().includes(term)));
}

export function readAgentPluginNode(snapshot: CanvasAgentSnapshot, nodeId: string) {
    const node = snapshot.nodes.find((item) => item.id === nodeId);
    const owner = node && getNodeDefinition(node.type)?.plugin?.pluginId;
    const plugin = owner && isPluginEffectivelyEnabled(owner) ? getRegisteredPlugin(owner) : undefined;
    if (!node || !plugin?.readAgentNode || !plugin.manifest.permissions.includes("canvas.read")) throw new Error("当前插件未启用或未提供节点读取能力");
    return { nodeId, pluginId: owner, version: plugin.manifest.version, data: plugin.readAgentNode(structuredClone(node), structuredClone(snapshot)) };
}

export function readAgentPluginDocumentation(pluginId: string) {
    const plugin = getRegisteredPlugin(pluginId);
    if (!plugin || !isPluginEffectivelyEnabled(pluginId)) throw new Error("插件不可用，请重新发现能力");
    return { id: pluginId, version: plugin.manifest.version, documentation: plugin.manifest.documentation || plugin.manifest.description };
}

export function buildAgentPluginOperations(pluginId: string, actionId: string, input: Record<string, unknown>, snapshot: CanvasAgentSnapshot) {
    const plugin = getRegisteredPlugin(pluginId);
    if (!plugin || !isPluginEffectivelyEnabled(pluginId)) throw new Error("插件已停用或不可用");
    const action = plugin.agentActions?.find((item) => item.id === actionId);
    if (!action) throw new Error("插件未提供此 Agent 动作，请先读取能力目录");
    if (!plugin.manifest.permissions.includes("canvas.write")) throw new Error("插件未声明画布写入权限");
    const operations = action.buildOperations(structuredClone(input), structuredClone(snapshot));
    if (!Array.isArray(operations) || !operations.length || operations.length > 100) throw new Error("插件必须返回 1 至 100 个画布操作");
    if (operations.some((op) => op.type === "run_generation") && !plugin.manifest.permissions.includes("generation.run")) throw new Error("插件未声明生成权限");
    return operations;
}

export const AGENT_CAPABILITY_GUIDANCE = "处理专业任务前先调用 canvas_list_capabilities 查找系统现有节点和已启用插件，并用 canvas_list_skills 检索相关专业技能、读取 SKILL.md 后按需使用；用户不必手动选择技能。不要用普通文本模拟分镜表或插件结果。发现信息不代表已经执行，未挂载的专用动作须如实说明。已授权范围内自主推进，不重复征求技能读取或普通操作许可。";
