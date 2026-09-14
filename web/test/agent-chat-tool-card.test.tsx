import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentToolCard } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { canvasThemes } from "@/lib/canvas-theme";

test("completed tools keep an accessible status without a duplicate visual badge", () => {
    const html = renderToStaticMarkup(<AgentToolCard title="model_list" text="工具执行成功" detail={{ eventType: "tool_completed" }} theme={canvasThemes.dark} />);
    expect(html).toContain("已获取可用模型");
    expect(html).toContain('class="sr-only">已完成');
    expect(html).not.toContain("agent-tool-label");
});

test("failed tools retain a visible failure label", () => {
    const html = renderToStaticMarkup(<AgentToolCard title="model_list" text="无法获取" detail={{ eventType: "tool_failed" }} theme={canvasThemes.light} />);
    expect(html).toContain("agent-tool-label");
    expect(html).toContain("执行失败");
});

test("long skill references wrap rather than truncate", () => {
    const html = renderToStaticMarkup(<AgentToolCard title="skill_read_file" text="工具执行成功" detail={{ eventType: "tool_completed", skillName: "novel-storyboard", path: "references/storyboard-pass.md" }} theme={canvasThemes.dark} />);
    expect(html).toContain("references/storyboard-pass.md");
    expect(html).toContain("break-words");
    expect(html).not.toContain("truncate");
});

test("failed media shows its error and task identifier without hovering", () => {
    const html = renderToStaticMarkup(<AgentToolCard title="generate_media" text="上游拒绝该生成规格" detail={{ eventType: "tool_failed", result: { taskId: "task-123" } }} theme={canvasThemes.light} />);
    expect(html).toContain(">上游拒绝该生成规格</span>");
    expect(html).toContain("任务 ID：task-123");
});


test("canvas action trace is accessible and links to persisted node identities", () => {
    const html = renderToStaticMarkup(<AgentToolCard title="canvas_apply_ops" text="画布操作已完成" detail={{ eventType: "canvas_updated", actions: [{ action: "created", nodeId: "video-1", title: "满月动画", nodeType: "video" }, { action: "referenced", nodeId: "image-1", title: "满月照片", nodeType: "image" }] }} theme={canvasThemes.light} onFocusNode={() => {}} />);
    expect(html).toContain('data-agent-node-id="video-1"');
    expect(html).toContain('aria-label="在画布中定位满月动画"');
    expect(html).toContain("创建了视频节点《满月动画》");
    expect(html).toContain("引用了图片节点《满月照片》");
    expect(html).not.toContain('disabled=""');
});

test("failed media trace retains node title and collapsible upstream details", () => {
    const text = "上游拒绝规格：" + "错误详情".repeat(80);
    const html = renderToStaticMarkup(<AgentToolCard title="generate_media" text={text} detail={{ eventType: "tool_failed", arguments: JSON.stringify({ nodeId: "video-1", title: "满月动画", mode: "video" }), result: { taskId: "task-failed", taskSubmitted: true } }} theme={canvasThemes.light} onFocusNode={() => {}} />);
    expect(html).toContain("生成未完成：视频节点《满月动画》");
    expect(html).toContain("查看完整错误详情");
    expect(html).toContain("任务 ID：task-failed");
    expect(html).toContain("<details");
});
