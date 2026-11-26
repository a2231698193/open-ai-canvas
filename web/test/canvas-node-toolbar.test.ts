import { describe, expect, test } from "bun:test";

import { buildImageToolbarTools, getNineGridMenuItems } from "@/components/canvas/canvas-image-toolbar-tools";
import { resolveNodeToolbarPlacement, resolveToolbarTools, type ToolContext, type ToolbarHandlers } from "@/lib/canvas/tool-registry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function createNodeContext(node: CanvasNodeData): ToolContext {
    return {
        selectedCount: 0,
        selectedNodeTypes: new Set(),
        selectedVideoCount: 0,
        canvasTool: "move",
        workspaceMode: "professional",
        isProjectLinked: false,
        canUndo: false,
        canRedo: false,
        node,
        nodeMetadata: node.metadata,
        extractingVideoFrames: false,
        extractingAudio: false,
        trimmingVideo: false,
        mergingVideos: false,
        addPanelOpen: false,
        appearancePanelOpen: false,
        settingsPanelOpen: false,
        handlers: {} as ToolbarHandlers,
    };
}

describe("canvas node toolbar model", () => {
    test("text node exposes the shared editor without enabling text generation controls", () => {
        const node: CanvasNodeData = { id: "markdown", type: CanvasNodeType.Text, title: "文档", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "# 标题", textFormat: "markdown" } };
        const ctx = createNodeContext(node);
        const received: CanvasNodeData[] = [];
        ctx.handlers.onNodeEditText = (value) => {
            received.push(value);
        };
        const tools = resolveToolbarTools("node-hover", ctx, null);
        const edit = tools.find((tool) => tool.id === "editText")!;
        expect(edit).toBeDefined();
        expect(resolveNodeToolbarPlacement(edit, ctx).group).toBe("primary");
        edit.run?.(ctx);
        expect(received).toEqual([node]);
        // 统一节点模型后文本节点同时提供「生成设置」入口，但它不带文本生成专用控件。
        expect(tools.find((tool) => tool.id === "edit")?.displayLabel).not.toBe("文本生成");
    });

    test("relative depth is offered only for available, non-loading videos and runs lazily", () => {
        const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 720, height: 405, metadata: { storageKey: "resource:video" } };
        const ctx = createNodeContext(node);
        expect(resolveToolbarTools("node-hover", ctx, null).some((tool) => tool.id === "depthVideo")).toBe(false);
        const received: CanvasNodeData[] = [];
        ctx.handlers.onNodeDepthVideo = (source) => received.push(source);
        const tool = resolveToolbarTools("node-hover", ctx, null).find((tool) => tool.id === "depthVideo")!;
        expect(tool).toBeDefined();
        expect(received).toEqual([]);
        tool.run(ctx);
        expect(received).toEqual([node]);
        for (const unavailable of [
            { ...ctx, nodeMetadata: { status: "loading" as const } },
            { ...ctx, nodeMetadata: {} },
            { ...ctx, workspaceMode: "simple" as const },
        ]) {
            expect(resolveToolbarTools("node-hover", unavailable, null).some((tool) => tool.id === "depthVideo")).toBe(false);
        }
    });

    test("edit copy delegates the selected image once and refuses unavailable sources", () => {
        const node: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "image.png" } };
        const ctx = createNodeContext(node);
        const tool = resolveToolbarTools("node-hover", ctx, null).find((item) => item.id === "createEditCopy")!;
        expect(tool).toBeDefined();
        expect(tool.disabled?.(ctx)).toBe(true);
        const received: CanvasNodeData[] = [];
        ctx.handlers.onNodeCreateEditCopy = (source) => received.push(source);
        expect(received).toEqual([]);
        expect(tool.disabled?.(ctx)).toBe(false);
        tool.run(ctx);
        expect(received).toEqual([node]);
        for (const metadata of [
            { ...node.metadata, locked: true },
            { ...node.metadata, status: "loading" as const },
        ]) {
            const withExistingMedia = createNodeContext({ ...node, metadata });
            withExistingMedia.handlers = ctx.handlers;
            expect(tool.disabled?.(withExistingMedia)).toBe(false);
        }
        const uploading = createNodeContext({ ...node, metadata: { ...node.metadata, fileUpload: "uploading" } });
        uploading.handlers = ctx.handlers;
        expect(tool.disabled?.(uploading)).toBe(true);
        const empty = createNodeContext({ ...node, metadata: {} });
        expect(resolveToolbarTools("node-hover", empty, null).some((item) => item.id === "createEditCopy")).toBe(false);
        const video = createNodeContext({ ...node, type: CanvasNodeType.Video });
        expect(resolveToolbarTools("node-hover", video, null).some((item) => item.id === "createEditCopy")).toBe(false);
    });

    test("preserves empty, simple and busy video states", () => {
        const ctx = createNodeContext({ id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: {} });
        const emptyTools = resolveToolbarTools("node-hover", ctx, null);
        expect(emptyTools.some((tool) => tool.id === "extractAudio")).toBe(false);
        expect(emptyTools.some((tool) => tool.id === "videoEnhance")).toBe(false);
        expect(
            resolveNodeToolbarPlacement(
                emptyTools.find((tool) => tool.id === "uploadVideo")!,
                ctx,
            ).group,
        ).toBe("primary");
        ctx.nodeMetadata = { content: "video.mp4" };
        ctx.extractingAudio = true;
        const audio = resolveToolbarTools("node-hover", ctx, null).find((tool) => tool.id === "extractAudio")!;
        expect(audio.disabled?.(ctx)).toBe(true);
        ctx.workspaceMode = "simple";
        expect(resolveToolbarTools("node-hover", ctx, null).some((tool) => tool.id === "extractAudio")).toBe(false);
    });

    test("image nodes expose exactly one preview entry", () => {
        // 图片工具栏（imageTools 的 view）与节点注册表（previewMedia）曾各带一个放大按钮，
        // 两者调同一个 onViewImage，图片节点工具栏上因此出现两个一模一样的图标。
        const node: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "image.png" } };
        const ctx = createNodeContext(node);
        const registryPreview = resolveToolbarTools("node-hover", ctx, null).filter((tool) => tool.id === "previewMedia");
        const imageToolbarViews = buildImageToolbarTools(node, {} as never).filter((tool) => tool.id === "view");
        expect(registryPreview).toHaveLength(0);
        expect(imageToolbarViews).toHaveLength(1);
    });

    test("video and audio nodes keep the registry preview entry", () => {
        for (const type of [CanvasNodeType.Video, CanvasNodeType.Audio]) {
            const ctx = createNodeContext({ id: `${type}-node`, type, title: "媒体", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "media.mp4" } });
            const preview = resolveToolbarTools("node-hover", ctx, null).filter((tool) => tool.id === "previewMedia");
            expect(preview).toHaveLength(1);
        }
    });

    test("image menu actions remain lazy and keep the original node", () => {
        const node: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "image.png", freeResize: true } };
        const received: CanvasNodeData[] = [];
        const tools = buildImageToolbarTools(node, { onCrop: (target: CanvasNodeData) => received.push(target) } as never);
        expect(received).toEqual([]);
        tools.find((tool) => tool.id === "crop")!.onClick();
        expect(received).toEqual([node]);
        expect(tools.find((tool) => tool.id === "resize")?.active).toBe(false);
    });

    test("keeps video primary actions compact and moves secondary processing into a menu", () => {
        const ctx = createNodeContext({ id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "video.mp4" } });
        const received: CanvasNodeData[] = [];
        ctx.handlers.onNodeRemakeVideo = (node) => received.push(node);
        const tools = resolveToolbarTools("node-hover", ctx, null);
        const groups = new Map(tools.map((tool) => [tool.id, resolveNodeToolbarPlacement(tool, ctx).group]));

        const primary = tools.filter((tool) => groups.get(tool.id) === "primary").sort((left, right) => resolveNodeToolbarPlacement(left, ctx).order - resolveNodeToolbarPlacement(right, ctx).order);
        expect(primary.map((tool) => tool.id)).toEqual(["remakeVideo", "trimRegenerate"]);
        expect(primary[0].displayLabel).toBe("视频复刻");
        expect(received).toEqual([]);
        primary[0].run(ctx);
        expect(received).toEqual([ctx.node!]);
        expect([...groups].filter(([, group]) => group === "process").map(([id]) => id)).toEqual(["extractFrames", "extractAudio", "videoEnhance"]);
        expect(groups.get("videoEnhance")).toBe("process");
        expect(groups.get("download")).toBe("utility");
        expect(groups.has("timeline")).toBe(false);
        expect(groups.has("subtitles")).toBe(false);
        expect(groups.has("downloadSubtitles")).toBe(false);
        expect(groups.get("uploadVideo")).toBe("more");
        expect(groups.get("delete")).toBe("more");
        expect(groups.get("node-lock")).toBe("more");
    });

    test("remake requires writable canvas and actual video media, not a preview or pending upload", () => {
        const ctx = createNodeContext({ id: "upload", type: CanvasNodeType.Video, title: "上传视频", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { storageKey: "resource:original" } });
        const hasRemake = (context: ToolContext) => resolveToolbarTools("node-hover", context, null).some((tool) => tool.id === "remakeVideo");
        expect(hasRemake(ctx)).toBe(false);
        ctx.handlers.onNodeRemakeVideo = () => {};
        expect(hasRemake(ctx)).toBe(true);
        expect(hasRemake({ ...ctx, workspaceMode: "simple" })).toBe(false);
        for (const nodeMetadata of [{}, { previewContent: "poster.jpg" }, { storageKey: "resource:old", fileUpload: "uploading" }, { content: "old.mp4", status: "loading" }] as const) {
            expect(hasRemake({ ...ctx, node: { ...ctx.node!, metadata: nodeMetadata }, nodeMetadata })).toBe(false);
        }
    });

    test("uses the redesigned video terminology from the registry", () => {
        const ctx = createNodeContext({ id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "video.mp4" } });
        const tools = new Map(resolveToolbarTools("node-hover", ctx, null).map((tool) => [tool.id, tool]));
        const displayLabel = (id: string) => {
            const value = tools.get(id)?.displayLabel;
            return typeof value === "function" ? value(ctx) : value;
        };

        expect(displayLabel("subtitles")).toBeUndefined();
        expect(displayLabel("timeline")).toBeUndefined();
        expect(displayLabel("extractFrames")).toBe("提取画面");
        expect(displayLabel("extractAudio")).toBe("提取音频");
        expect(displayLabel("videoEnhance")).toBe("高清");
    });

    test("preserves delivery of existing subtitles without an editing entry", () => {
        const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { subtitleEntries: [{ index: 1, startMs: 0, endMs: 1200, text: "保留字幕" }] } };
        const ctx = createNodeContext(node);
        const received: CanvasNodeData[] = [];
        ctx.handlers.onNodeDownloadSubtitles = (target) => {
            received.push(target);
        };
        const tool = resolveToolbarTools("node-hover", ctx, null).find((item) => item.id === "downloadSubtitles")!;
        expect(tool).toBeDefined();
        expect(resolveNodeToolbarPlacement(tool, ctx).group).toBe("more");
        tool.run(ctx);
        expect(received).toEqual([node]);
        ctx.nodeMetadata = { subtitleEntries: [] };
        expect(resolveToolbarTools("node-hover", ctx, null).some((item) => item.id === "downloadSubtitles")).toBe(false);
    });

    test("image-only tools carry presentation metadata instead of relying on component ID lists", () => {
        const node: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "image.png" } };
        const tools = buildImageToolbarTools(node, {} as never);

        expect(tools.find((tool) => tool.id === "angle")?.group).toBe("camera");
        expect(tools.find((tool) => tool.id === "regionEdit")?.group).toBe("primary");
        expect(tools.some((tool) => tool.id === "superResolve")).toBe(false);
        expect(tools.find((tool) => tool.id === "emotion")?.group).toBe("adjust");
        const presets = getNineGridMenuItems();
        expect(presets.find((tool) => tool.id === "cinematic_light_correction")?.section).toBe("机位与光影");
        expect(presets.find((tool) => tool.id === "image_projection_after_3s")?.section).toBe("画面推演");
        expect(presets.filter((tool) => tool.section === "设定图").map((tool) => tool.id)).toEqual(["character_four_view", "character_three_view_generation", "character_face_three_view", "product_three_view"]);
        expect(tools.find((tool) => tool.id === "upscale")?.description).toContain("不是 AI 超分");
        expect(tools.find((tool) => tool.id === "crop")?.section).toBe("构图与尺寸");
        expect(tools.find((tool) => tool.id === "resize")?.active).toBe(true);
        expect(tools.find((tool) => tool.id === "copyPrompt")?.group).toBe("more");
        expect(tools.find((tool) => tool.id === "previs")?.group).toBe("camera");
        expect(tools.find((tool) => tool.id === "previs")?.description).toContain("Agent");
    });

    test("depth capture only appears for video nodes when the host provides the handler", () => {
        const video: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "打斗", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "clip.mp4", status: "success" } };
        const image: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "image.png" } };
        const received: CanvasNodeData[] = [];

        // 分享页只提供空处理器集合，工具必须自动隐藏。
        const readOnlyTools = resolveToolbarTools("node-hover", createNodeContext(video), null);
        expect(readOnlyTools.some((tool) => tool.id === "depthCapture")).toBe(false);

        const ctx = createNodeContext(video);
        ctx.handlers.onNodeDepthCapture = (node) => {
            received.push(node);
        };
        const tools = resolveToolbarTools("node-hover", ctx, null);
        const depth = tools.find((tool) => tool.id === "depthCapture")!;
        expect(depth).toBeDefined();
        expect(depth.displayLabel).toBe("深度捕捉");
        expect(resolveNodeToolbarPlacement(depth, ctx).group).toBe("process");
        depth.run?.(ctx);
        expect(received).toEqual([video]);

        // 图片节点不提供深度捕捉。
        const imageCtx = createNodeContext(image);
        imageCtx.handlers.onNodeDepthCapture = () => {};
        expect(resolveToolbarTools("node-hover", imageCtx, null).some((tool) => tool.id === "depthCapture")).toBe(false);

        // 加载中的视频节点也不提供，避免并发写同一节点。
        const loadingCtx = createNodeContext({ ...video, metadata: { ...video.metadata, status: "loading" } });
        loadingCtx.handlers.onNodeDepthCapture = () => {};
        expect(resolveToolbarTools("node-hover", loadingCtx, null).some((tool) => tool.id === "depthCapture")).toBe(false);
    });
});
