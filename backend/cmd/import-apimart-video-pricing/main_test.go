package main

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCreditsToMicrocredits(t *testing.T) {
	if got := creditsToMicrocredits(0.216); got != 15_120_000 {
		t.Fatalf("creditsToMicrocredits() = %d, want 15120000", got)
	}
}

func TestConfigureAPIMartVideoModel(t *testing.T) {
	item := &model.ChannelModel{ModelKey: "MiniMax-H3"}
	configureAPIMartVideoModel(item)
	if item.ProviderModelKey != item.ModelKey || item.Capability != "video" || item.Protocol != model.ChannelInterfaceAPIMartVideo || !item.Enabled {
		t.Fatalf("configured model = %#v", item)
	}
	var config struct {
		Video struct {
			DefaultResolution string `json:"defaultResolution"`
		} `json:"video"`
	}
	if err := json.Unmarshal([]byte(item.CapabilityConfigJSON), &config); err != nil {
		t.Fatal(err)
	}
	if config.Video.DefaultResolution != "2K" {
		t.Fatalf("default resolution = %q, want 2K", config.Video.DefaultResolution)
	}
}

func TestSelectorForVideoPrice(t *testing.T) {
	tests := []struct {
		model, name string
		want        map[string]string
	}{
		{"other", "default", map[string]string{}},
		{"other", "1080P-input", map[string]string{"vquality": "1080p", "operation": "image_to_video"}},
		{"other", "720P-10S", map[string]string{"vquality": "720p", "videoSeconds": "10"}},
		{"other", "1080P-refvideo", map[string]string{"vquality": "1080p", "operation": "reference_to_video"}},
		{"kling-v3", "pro-sound", map[string]string{"vquality": "1080p", "videoGenerateAudio": "true"}},
	}
	for _, test := range tests {
		got, ok := selectorForVideoPrice(test.model, test.name)
		if !ok {
			t.Fatalf("selectorForVideoPrice(%q, %q) not supported", test.model, test.name)
		}
		if len(got) != len(test.want) {
			t.Fatalf("selectorForVideoPrice(%q, %q) = %#v, want %#v", test.model, test.name, got, test.want)
		}
		for key, want := range test.want {
			if got[key] != want {
				t.Fatalf("selectorForVideoPrice(%q, %q)[%q] = %q, want %q", test.model, test.name, key, got[key], want)
			}
		}
	}
}
