import { expect, test } from "bun:test";

// 本仓库刻意与官方主线分叉：选择器是单层列表，打开即选模型，不做渠道/品牌二级选择。
// 官方主线已把二级选择器（variant 默认 creation、品牌栏 + 双栏）当作全站标准，
// 合并主线时这条测试负责挡住误回退；改回二级前先改 AGENTS.md 第 6 节的约定。
test("模型选择器保持单层列表，不做渠道/品牌二级选择", async () => {
    const picker = await Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text();

    expect(picker).toContain("canvas-model-picker-options");
    expect(picker).toContain('creationVariant ? "creation-model-picker-menu" : "w-[var(--panel-width-compact)]"');
    // 同名模型按显示名相邻排序。
    expect(picker).toContain("localeCompare(right.label");

    for (const removed of [
        "canvas-model-picker-brands",
        "canvas-model-picker-brand-rail",
        "canvas-model-picker-two-pane",
        "canvas-model-picker-model-pane",
        "canvas-model-picker-secondary-head",
        "is-brand-list",
        "is-model-list",
    ]) {
        expect(picker).not.toContain(removed);
    }

    const stylesheets = await Promise.all(
        ["../src/styles/globals.css", "../src/styles/workspace-product.css", "../src/components/canvas/canvas-cloud-agent.css"].map((path) => Bun.file(new URL(path, import.meta.url)).text()),
    );
    for (const css of stylesheets) {
        expect(css).not.toContain("canvas-model-picker-two-pane");
        expect(css).not.toContain("canvas-model-picker-brand-rail");
    }
});
