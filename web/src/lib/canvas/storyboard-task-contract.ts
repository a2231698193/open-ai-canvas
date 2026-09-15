import { PromptTemplateOperation } from "@/lib/prompts";
import type { StoryboardRow } from "@/types/canvas";

type StoryboardTaskCharacter = {
    assetId?: string;
    versionId?: string;
    name: string;
    definition?: Record<string, unknown>;
};

type StoryboardTaskInput = {
    brief: string;
    requirements: string;
    assets: unknown[];
    projectStyle: { title: string; prompt: string };
    characters: StoryboardTaskCharacter[];
    shotDurationSeconds: number;
    shotCount: number;
};

type StoryboardPlanShot = {
    description?: string;
    durationSeconds?: number;
    dialogue?: string;
    characterIds?: string[];
    narrativeIntent?: string;
    viewerPOV?: string;
    performanceBlocking?: string;
    shotSize?: string;
    emotion?: string;
    lightingAndAtmosphere?: string;
    audioEffects?: string;
    visualPrompt?: string;
    videoPrompt?: string;
    camera?: string;
    motion?: string;
    timeBeats?: string;
    mustHave?: string[];
    optionalDetails?: string[];
    continuityOut?: string;
    negativePrompt?: string;
    assetRefs?: StoryboardRow["assetBindings"];
};

export function storyboardPlanTaskMetadata(input: StoryboardTaskInput) {
    const durationRule = [5, 10, 15, 30].includes(input.shotDurationSeconds)
        ? `本次生成单个镜头时长必须严格等于 ${input.shotDurationSeconds} 秒。`
        : "单个镜头时长由剧情节奏决定，必须是 1 到 60 秒的整数。";
    const countRule = input.shotCount >= 1 && input.shotCount <= 10
        ? `shots 数组必须严格输出 ${input.shotCount} 个镜头。`
        : "镜头数量由模型按剧情节奏自动决定，但 shots 数组必须为 1 到 12 个镜头，并优先使用完整表达剧情所需的最少镜头数。";
    return {
        promptTemplateOperation: PromptTemplateOperation.StoryboardPlan,
        promptTemplateVariables: {
            项目名称: input.projectStyle.title,
            剧情: input.brief,
            用户要求: input.requirements,
            画布资产: JSON.stringify(input.assets),
            项目画风: input.projectStyle.prompt,
            角色版本: JSON.stringify(input.characters),
            单镜头时长规则: durationRule,
            镜头数量规则: countRule,
        },
    };
}

// 兼容官方切换到 canvas_text 后、服务端尚未物化 rows 时已经完成的任务。
export function storyboardRowsFromTextResult(text: string, inputJson?: string): { title?: string; rows: Array<Partial<StoryboardRow>> } | null {
    const plan = extractStoryboardPlan(text);
    if (!plan) return null;
    const characters = taskCharacters(inputJson);
    return {
        title: typeof plan.title === "string" ? plan.title : undefined,
        rows: plan.shots.map((shot) => ({
            durationSeconds: Number(shot.durationSeconds) || 6,
            plotDescription: stringValue(shot.description),
            dialogue: stringValue(shot.dialogue),
            characters: resolveCharacters(shot.characterIds, characters),
            narrativeIntent: stringValue(shot.narrativeIntent),
            viewerPOV: stringValue(shot.viewerPOV),
            performanceBlocking: stringValue(shot.performanceBlocking),
            shotSize: stringValue(shot.shotSize),
            emotion: stringValue(shot.emotion),
            lightingAndAtmosphere: stringValue(shot.lightingAndAtmosphere),
            audioEffects: stringValue(shot.audioEffects),
            camera: stringValue(shot.camera),
            motion: stringValue(shot.motion),
            timeBeats: stringValue(shot.timeBeats),
            imageGenerationPrompt: stringValue(shot.visualPrompt),
            videoMotionPrompt: stringValue(shot.videoPrompt),
            mustHave: stringArray(shot.mustHave),
            optionalDetails: stringArray(shot.optionalDetails),
            continuityOut: stringValue(shot.continuityOut),
            negativePrompt: stringValue(shot.negativePrompt),
            assetBindings: Array.isArray(shot.assetRefs) ? shot.assetRefs : [],
        })),
    };
}

function extractStoryboardPlan(raw: string): ({ title?: unknown; shots: StoryboardPlanShot[] }) | null {
    for (let start = 0; start < raw.length; start += 1) {
        if (raw[start] !== "{") continue;
        const end = jsonValueEnd(raw, start);
        if (end < start) continue;
        try {
            const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as { shots?: unknown }).shots) && (parsed as { shots: unknown[] }).shots.length) {
                return parsed as { title?: unknown; shots: StoryboardPlanShot[] };
            }
        } catch {
            // Continue past prose braces or unrelated JSON fragments.
        }
    }
    return null;
}

function jsonValueEnd(source: string, start: number) {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
        const value = source[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (value === "\\") escaped = true;
            else if (value === '"') inString = false;
            continue;
        }
        if (value === '"') inString = true;
        else if (value === "{" || value === "[") stack.push(value);
        else if (value === "}" || value === "]") {
            const opener = stack.pop();
            if ((value === "}" && opener !== "{") || (value === "]" && opener !== "[")) return -1;
            if (!stack.length) return index;
        }
    }
    return -1;
}

function taskCharacters(inputJson?: string): StoryboardTaskCharacter[] {
    if (!inputJson) return [];
    try {
        const input = JSON.parse(inputJson) as { characters?: unknown };
        return Array.isArray(input.characters) ? input.characters as StoryboardTaskCharacter[] : [];
    } catch {
        return [];
    }
}

function resolveCharacters(ids: string[] | undefined, characters: StoryboardTaskCharacter[]): StoryboardRow["characters"] {
    const byID = new Map(characters.filter((item) => item.assetId).map((item) => [item.assetId!, item]));
    const byName = new Map(characters.map((item) => [item.name.trim().toLocaleLowerCase("zh-CN"), item]));
    return stringArray(ids).map((value) => {
        const character = byID.get(value) || byName.get(value.toLocaleLowerCase("zh-CN"));
        return character ? {
            characterName: character.name,
            ...(character.assetId ? { characterAssetId: character.assetId } : {}),
            ...(character.versionId ? { characterVersionId: character.versionId } : {}),
        } : { characterName: value };
    });
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}
