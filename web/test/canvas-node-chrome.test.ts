import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "bun:test";

test("画布连接加号沿用官方悬停显隐，分镜列选择样式单独保留", () => {
    const nodeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node.tsx"), "utf8");
    const chromeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node-chrome.css"), "utf8");
    expect(nodeSource).toContain('data-canvas-connection-rail={side}');
    expect(nodeSource).toContain('visible || railHovered ? "opacity-100" : "opacity-0"');
    expect(chromeSource).not.toContain("[data-canvas-connection-rail]");
    expect(chromeSource).toContain(".script-column-picker");
});
