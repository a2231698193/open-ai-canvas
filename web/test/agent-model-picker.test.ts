import { expect, test } from "bun:test";

test("Agent 对话和设置复用创作页模型选择器，并且只展示文本模型", async () => {
    const panel = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent-panel.tsx", import.meta.url)).text();
    const settings = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent-settings.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent.css", import.meta.url)).text();
    const pickerCss = await Bun.file(new URL("../src/styles/workspace-product.css", import.meta.url)).text();

    expect(panel).toContain('capability="text"');
    expect(panel).toContain('variant="creation"');
    expect(panel).toContain('popoverClassName="agent-model-picker-popover"');
    expect(panel).toContain('selectableModelsByCapability(config, "text")');
    expect(panel).toContain('placeholder="选择文本模型"');

    expect(settings).toContain('capability="text"');
    expect(settings).toContain('variant="creation"');
    expect(settings).toContain('popoverClassName="agent-model-picker-popover"');
    expect(settings).toContain('placeholder="选择文本模型"');

    expect(css).toContain(".agent-model-picker-popover");
    expect(css).toContain("z-index: calc(var(--z-modal-overlay) + 1000)");

    // 选择器已是单层模型列表：不再有渠道/品牌二级入口，也就没有双栏样式。
    const picker = await Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text();
    expect(picker).not.toContain("canvas-model-picker-brands");
    expect(picker).not.toContain("canvas-model-picker-two-pane");
    expect(picker).toContain("canvas-model-picker-options");
    expect(picker).toContain('localeCompare(right.label');

    expect(pickerCss).not.toContain("canvas-model-picker-two-pane");
    expect(pickerCss).toContain(".creation-model-picker-surface .creation-model-picker-menu { width: min(420px, calc(100vw - 24px)) !important; }");
});
