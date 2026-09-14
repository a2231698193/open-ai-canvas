type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function approvalArguments(value: unknown): RecordValue | null {
    if (typeof value !== "string") return record(value);
    try {
        return record(JSON.parse(value));
    } catch {
        return null;
    }
}

export function agentApprovalPresentation(detail: unknown) {
    const payload = record(detail);
    const call = record(payload?.call);
    const fn = record(call?.function);
    const name = text(fn?.name) || text(payload?.toolName);
    const args = approvalArguments(fn?.arguments ?? payload?.arguments);

    if (name === "canvas_apply_ops") {
        const ops = Array.isArray(args?.ops) ? args.ops.map(record).filter((op): op is RecordValue => Boolean(op)) : [];
        const added = ops.filter((op) => op.type === "add_node").length;
        const updated = ops.filter((op) => op.type === "update_node").length;
        const connected = ops.filter((op) => op.type === "connect_nodes").length;
        const action = [added ? `新增 ${added} 个节点` : "", updated ? `修改 ${updated} 个节点` : "", connected ? `建立 ${connected} 条引用连线` : ""].filter(Boolean).join("，");
        const titles = ops.map((op) => text(op.title)).filter(Boolean).slice(0, 3).map((title) => title.slice(0, 64));
        return { title: "确认画布修改", description: action ? `Agent 准备${action}，确认后才会写入画布。` : "Agent 准备修改当前画布，确认后才会写入。", items: titles };
    }
    if (name === "generate_media") {
        const type = args?.mode === "video" ? "视频" : args?.mode === "image" ? "图片" : "媒体";
        const references = Array.isArray(args?.referenceNodeIds) ? args.referenceNodeIds.filter((id) => typeof id === "string") : [];
        const items = [
            text(payload?.modelName) ? `模型：${text(payload?.modelName)}` : (text(args?.channelModelKey) || text(args?.logicalModelId)) ? `模型：${text(args?.channelModelKey) || text(args?.logicalModelId)}` : "",
            text(args?.title) ? `节点：${text(args?.title).slice(0, 64)}` : "",
            references.length ? `引用 ${references.length} 个画布资产，并建立连线` : "不引用画布媒体资产",
            typeof args?.durationSeconds === "number" && args.durationSeconds > 0 ? `时长：${args.durationSeconds} 秒` : "",
            text(args?.size) ? `画幅：${text(args?.size)}` : "",
            text(args?.quality) ? `质量：${text(args?.quality)}` : "",
            typeof args?.videoGenerateAudio === "boolean" ? `音频：${args.videoGenerateAudio ? "开启" : "关闭"}` : "",
        ].filter(Boolean);
        return { title: `确认生成${type}`, description: `${type}草稿节点和引用连线已创建，尚未提交生成。确认模型与画幅后批准才会提交收费任务；拒绝则保留草稿，结果自动回写画布。`, items };
    }
    return { title: "确认执行操作", description: "Agent 请求执行一项操作，确认后才会继续。", items: [] as string[] };
}
