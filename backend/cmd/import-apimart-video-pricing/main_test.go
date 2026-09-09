package main

import "testing"

func TestCreditsToMicrocredits(t *testing.T) {
	if got := creditsToMicrocredits(0.216); got != 15_120_000 {
		t.Fatalf("creditsToMicrocredits() = %d, want 15120000", got)
	}
}

func TestSelectorForVideoPrice(t *testing.T) {
	tests := []struct {
		name string
		want map[string]string
	}{
		{"default", map[string]string{}},
		{"1080P-input", map[string]string{"vquality": "1080p", "operation": "image_to_video"}},
		{"720P-10S", map[string]string{"vquality": "720p", "videoSeconds": "10"}},
		{"1080P-refvideo", map[string]string{"vquality": "1080p", "operation": "reference_to_video"}},
		{"pro-sound", map[string]string{"size": "pro-sound"}},
	}
	for _, test := range tests {
		got, ok := selectorForVideoPrice(test.name)
		if !ok {
			t.Fatalf("selectorForVideoPrice(%q) not supported", test.name)
		}
		if len(got) != len(test.want) {
			t.Fatalf("selectorForVideoPrice(%q) = %#v, want %#v", test.name, got, test.want)
		}
		for key, want := range test.want {
			if got[key] != want {
				t.Fatalf("selectorForVideoPrice(%q)[%q] = %q, want %q", test.name, key, got[key], want)
			}
		}
	}
}
