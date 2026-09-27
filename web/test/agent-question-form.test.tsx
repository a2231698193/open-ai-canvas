import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentQuestionBar, cloudAgentFormDefaults, parseCloudAgentFormAnswer, type CloudAgentFormField } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { canvasThemes } from "@/lib/canvas-theme";

test("form defaults honor explicit values, recommended IDs, and label-only choices", () => {
    const fields: CloudAgentFormField[] = [
        { id: "ratio", title: "画幅", type: "segmented", required: true, options: [{ id: "9:16", label: "竖屏", recommended: true }] },
        { id: "style", title: "画风", type: "single_select", options: [{ label: "水彩", recommended: true }] },
        { id: "genre", title: "题材", type: "text", defaultValue: "喜剧", options: [{ label: "剧情", recommended: true }] },
        { id: "notes", title: "说明", type: "textarea" },
    ];
    const answers = cloudAgentFormDefaults(fields);
    expect(answers).toEqual({ ratio: "9:16", style: "水彩", genre: "喜剧", notes: "" });
    const html = renderToStaticMarkup(<AgentQuestionBar question={{ question: "创作方向", options: [], fields }} theme={canvasThemes.light} onAnswer={() => {}} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("按推荐方案开始");
    expect(parseCloudAgentFormAnswer(JSON.stringify({ type: "form_answer", answers }))?.answers.ratio).toBe("9:16");
});
