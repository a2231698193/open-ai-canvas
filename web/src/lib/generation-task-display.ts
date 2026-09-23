import type { GenerationTask, TaskStatus } from "@/services/api/task-center";

export const statusLabel: Record<TaskStatus, string> = {
    queued: "生成中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    cancelled: "已取消",
};

type GenerationTaskDisplayTarget = Pick<GenerationTask, "status" | "stage" | "mediaStage">;

export function mediaDeliverySummary(status: TaskStatus | undefined, stage: GenerationTask["mediaStage"]) {
    if (!stage) return "";
    if (stage === "completed") return "生成成功 · 文件保存成功 · 素材登记成功";
    const prefix = stage === "download" || stage === "checkpoint" ? "生成成功" : stage === "register" ? "生成成功 · 文件保存成功" : "生成成功 · 下载成功";
    const action = { download: "下载", upload: "上传 OSS", local_save: "保存文件", register: "登记素材", checkpoint: "记录恢复信息" }[stage];
    return `${prefix} · ${action}${status === "failed" ? "失败" : status === "cancelled" ? "已停止" : "待完成"}`;
}

export function isGenerationTaskSubmissionUncertain(task: GenerationTaskDisplayTarget) {
    return task.stage === "submission_unknown";
}

export function generationTaskStatusLabel(task: GenerationTaskDisplayTarget) {
    if (task.mediaStage && task.status === "failed") return "作品保存未完成";
    if (task.mediaStage && (task.status === "queued" || task.status === "running")) return "作品已生成，正在保存";
    if (isGenerationTaskSubmissionUncertain(task)) return "提交结果待确认";
    return statusLabel[task.status];
}

export function generationTaskStageLabel(task: GenerationTaskDisplayTarget) {
    if (isGenerationTaskSubmissionUncertain(task)) return "为避免重复扣费，未自动重试";
    // 进行中统一显示「生成中」：不回显后端阶段文案（等待队列调度 / 正在连接上游 / 上游生成中 …），
    // 同一件事不因为落到哪个阶段而换措辞。
    if (task.status === "queued" || task.status === "running") return "生成中";
    return generationTaskStatusLabel(task);
}

export function generationTaskShowsProgress(task: GenerationTaskDisplayTarget) {
    if (task.mediaStage && task.mediaStage !== "completed") return false;
    if (isGenerationTaskSubmissionUncertain(task)) return false;
    // 进行中一律带进度条：文案已统一为「生成中」，不再按阶段隐藏进度。
    return true;
}

type GenerationTaskProgressTarget = GenerationTaskDisplayTarget & { progress?: number };

/** 进度行文案：阶段与状态一致时只保留百分比，避免同一句「生成中」出现两次。 */
export function generationTaskProgressText(task: GenerationTaskProgressTarget) {
    const stage = generationTaskStageLabel(task);
    const status = generationTaskStatusLabel(task);
    const percent = typeof task.progress === "number" ? `${Math.max(0, Math.min(100, Math.round(task.progress)))}%` : "";
    return [stage === status ? "" : stage, percent].filter(Boolean).join(" · ");
}

export const operationOptions = [
    { label: "文生视频", value: "text_to_video" },
    { label: "图生视频", value: "image_to_video" },
    { label: "全能参考", value: "reference_to_video" },
    { label: "视频续写", value: "extend" },
    { label: "视频局部修改", value: "inpaint" },
    { label: "元素替换", value: "replace_element" },
    { label: "镜头/运镜调整", value: "camera_motion" },
    { label: "风格迁移", value: "style_transfer" },
    { label: "参考音频生成视频", value: "audio_to_video" },
    { label: "结果版本对比", value: "compare_versions" },
];

export const operationLabelByValue = new Map(operationOptions.map((item) => [item.value, item.label]));

export const taskTypeLabel: Record<string, string> = {
    canvas_image: "画布生图",
    canvas_video: "画布视频",
    canvas_audio: "画布音频",
    canvas_text: "画布文本",
};

export function formatTaskKind(task: GenerationTask) {
    const typeLabel = taskTypeLabel[task.type];
    const operationLabel = task.operation ? operationLabelByValue.get(task.operation) : "";

    if (task.type === "canvas_video" && operationLabel) return `${typeLabel || "画布视频"} · ${operationLabel}`;
    if (typeLabel) return typeLabel;
    if (operationLabel) return operationLabel;
    if (task.type.startsWith("video_")) return "视频任务";
    return "生成任务";
}
