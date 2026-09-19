import { describe, expect, test } from "bun:test";

import { mediaDownloadUrl } from "@/lib/download-file";
import { resourceFileUrl, resourceIdFromFileUrl } from "@/services/api/resources";

describe("media download urls", () => {
    test("从资源文件地址提取 ID", () => {
        expect(resourceIdFromFileUrl("/api/resources/abc_123/file")).toBe("abc_123");
        expect(resourceIdFromFileUrl("https://host.example/api/resources/abc_123/file?proxy=1")).toBe("abc_123");
        expect(resourceIdFromFileUrl("https://cdn.example.com/foo.png")).toBe("");
    });

    test("资源下载地址强制走 download=1，避免 CDN 307 后浏览器直接打开图片", () => {
        expect(resourceFileUrl("abc_123", { download: true, fileName: "角色.png" })).toContain("download=1");
        expect(resourceFileUrl("abc_123", { download: true, fileName: "角色.png" })).toContain("filename=");
        expect(mediaDownloadUrl("/api/resources/abc_123/file", "角色.png")).toContain("/resources/abc_123/file?");
        expect(mediaDownloadUrl("/api/resources/abc_123/file", "角色.png")).toContain("download=1");
        expect(mediaDownloadUrl("https://cdn.example.com/foo.png", "角色.png")).toBe("https://cdn.example.com/foo.png");
        expect(mediaDownloadUrl("https://cdn.example.com/foo.png", "角色.png", "resource:abc_123")).toContain("download=1");
    });
});
