package app

import (
	"strings"
	"testing"
)

func TestCloudAgentMediaOperationPrefersExplicitValue(t *testing.T) {
	imageRefs := map[string]any{"referenceImages": []any{map[string]any{"id": "img-1"}, map[string]any{"id": "img-2"}}}

	// 纯图参考只能推导出单首帧的 image_to_video，这正是 H3 多图全能参考撞上游限制的原因。
	inferred, err := cloudAgentMediaOperation("video", imageRefs, "")
	if err != nil || inferred != "image_to_video" {
		t.Fatalf("inferred = %q, err = %v", inferred, err)
	}

	explicit, err := cloudAgentMediaOperation("video", imageRefs, "reference_to_video")
	if err != nil || explicit != "reference_to_video" {
		t.Fatalf("explicit = %q, err = %v", explicit, err)
	}

	// 显式值优先于推导：即使挂了参考视频，也应尊重调用方的选择。
	videoRefs := map[string]any{"referenceVideos": []any{map[string]any{"id": "v-1"}}}
	if value, err := cloudAgentMediaOperation("video", videoRefs, "text_to_video"); err != nil || value != "text_to_video" {
		t.Fatalf("explicit over inference = %q, err = %v", value, err)
	}
}

func TestCloudAgentMediaOperationRejectsUnknownValues(t *testing.T) {
	if _, err := cloudAgentMediaOperation("video", nil, "reference2video"); err == nil || !strings.Contains(err.Error(), "reference_to_video") {
		t.Fatalf("unknown value should list the allowed ones, err = %v", err)
	}
	if _, err := cloudAgentMediaOperation("audio", nil, "reference_to_video"); err == nil || !strings.Contains(err.Error(), "text_to_audio") {
		t.Fatalf("audio mode must reject a video operation and list its own values, err = %v", err)
	}
}

func TestCloudAgentMediaOperationCoversEveryExposedMode(t *testing.T) {
	for _, mode := range cloudAgentGenerationModeNames() {
		if cloudAgentInferredMediaOperation(mode, nil) == "" {
			t.Fatalf("暴露的模式 %s 缺少默认推导操作", mode)
		}
		if len(cloudAgentMediaOperations[mode]) == 0 {
			t.Fatalf("暴露的模式 %s 没有声明可用操作", mode)
		}
	}
}
