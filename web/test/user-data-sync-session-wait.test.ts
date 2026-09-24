import { expect, test } from "bun:test";

import { hasRemoteUserDataSyncSession, initializeRemoteUserDataSession, resetRemoteUserDataSync, waitForRemoteUserDataSyncSession } from "@/services/user-data-sync";

/**
 * 画布本地秒开时项目已可交互，云端会话仍由后台建立。素材落库要能等这段窗口，
 * 但不能把"没登录"也拖成 10 秒静默，也不能在超时后改变原有报错路径。
 */
test("会话未建立时等待窗口内返回 false，而不是假装成功", async () => {
    resetRemoteUserDataSync();
    expect(hasRemoteUserDataSyncSession()).toBe(false);
    expect(await waitForRemoteUserDataSyncSession(0)).toBe(false);
});

test("会话在等待窗口内建立时必须等到它", async () => {
    resetRemoteUserDataSync();
    const pending = waitForRemoteUserDataSyncSession(2_000);
    setTimeout(() => void initializeRemoteUserDataSession("user-1"), 50);
    expect(await pending).toBe(true);
    expect(hasRemoteUserDataSyncSession()).toBe(true);
    resetRemoteUserDataSync();
});

test("会话已经就绪时立即返回，不引入无谓等待", async () => {
    await initializeRemoteUserDataSession("user-1");
    const startedAt = Date.now();
    expect(await waitForRemoteUserDataSyncSession(5_000)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(200);
    resetRemoteUserDataSync();
});

test("等待期间取消请求按 AbortError 抛出，保持调用方的取消语义", async () => {
    resetRemoteUserDataSync();
    const controller = new AbortController();
    controller.abort();
    await expect(waitForRemoteUserDataSyncSession(2_000, controller.signal)).rejects.toThrow("The operation was aborted");
});
