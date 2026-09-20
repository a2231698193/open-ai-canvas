import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const source = (name: string) => readFileSync(resolve(import.meta.dir, `../src/pages/canvas/${name}`), "utf8");

describe("storyboard prompt panel boundaries", () => {
    test("creation and duplication clear the previous node panel", () => {
        const operations = source("use-canvas-node-operations.ts");
        expect(operations).toContain("if (type === CanvasNodeType.Script) setDialogNodeId(null)");
        expect(operations).toContain("if (source.type === CanvasNodeType.Script) setDialogNodeId(null)");
        expect(operations).toContain("primaryNode.type !== CanvasNodeType.Script ? primaryNode.id : null");
    });

    test("single and batch connection creation clear the previous panel", () => {
        const connections = source("use-canvas-connection-controller.ts");
        expect(connections.match(/if \(nodeType === CanvasNodeType.Script\) setDialogNodeId\(null\)/g)).toHaveLength(2);
    });

    test("focusing a storyboard does not open a panel", () => {
        expect(source("use-canvas-viewport-controller.ts")).toContain("node.type === CanvasNodeType.Drawing || node.type === CanvasNodeType.Script ? null : node.id");
    });

    test("click and overlay guards remain while the storyboard editor stays available", () => {
        const project = source("project.tsx");
        expect(project).toMatch(/else if \(node.type === CanvasNodeType.Script\) \{\s*setDialogNodeId\(null\)/);
        expect(project).toContain("dialogNode.type !== CanvasNodeType.Script");
        expect(project).toContain("onOpen={() => setScriptEditorNodeId(contentNode.id)}");
        expect(project).toContain("onGenerateScript={(prompt) => void generateScriptRows(contentNode.id, prompt)}");
    });

    test("missing project style exposes the existing canvas style workflow", () => {
        const project = source("project.tsx");
        const storyboard = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-script-node.tsx"), "utf8");
        expect(project).toContain("onStyleRequired: () => setStylePickerOpen(true)");
        expect(project).toContain("onRequestStyleSetup={() => setStylePickerOpen(true)}");
        expect(storyboard).toContain("设置项目画风");
        expect(storyboard).toContain("disabled={!prompt.trim() || !styleReady");
    });

    test("project style is a prominent setup command for every canvas", () => {
        const menu = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-create-menu.tsx"), "utf8");
        const commands = readFileSync(resolve(import.meta.dir, "../src/lib/canvas/tool-registry/definitions/add-node-menu-tools.tsx"), "utf8");
        expect(menu).toContain('MenuSection title="项目设定"');
        expect(menu).toContain('variant="project"');
        expect(commands).toContain('label: "设置项目画风"');
        expect(commands).toContain('description: "统一分镜、图片和视频的视觉风格"');
        expect(commands).not.toContain('id: "style", label: "项目画风", icon: <Palette />, section: "project", defaultOrder: 10, applicable:');
    });

    test("an unset linked-project style is actionable from the project sidebar", () => {
        const sidebar = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-project-sidebar.tsx"), "utf8");
        const project = source("project.tsx");
        expect(sidebar).toContain("onClick={style ? onLocateStyle : onChooseStyle}");
        expect(sidebar).toContain('title={style ? "定位画布中的项目画风节点" : "设置项目画风"}');
        expect(project).toContain('onChooseStyle={() => setStylePickerOpen(true)}');
    });
});
