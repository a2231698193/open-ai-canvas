import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("asset library header buttons", () => {
    test("only restyles header buttons in light mode and uses outline tokens", () => {
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        const headerButtonRule = css.match(/html:not\(\.dark\) \.library-page \.app-page-header \.ant-btn,[\s\S]*?transition: all 180ms ease-out !important;\s*}/)?.[0] || "";
        const headerButtonHoverRule = css.match(/html:not\(\.dark\) \.library-page \.app-page-header \.ant-btn:hover,[\s\S]*?transform: translateY\(-1px\);\s*}/)?.[0] || "";

        expect(headerButtonRule).toContain("html:not(.dark) .canvas-library-page .app-page-header .ant-btn");
        expect(headerButtonRule).toContain("background: transparent !important;");
        expect(headerButtonRule).toContain("color: var(--foreground) !important;");
        expect(headerButtonHoverRule).toContain("background: var(--btn-outline-hover-bg) !important;");
        expect(headerButtonHoverRule).toContain("color: var(--foreground) !important;");
        expect(css).not.toContain("\n    .library-page .app-page-header .ant-btn,\n");
    });
});
