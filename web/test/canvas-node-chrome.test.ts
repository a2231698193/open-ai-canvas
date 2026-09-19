import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "bun:test";

test("画布连接加号默认隐藏，只有悬停或可见标记时显示", () => {
    const nodeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node.tsx"), "utf8");
    const chromeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node-chrome.css"), "utf8");
    expect(nodeSource).toContain('import "./canvas-node-chrome.css"');
    expect(nodeSource).toContain('data-canvas-connection-rail={side}');
    expect(nodeSource).toContain('data-visible={visible || railHovered ? "true" : undefined}');
    expect(nodeSource).toContain("opacity: visible || railHovered ? 1 : 0");
    expect(chromeSource).toContain("[data-canvas-connection-rail] {");
    expect(chromeSource).toContain("opacity: 0;");
    expect(chromeSource).toContain('[data-canvas-connection-rail][data-visible="true"]');
    expect(chromeSource).toContain(".script-column-picker");
});

test("生成中节点不再叠一枚重复状态徽章，对象存储标记仅在悬停或选中时出现", () => {
    const nodeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node.tsx"), "utf8");
    const contentSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node-content.tsx"), "utf8");
    expect(nodeSource).toContain('data.metadata.status !== "loading"');
    expect(nodeSource).toContain('resourceStorageLocation(data.metadata?.storageKey) === "local"');
    expect(contentSource).toContain('LoaderCircle className="size-10 animate-spin"');
    expect(contentSource).toContain('color: "var(--status-loading)"');
});
