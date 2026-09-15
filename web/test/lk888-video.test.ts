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

test("lk888-seedance includes adaptive ratio", () => {
    expect(defaultModelCapabilityConfig("lk888-seedance", "doubao-seedance-2-0-260128").video).toMatchObject({
        defaultRatio: "adaptive",
        ratios: ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        resolutions: ["480p", "720p", "1080p", "4k"],
        defaultResolution: "720p",
    });
    expect(defaultModelCapabilityConfig("lk888-seedance-anmiao", "doubao-seedance-2-0-fast-260128").video).toMatchObject({
        defaultRatio: "adaptive",
        resolutions: ["480p", "720p"],
    });
});
