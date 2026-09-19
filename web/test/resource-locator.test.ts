import { describe, expect, test } from "bun:test";

import { isBareResourceFileUrl, isStoredMediaLocator, rewriteStoredResourceLocators } from "@/lib/resource-locator";

describe("resource locators", () => {
    test("识别纯资源文件地址", () => {
        expect(isBareResourceFileUrl("/api/resources/abc_123/file")).toBe(true);
        expect(isBareResourceFileUrl("https://host.example/api/resources/abc_123/file")).toBe(true);
        expect(isBareResourceFileUrl("角色设定\n/api/resources/abc_123/file")).toBe(false);
        expect(isBareResourceFileUrl("一段普通文本")).toBe(false);
    });

    test("同步时保留文本正文，只改写媒体地址", () => {
        const textPayload = rewriteStoredResourceLocators({
            content: "这是上传的剧本文本",
            prompt: "这是上传的剧本文本",
            mimeType: "text/plain",
        }, "resource:abc_123");
        expect(textPayload.content).toBe("这是上传的剧本文本");
        expect(textPayload.storageKey).toBe("resource:abc_123");

        const imagePayload = rewriteStoredResourceLocators({
            content: "data:image/png;base64,aaa",
            dataUrl: "data:image/png;base64,aaa",
        }, "resource:img_1");
        expect(imagePayload.content).toBe("/api/resources/img_1/file?direct=1");
        expect(imagePayload.dataUrl).toBe("/api/resources/img_1/file?direct=1");
    });

    test("空内容视为待写入的媒体定位符", () => {
        expect(isStoredMediaLocator("")).toBe(true);
        expect(isStoredMediaLocator("blob:https://example/1")).toBe(true);
    });
});
