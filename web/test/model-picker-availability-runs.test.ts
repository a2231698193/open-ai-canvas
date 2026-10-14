import { expect, test } from "bun:test";

async function pickerSources() {
    const [component, styles] = await Promise.all([
        Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text(),
    ]);
    return { component, styles };
}

test("模型窗口渲染10个状态点的可用性指示条，区分成功、失败与未调用槽位", async () => {
    const { component, styles } = await pickerSources();

    // 状态条固定渲染 10 个点
    expect(component).toContain("model-picker-availability-track");
    expect(component).toContain("Array.from({ length: 10 })");
    expect(component).toContain("model-picker-availability-pill");
    expect(component).toContain("is-success");
    expect(component).toContain("is-failed");
    expect(component).toContain("is-empty");

    // CSS 样式定义了成功绿点、失败红点、未调用灰点
    expect(styles).toContain(".model-picker-availability-track");
    expect(styles).toContain(".model-picker-availability-pill.is-success");
    expect(styles).toContain(".model-picker-availability-pill.is-failed");
    expect(styles).toContain(".model-picker-availability-pill.is-empty");

    // 本仓库是单层列表：状态条挂在每个模型行的可用性徽章上，不走品牌二级栏。
    expect(component).toContain("<ModelAvailabilityBadge availability={modelAvailability(config, model)}");
    expect(component).toContain("<ModelRecentHealthTrack availability={availability} />");
    expect(component).not.toContain("groupAvailability");
    expect(component).not.toContain("canvas-model-picker-brands");
    expect(styles).toContain(".model-picker-availability-track");
});
