import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import { getResourceBlob, resourceStorageKey } from "../src/services/api/resources";

const originalFetch = globalThis.fetch;
const originalAdapter = apiClient.defaults.adapter;

/** 直连被拦下的主机（模拟对象存储没有配 CORS）。 */
let blockedHosts = new Set<string>();
let fetches: string[] = [];
let sequence = 0;

function nextKey(host: string) {
    // 资源 ID 同时决定 OSS 主机，方便每个用例拿到互不干扰的主机名。
    return resourceStorageKey(`${host}-${++sequence}`);
}

beforeEach(() => {
    blockedHosts = new Set();
    fetches = [];
    apiClient.defaults.adapter = (async (config) => {
        const id = decodeURIComponent(String(config.url).split("/").at(-2) || "");
        const host = id.replace(/-\d+$/, "");
        return {
            config,
            status: 200,
            statusText: "",
            headers: {},
            data: { code: 0, data: { url: `https://${host}/object.png` }, msg: "ok" },
        };
    }) as typeof apiClient.defaults.adapter;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        fetches.push(url);
        const host = new URL(url, "http://localhost").host;
        if (blockedHosts.has(host)) throw new TypeError("Failed to fetch");
        return new Response(new Blob(["bytes"]), { status: 200, headers: { "content-type": "image/png" } });
    }) as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    apiClient.defaults.adapter = originalAdapter;
});

describe("resource blob direct read", () => {
    test("直连可用时直接返回，不经过同源代理", async () => {
        const blob = await getResourceBlob(nextKey("cdn-ok.example"), { allowProxyFallback: true });
        expect(blob).not.toBeNull();
        expect(fetches).toHaveLength(1);
        expect(fetches[0]).toContain("cdn-ok.example");
    });

    test("直连被 CORS 拦下时回落到同源代理", async () => {
        blockedHosts.add("cdn-blocked.example");
        const blob = await getResourceBlob(nextKey("cdn-blocked.example"), { allowProxyFallback: true });
        expect(blob).not.toBeNull();
        expect(fetches).toHaveLength(2);
        expect(fetches[1]).toContain("/file?proxy=1");
    });

    test("同一个主机失败过一次后不再重复直连", async () => {
        blockedHosts.add("cdn-repeat.example");
        await getResourceBlob(nextKey("cdn-repeat.example"), { allowProxyFallback: true });
        fetches = [];

        const blob = await getResourceBlob(nextKey("cdn-repeat.example"), { allowProxyFallback: true });
        expect(blob).not.toBeNull();
        expect(fetches).toHaveLength(1);
        expect(fetches[0]).toContain("/file?proxy=1");
    });

    test("不允许代理兜底时返回空，且不会去请求代理", async () => {
        blockedHosts.add("cdn-nofallback.example");
        const blob = await getResourceBlob(nextKey("cdn-nofallback.example"));
        expect(blob).toBeNull();
        expect(fetches.some((url) => url.includes("proxy=1"))).toBe(false);
    });
});
