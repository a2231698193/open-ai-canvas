package app

import "testing"

func TestMaterializeStoryboardPlanResult(t *testing.T) {
	input := canvasGenerationInput{StoryboardCharacters: []storyboardResultCharacter{{AssetID: "character-1", VersionID: "version-1", Name: "林默"}}}
	input.StoryboardProjectStyle.Prompt = "冷色电影光"
	result, err := materializeStoryboardPlanResult(map[string]interface{}{"text": "```json\n" + validStoryboardPlanJSON() + "\n```"}, input)
	if err != nil {
		t.Fatalf("materializeStoryboardPlanResult() error = %v", err)
	}
	rows, ok := result["rows"].([]map[string]interface{})
	if !ok || len(rows) != 1 {
		t.Fatalf("rows = %#v, want one row", result["rows"])
	}
	row := rows[0]
	if row["plotDescription"] != "林默推门" || row["imageGenerationPrompt"] != "雨夜旧屋首帧" || row["videoMotionPrompt"] != "缓慢推进" {
		t.Fatalf("row prompts were not materialized: %#v", row)
	}
	characters, ok := row["characters"].([]map[string]interface{})
	if !ok || len(characters) != 1 || characters[0]["characterAssetId"] != "character-1" || characters[0]["characterVersionId"] != "version-1" {
		t.Fatalf("row characters were not resolved: %#v", row["characters"])
	}
}

func TestMaterializeStoryboardPlanResultRejectsMissingShots(t *testing.T) {
	if _, err := materializeStoryboardPlanResult(map[string]interface{}{"text": `{"title":"空分镜","shots":[]}`}, canvasGenerationInput{}); err == nil {
		t.Fatal("materializeStoryboardPlanResult() error = nil, want missing shots error")
	}
}

func validStoryboardPlanJSON() string {
	return `{"title":"雨夜","styleGuide":"冷色写实","shots":[{"description":"林默推门","durationSeconds":5,"dialogue":"有人吗？","characterIds":["character-1"],"narrativeIntent":"建立悬念","viewerPOV":"跟随","performanceBlocking":"谨慎推门","shotSize":"中景","emotion":"戒备","lightingAndAtmosphere":"冷色月光","audioEffects":"雨声","visualPrompt":"雨夜旧屋首帧","videoPrompt":"缓慢推进","camera":"平视","motion":"推进","timeBeats":"0-5 秒推门","mustHave":["角色一致"],"optionalDetails":[],"continuityOut":"手扶门把","negativePrompt":"文字","assetRefs":[{"nodeId":"prop-1","role":"prop","priority":80}]}]}`
}
