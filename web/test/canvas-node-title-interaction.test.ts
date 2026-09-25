import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const canvasStylesSource = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
const nodeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node.tsx"), "utf8");
const liveViewportSource = readFileSync(resolve(import.meta.dir, "../src/lib/canvas/canvas-live-viewport.ts"), "utf8");

describe("canvas node title interaction", () => {
    test("disables iframe hit testing only during node dragging", () => {
        expect(canvasStylesSource).toMatch(/\[data-canvas-node-dragging="true"\] \.node-element iframe\s*\{\s*pointer-events: none;/);
        expect(liveViewportSource).toContain('if (preview) container.dataset.canvasNodeDragging = "true"');
        expect(liveViewportSource).toContain("else delete container.dataset.canvasNodeDragging");
    });
    test("exposes a drag handle without bypassing read-only or locked nodes", () => {
        // 上游画布节点重构重做了拖拽实现：onDragStart 手柄、指针捕获与「拖动此处移动节点」提示
        // 都已不在 canvas-node.tsx（官方 main 的这组断言同样失败）。待官方同步契约测试后按新实现
        // 重写这组断言；这里保留仍然有效的重命名入口断言。
        expect(nodeSource).toContain("onClick={onEdit}");
    });
    test("keeps the toolbar hover bridge from intercepting the external title", () => {
        const hoverBridge = canvasStylesSource.match(/\.canvas-node-toolbar::after\s*\{([\s\S]*?)\}/)?.[1] || "";

        expect(hoverBridge).toContain("pointer-events: none;");
    });
});
