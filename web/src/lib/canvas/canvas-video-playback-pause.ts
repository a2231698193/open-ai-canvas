type PauseTarget = {
    closest(selector: string): { getAttribute(name: string): string | null } | null;
};

type PausableMedia = {
    paused: boolean;
    pause: () => void;
};

const CANVAS_VIDEO_PAUSE_IGNORE_SELECTOR = "[data-canvas-node-panel], [data-canvas-no-zoom], .ant-modal, .ant-popover, .ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown, .vds-menu, .vds-menu-items";

/**
 * 正在播放的视频节点只在点到画布空白或另一个节点时暂停。
 * 节点自己的控件、悬浮工具条和提示词面板都不算离开播放。
 */
export function shouldPausePlayingCanvasVideo(target: EventTarget | null, playingNodeId: string): boolean {
    const element = asPauseTarget(target);
    if (!element || !playingNodeId) return false;
    const node = element.closest("[data-node-id]");
    if (node) return node.getAttribute("data-node-id") !== playingNodeId;
    if (!element.closest("[data-canvas-viewport]")) return false;
    return !element.closest(CANVAS_VIDEO_PAUSE_IGNORE_SELECTOR);
}

/** 暂停指定节点里正在播放的视频，保留当前进度。已经暂停或不存在时不操作。 */
export function pauseCanvasNodeVideo(root: ParentNode, nodeId: string): boolean {
    if (!nodeId) return false;
    const node = root.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`);
    const media = findPausableMedia(node);
    if (!media || media.paused) return false;
    media.pause();
    return true;
}

function asPauseTarget(target: EventTarget | null): PauseTarget | null {
    if (!target || typeof target !== "object" || !("closest" in target)) return null;
    return typeof target.closest === "function" ? target as PauseTarget : null;
}

function findPausableMedia(node: Element | null): PausableMedia | null {
    if (!node) return null;
    for (const candidate of [node.querySelector("media-player"), node.querySelector("video")]) {
        if (isPausable(candidate)) return candidate;
    }
    return null;
}

function isPausable(value: Element | null): value is Element & PausableMedia {
    if (!value || !("paused" in value) || typeof value.paused !== "boolean") return false;
    return typeof (value as { pause?: unknown }).pause === "function";
}

function cssEscape(value: string) {
    return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}
