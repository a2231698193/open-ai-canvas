import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";

test("lk888-video MiniMax H3 uses vendor ratios and resolutions", () => {
    expect(defaultModelCapabilityConfig("lk888-video", "minimax-h3").video).toMatchObject({
        defaultRatio: "adaptive",
        ratios: ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        resolutions: ["768P", "1080P", "2K", "4K"],
        defaultResolution: "768P",
    });
});
