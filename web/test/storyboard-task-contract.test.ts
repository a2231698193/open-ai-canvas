import { describe, expect, test } from "bun:test";

import { storyboardPlanTaskMetadata, storyboardRowsFromTextResult } from "@/lib/canvas/storyboard-task-contract";

describe("分镜文本任务合同", () => {
    test("生成服务端分镜模板需要的受保护变量", () => {
        const metadata = storyboardPlanTaskMetadata({
            brief: "雨夜追逐",
            requirements: "保持因果完整",
            assets: [{ id: "prop-1" }],
            projectStyle: { title: "都市写实", prompt: "冷色电影光" },
            characters: [{ assetId: "character-1", versionId: "version-1", name: "林默" }],
            shotDurationSeconds: 5,
            shotCount: 3,
        });
        expect(metadata.promptTemplateOperation).toBe("storyboard_plan");
        expect(metadata.promptTemplateVariables).toMatchObject({
            剧情: "雨夜追逐",
            项目画风: "冷色电影光",
            单镜头时长规则: "本次生成单个镜头时长必须严格等于 5 秒。",
            镜头数量规则: "shots 数组必须严格输出 3 个镜头。",
        });
    });

    test("从旧版 canvas_text 文本结果恢复镜头行", () => {
        const text = "```json\n" + JSON.stringify({
            title: "雨夜",
            shots: [{
                description: "林默推门", durationSeconds: 5, dialogue: "有人吗？", characterIds: ["character-1"],
                narrativeIntent: "建立悬念", viewerPOV: "跟随", performanceBlocking: "谨慎推门", shotSize: "中景", emotion: "戒备",
                lightingAndAtmosphere: "冷色月光", audioEffects: "雨声", visualPrompt: "雨夜旧屋首帧", videoPrompt: "缓慢推进",
                camera: "平视", motion: "推进", timeBeats: "0-5 秒推门", mustHave: ["角色一致"], optionalDetails: [],
                continuityOut: "手扶门把", negativePrompt: "文字", assetRefs: [{ nodeId: "prop-1", role: "prop", priority: 80 }],
            }],
        }) + "\n```";
        const result = storyboardRowsFromTextResult(text, JSON.stringify({ characters: [{ assetId: "character-1", versionId: "version-1", name: "林默" }] }));
        expect(result?.title).toBe("雨夜");
        expect(result?.rows[0]).toMatchObject({
            durationSeconds: 5,
            plotDescription: "林默推门",
            imageGenerationPrompt: "雨夜旧屋首帧",
            videoMotionPrompt: "缓慢推进",
            characters: [{ characterName: "林默", characterAssetId: "character-1", characterVersionId: "version-1" }],
            assetBindings: [{ nodeId: "prop-1", role: "prop", priority: 80 }],
        });
    });
});
