import { afterEach, beforeEach, expect, test } from "bun:test";
import { initializeRemoteUserDataSession, installRemoteUserDataAutoSync, resetRemoteUserDataSync, scheduleRemoteUserDataSync } from "../src/services/user-data-sync";
import { useCanvasStore, type CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { useAssetStore } from "../src/stores/use-asset-store";

const originalWindow = globalThis.window;

/**
 * 订阅是模块级状态。没有浏览器窗口时排同步必须安静跳过，
 * 重置也必须真的解除订阅，否则它会在下一个宿主里被触发。
 */
function stubWindow() {
    const timers: number[] = [];
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout: () => {
                timers.push(timers.length + 1);
                return timers.length;
            },
            clearTimeout: () => undefined,
            localStorage: { getItem: () => null, setItem: () => undefined },
        },
    });
    return timers;
}

function canvasProject(id: string): CanvasProject {
    return {
        id,
        revision: 0,
        title: id,
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    };
}

beforeEach(() => {
    resetRemoteUserDataSync();
    useCanvasStore.setState({ projects: [] });
    useAssetStore.setState({ assets: [] });
});

afterEach(() => {
    resetRemoteUserDataSync();
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

test("teardown uninstalls the auto-sync subscriptions instead of leaving them live", async () => {
    const timers = stubWindow();
    await initializeRemoteUserDataSession("user-1");
    installRemoteUserDataAutoSync();

    useCanvasStore.setState({ projects: [canvasProject("first")] });
    expect(timers.length).toBeGreaterThan(0);

    resetRemoteUserDataSync();
    const afterReset = timers.length;

    // 重新开会话但没有重新安装：泄漏的订阅会在这里排同步，修好后不会。
    await initializeRemoteUserDataSession("user-1");
    useCanvasStore.setState({ projects: [canvasProject("second")] });
    expect(timers.length).toBe(afterReset);

    installRemoteUserDataAutoSync();
    useCanvasStore.setState({ projects: [canvasProject("third")] });
    expect(timers.length).toBeGreaterThan(afterReset);
});

test("a canvas or asset write without a browser window does not throw", async () => {
    stubWindow();
    await initializeRemoteUserDataSession("user-1");
    installRemoteUserDataAutoSync();
    delete (globalThis as { window?: unknown }).window;

    expect(() => scheduleRemoteUserDataSync()).not.toThrow();
    expect(() => useCanvasStore.setState({ projects: [canvasProject("no-window")] })).not.toThrow();
    expect(() => useAssetStore.setState((state) => ({ assets: [...state.assets] }))).not.toThrow();
});
