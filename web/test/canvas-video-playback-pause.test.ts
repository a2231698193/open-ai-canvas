import { describe, expect, test } from "bun:test";
import { pauseCanvasNodeVideo, shouldPausePlayingCanvasVideo } from "../src/lib/canvas/canvas-video-playback-pause";

type FakeNode = {
    attrs: Record<string, string>;
    parent: FakeNode | null;
    closest(selector: string): FakeNode | null;
    getAttribute(name: string): string | null;
};

function node(attrs: Record<string, string>, parent: FakeNode | null = null): FakeNode {
    const current: FakeNode = {
        attrs,
        parent,
        getAttribute(name) {
            return this.attrs[name] ?? null;
        },
        closest(selector) {
            let cursor: FakeNode | null = this;
            while (cursor) {
                if (selector.split(",").some((part) => matches(cursor!, part.trim()))) return cursor;
                cursor = cursor.parent;
            }
            return null;
        },
    };
    return current;
}

function matches(target: FakeNode, selector: string) {
    if (selector.startsWith(".")) return target.attrs.class?.split(/\s+/).includes(selector.slice(1)) || false;
    const match = selector.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
    if (!match) return false;
    const value = target.attrs[match[1]];
    return match[2] === undefined ? value !== undefined : value === match[2];
}

describe("canvas video playback pause", () => {
    const viewport = node({ "data-canvas-viewport": "" });
    const playing = node({ "data-node-id": "video-a" }, viewport);
    const other = node({ "data-node-id": "image-b" }, viewport);
    const blank = node({}, viewport);
    const panel = node({ "data-canvas-node-panel": "" }, viewport);
    const toolbar = node({ "data-canvas-no-zoom": "" }, viewport);
    const outside = node({ class: "ant-modal" });

    test("点空白或其它节点时暂停，点当前节点、工具条和面板时不暂停", () => {
        expect(shouldPausePlayingCanvasVideo(blank as unknown as EventTarget, "video-a")).toBe(true);
        expect(shouldPausePlayingCanvasVideo(other as unknown as EventTarget, "video-a")).toBe(true);
        expect(shouldPausePlayingCanvasVideo(playing as unknown as EventTarget, "video-a")).toBe(false);
        expect(shouldPausePlayingCanvasVideo(panel as unknown as EventTarget, "video-a")).toBe(false);
        expect(shouldPausePlayingCanvasVideo(toolbar as unknown as EventTarget, "video-a")).toBe(false);
        expect(shouldPausePlayingCanvasVideo(outside as unknown as EventTarget, "video-a")).toBe(false);
        expect(shouldPausePlayingCanvasVideo(blank as unknown as EventTarget, "")).toBe(false);
    });

    test("只暂停正在播放的节点视频，并保留已经暂停的进度", () => {
        let paused = false;
        const media = {
            paused: false,
            pause() {
                paused = true;
                this.paused = true;
            },
        };
        const root = {
            querySelector(selector: string) {
                return selector.includes("video-a") ? { querySelector: (inner: string) => inner === "media-player" ? media : null } : null;
            },
        };

        expect(pauseCanvasNodeVideo(root as unknown as ParentNode, "video-a")).toBe(true);
        expect(paused).toBe(true);
        expect(pauseCanvasNodeVideo(root as unknown as ParentNode, "video-a")).toBe(false);
        expect(pauseCanvasNodeVideo(root as unknown as ParentNode, "missing")).toBe(false);
    });
});
