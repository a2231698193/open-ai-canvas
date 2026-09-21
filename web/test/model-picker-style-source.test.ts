import { expect, test } from "bun:test";

test("模型行只保留选中高亮，价格使用独立的彩色标签", async () => {
    const [component, styles, workspace] = await Promise.all([
        Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/workspace-product.css", import.meta.url)).text(),
    ]);
    // 本仓库是单层列表：悬浮/聚焦只预览该行说明，选中态始终由 aria-selected 表达。
    expect(component).toContain('aria-selected={selected}');
    expect(styles).not.toMatch(/canvas-model-picker-(?:brand|option)(?:\[[^\]]*\])?:hover/);
    expect(workspace).not.toContain(".canvas-model-picker-brand.is-active");
    expect(styles).toContain('.canvas-model-picker-option[aria-selected="true"]');
    expect(styles).toContain(".canvas-model-picker-option:focus-visible");
    const price = styles.match(/\.model-picker-price \{([^}]+)\}/)?.[1] || "";
    expect(price).toContain("color: var(--model-price-ink)");
    expect(price).toContain("font-weight: 650");
    expect(price).not.toContain("background:");
    expect(price).toContain("--model-price-ink: #946900");
    expect(styles).toContain(".dark .model-picker-price");
    const badge = styles.match(/\.canvas-model-picker-option \.model-picker-price \{([^}]+)\}/)?.[1] || "";
    expect(badge).toContain("border-radius: var(--r-sm)");
    expect(badge).toContain("background: color-mix");
    expect(badge).toContain("padding: 2px 5px");
    expect(component).toContain('<Coins className="model-picker-price-icon" aria-hidden="true" />');
    // 单层列表保持自己的宽度，不引入二级目录的 800px 双栏。
    expect(workspace).toContain("width: min(420px, calc(100vw - 24px))");
    expect(workspace).not.toContain("canvas-model-picker-two-pane");
});

test("模型标签与渠道副标题共存，选中后关闭菜单并回到触发器焦点", async () => {
    const component = await Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text();
    expect(component).toContain("<ModelTags tags={logicalCost?.tags} />");
    const selection = component.match(/onClick=\{\(\) => \{\s*if \(!model\) return;([\s\S]*?)\}\}/)?.[1] || "";
    expect(selection).toContain("onChange(model)");
    expect(selection).toContain("setOpen(false)");
    expect(selection).toContain("triggerRef.current?.focus()");
    expect(component).toContain('event.key === "Escape"');
    expect(component).toContain('window.addEventListener("pointerdown", closeOnOutsidePointer, true)');
});

test("ModelPicker 样式独立加载，并保留模型列表的视口边界", async () => {
    const [application, globals, pickerStyles] = await Promise.all([
        Bun.file(new URL("../src/application.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text(),
    ]);

    expect(application).toContain('import "./styles/shared/model-picker.css";');
    expect(globals).not.toContain("canvas-model-picker");
    expect(pickerStyles).toContain(".canvas-model-picker-menu {");
    expect(pickerStyles).toContain("max-height: min(420px, calc(100vh - 32px));");

    const creationMenu = pickerStyles.match(/\.creation-model-picker-menu \{([\s\S]*?)\}/)?.[1] || "";
    expect(creationMenu).toContain("max-height: min(460px, calc(100vh - 24px));");
    expect(creationMenu).toContain("overflow-y: auto;");
    expect(pickerStyles).toContain(".canvas-model-picker-description.is-visible");
    expect(pickerStyles).toContain(".canvas-model-picker-option.is-previewed:not(:disabled)");
    expect(pickerStyles).not.toContain(".app-user-workspace .creation-model-picker-menu {");
    expect(pickerStyles).not.toContain(".creation-model-picker-surface .creation-model-picker-menu {");
});
