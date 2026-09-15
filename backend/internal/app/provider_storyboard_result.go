package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type storyboardResultCharacter struct {
	AssetID   string `json:"assetId"`
	VersionID string `json:"versionId"`
	Name      string `json:"name"`
}

type storyboardResultAssetRef struct {
	NodeID   string `json:"nodeId"`
	Role     string `json:"role"`
	Priority int    `json:"priority"`
}

type storyboardPlanOutput struct {
	Title      string                 `json:"title"`
	StyleGuide string                 `json:"styleGuide"`
	Shots      []storyboardShotOutput `json:"shots"`
}

type storyboardShotOutput struct {
	Description   string                     `json:"description"`
	Duration      int                        `json:"durationSeconds"`
	Dialogue      string                     `json:"dialogue"`
	CharacterIDs  []string                   `json:"characterIds"`
	Intent        string                     `json:"narrativeIntent"`
	ViewerPOV     string                     `json:"viewerPOV"`
	Performance   string                     `json:"performanceBlocking"`
	ShotSize      string                     `json:"shotSize"`
	Emotion       string                     `json:"emotion"`
	Lighting      string                     `json:"lightingAndAtmosphere"`
	AudioEffects  string                     `json:"audioEffects"`
	VisualPrompt  string                     `json:"visualPrompt"`
	VideoPrompt   string                     `json:"videoPrompt"`
	Camera        string                     `json:"camera"`
	Motion        string                     `json:"motion"`
	TimeBeats     string                     `json:"timeBeats"`
	MustHave      []string                   `json:"mustHave"`
	Optional      []string                   `json:"optionalDetails"`
	ContinuityOut string                     `json:"continuityOut"`
	Negative      string                     `json:"negativePrompt"`
	AssetRefs     []storyboardResultAssetRef `json:"assetRefs"`
}

func materializeStoryboardPlanResult(result map[string]interface{}, input canvasGenerationInput) (map[string]interface{}, error) {
	text, _ := result["text"].(string)
	jsonText, err := extractPreferredJSONText(text, "shots")
	if err != nil {
		return nil, fmt.Errorf("分镜规划返回内容无法解析：%w", err)
	}
	var plan storyboardPlanOutput
	if err := json.Unmarshal([]byte(jsonText), &plan); err != nil {
		return nil, fmt.Errorf("分镜规划 JSON 无法解析：%w", err)
	}
	if len(plan.Shots) == 0 {
		return nil, errors.New("分镜规划没有返回任何镜头")
	}
	rows := make([]map[string]interface{}, 0, len(plan.Shots))
	for index, shot := range plan.Shots {
		if shot.Duration < 1 || shot.Duration > 60 {
			return nil, fmt.Errorf("分镜规划第 %d 个镜头时长必须在 1 到 60 秒之间", index+1)
		}
		if strings.TrimSpace(shot.Description) == "" || strings.TrimSpace(shot.VisualPrompt) == "" || strings.TrimSpace(shot.VideoPrompt) == "" {
			return nil, fmt.Errorf("分镜规划第 %d 个镜头缺少剧情、首帧或视频提示词", index+1)
		}
		rows = append(rows, map[string]interface{}{
			"shotNumber": index + 1, "durationSeconds": shot.Duration, "plotDescription": shot.Description,
			"dialogue": shot.Dialogue, "characters": storyboardResultCharacters(shot.CharacterIDs, input.StoryboardCharacters),
			"narrativeIntent": shot.Intent, "viewerPOV": shot.ViewerPOV, "performanceBlocking": shot.Performance,
			"shotSize": shot.ShotSize, "emotion": shot.Emotion, "lightingAndAtmosphere": shot.Lighting, "audioEffects": shot.AudioEffects,
			"camera": shot.Camera, "motion": shot.Motion, "timeBeats": shot.TimeBeats,
			"imageGenerationPrompt": shot.VisualPrompt, "videoMotionPrompt": shot.VideoPrompt,
			"imagePromptTemplateVariables": storyboardImageTemplateValues(input, plan.StyleGuide, shot),
			"videoPromptTemplateVariables": storyboardVideoTemplateValues(input, plan.StyleGuide, shot),
			"mustHave":                     nonNilStoryboardStrings(shot.MustHave), "optionalDetails": nonNilStoryboardStrings(shot.Optional),
			"continuityOut": shot.ContinuityOut, "negativePrompt": shot.Negative, "assetBindings": nonNilStoryboardAssetRefs(shot.AssetRefs),
		})
	}
	return map[string]interface{}{"title": strings.TrimSpace(plan.Title), "rows": rows}, nil
}

func storyboardResultCharacters(ids []string, characters []storyboardResultCharacter) []map[string]interface{} {
	byID := make(map[string]storyboardResultCharacter, len(characters))
	byName := make(map[string]storyboardResultCharacter, len(characters))
	for _, character := range characters {
		if id := strings.TrimSpace(character.AssetID); id != "" {
			byID[id] = character
		}
		if name := strings.ToLower(strings.TrimSpace(character.Name)); name != "" {
			byName[name] = character
		}
	}
	result := make([]map[string]interface{}, 0, len(ids))
	seen := map[string]bool{}
	for _, value := range ids {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		character, ok := byID[value]
		if !ok {
			character, ok = byName[strings.ToLower(value)]
		}
		name := value
		if ok {
			name = strings.TrimSpace(character.Name)
		}
		key := strings.ToLower(name)
		if seen[key] {
			continue
		}
		seen[key] = true
		item := map[string]interface{}{"characterName": name}
		if ok && strings.TrimSpace(character.AssetID) != "" && strings.TrimSpace(character.VersionID) != "" {
			item["characterAssetId"] = strings.TrimSpace(character.AssetID)
			item["characterVersionId"] = strings.TrimSpace(character.VersionID)
		}
		result = append(result, item)
	}
	return result
}

func storyboardImageTemplateValues(input canvasGenerationInput, styleGuide string, shot storyboardShotOutput) map[string]string {
	return map[string]string{
		"项目视觉": strings.TrimSpace(input.StoryboardProjectStyle.Prompt + "\n" + styleGuide),
		"首帧构图": shot.VisualPrompt, "表演起始状态": shot.Performance, "负面要求": shot.Negative,
	}
}

func storyboardVideoTemplateValues(input canvasGenerationInput, styleGuide string, shot storyboardShotOutput) map[string]string {
	return map[string]string{
		"项目视觉": strings.TrimSpace(input.StoryboardProjectStyle.Prompt + "\n" + styleGuide),
		"镜头意图": shot.Intent, "首帧构图": shot.VisualPrompt, "表演与调度": shot.Performance,
		"摄影机": strings.TrimSpace(shot.Camera + "\n" + shot.Motion), "时间节拍": shot.TimeBeats,
		"运动与结尾": strings.TrimSpace(shot.VideoPrompt + "\n" + shot.ContinuityOut),
		"声音":    strings.TrimSpace(shot.Dialogue + "\n" + shot.AudioEffects),
		"执行优先级": strings.Join(shot.MustHave, "；"), "负面要求": shot.Negative,
	}
}

func nonNilStoryboardStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func nonNilStoryboardAssetRefs(values []storyboardResultAssetRef) []storyboardResultAssetRef {
	if values == nil {
		return []storyboardResultAssetRef{}
	}
	return values
}
