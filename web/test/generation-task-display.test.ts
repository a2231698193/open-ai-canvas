import { expect, test } from "bun:test";

import { generationTaskProgressText, generationTaskShowsProgress, generationTaskStageLabel, generationTaskStatusLabel, statusLabel } from "../src/lib/generation-task-display";

// 后端会写入「等待队列调度 / 后端接管任务 / 正在连接上游 / 调用生成模型 / 上游生成中 / 等待上游任务同步」
// 等阶段文案；前端不再回显这些措辞，进行中统一显示「生成中」并保留进度条。
const inFlightStages = ["等待队列调度", "后端接管任务", "正在连接上游", "调用生成模型", "上游生成中", "等待上游任务同步"];

test("进行中的图片/视频任务统一显示生成中并显示进度", () => {
    for (const stage of inFlightStages) {
        for (const status of ["queued", "running"] as const) {
            const task = { status, stage };
            expect(generationTaskStageLabel(task)).toBe("生成中");
            expect(generationTaskStatusLabel(task)).toBe("生成中");
            expect(generationTaskShowsProgress(task)).toBe(true);
        }
    }
    expect(statusLabel.queued).toBe("生成中");
    expect(statusLabel.running).toBe("生成中");
});

test("阶段与状态一致时进度行只显示百分比", () => {
    expect(generationTaskProgressText({ status: "running", stage: "上游生成中", progress: 42 })).toBe("42%");
    expect(generationTaskProgressText({ status: "running", stage: "上游生成中", progress: 0 })).toBe("0%");
});

test("终态与提交待确认保留原有文案", () => {
    expect(generationTaskStageLabel({ status: "succeeded", stage: "生成中" })).toBe("已完成");
    expect(generationTaskStageLabel({ status: "failed", stage: "上游生成中" })).toBe("失败");
    expect(generationTaskStageLabel({ status: "cancelled", stage: "等待队列调度" })).toBe("已取消");
    expect(generationTaskStageLabel({ status: "running", stage: "submission_unknown" })).toBe("为避免重复扣费，未自动重试");
    expect(generationTaskShowsProgress({ status: "running", stage: "submission_unknown" })).toBe(false);
});
