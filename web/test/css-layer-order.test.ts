import { expect, test } from "bun:test";

const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
const layerOrder = "@layer properties, theme, base, components, utilities;";
const tailwindLayerOrder = "@layer theme, base, components, utilities;";

test("HTML 在任何外部样式或脚本之前固定 CSS 层顺序", () => {
    const firstStyle = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i);
    expect(firstStyle).not.toBeNull();
    const css = firstStyle![1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(css.startsWith(layerOrder)).toBe(true);

    const firstLoad = html.search(/<script\b|<link\b[^>]*\brel=["'](?:stylesheet|modulepreload)["']/i);
    expect(firstLoad).toBeGreaterThan(html.indexOf(layerOrder));
});

// 手工剪辑插件已随官方 v1.8.4 退场，不再有 editor-shell.css 参与层顺序；
// 这里改为校验全站全局样式本身声明的层顺序与 index.html 固定的一致。
test("入口层顺序与全局样式的 @layer 声明一致", async () => {
    const globals = await Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text();
    const firstStyle = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i)![1];
    const layersIn = (css: string) => [...new Set([...css.matchAll(/@layer\s+([^;{]+)[;{]/g)].flatMap((match) => match[1].split(",").map((name) => name.trim())))];
    // 全局样式只用到 base 与 utilities，不自己重排层顺序；完整顺序由 index.html 的第一段样式固定。
    const layers = layersIn(globals);
    expect(layers.every((name) => ["base", "utilities", "components", "theme", "properties"].includes(name))).toBe(true);
    expect(layersIn(firstStyle)).toEqual(["properties", "theme", "base", "components", "utilities"]);
});

test("Ant Design reset stays in the base layer", async () => {
    const [application, globals] = await Promise.all([
        Bun.file(new URL("../src/application.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text(),
    ]);

    expect(application).not.toContain('import "antd/dist/reset.css";');
    expect(globals).toContain('@import "antd/dist/reset.css" layer(base);');
    expect(globals.indexOf('@import "antd/dist/reset.css" layer(base);')).toBeLessThan(globals.indexOf('@import "tailwindcss";'));
});
