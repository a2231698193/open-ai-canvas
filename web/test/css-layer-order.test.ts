import { expect, test } from "bun:test";

test("全局样式在懒加载 CSS 前固定层级顺序", async () => {
    const [html, application, globals] = await Promise.all([
        Bun.file(new URL("../index.html", import.meta.url)).text(),
        Bun.file(new URL("../src/application.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text(),
    ]);

    expect(html).toContain("@layer properties, theme, base, components, utilities;");
    expect(application).not.toContain('import "antd/dist/reset.css";');
    expect(globals).toContain('@import "antd/dist/reset.css" layer(base);');
    expect(globals.indexOf('@import "antd/dist/reset.css" layer(base);')).toBeLessThan(globals.indexOf('@import "tailwindcss";'));
});
