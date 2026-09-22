package main

import "testing"

func TestTaskSummaryDoesNotTreatFlagAsConfirmation(t *testing.T) {
	if shorten("你好世界", 2) != "你好…" {
		t.Fatal(shorten("你好世界", 2))
	}
	api, err := normalizeAPI("https://linggan.example")
	if err != nil || api != "https://linggan.example/api" {
		t.Fatalf("api = %q, err = %v", api, err)
	}
	api, err = normalizeAPI("https://linggan.example/api/")
	if err != nil || api != "https://linggan.example/api" {
		t.Fatalf("trimmed api = %q, err = %v", api, err)
	}
	if _, err := normalizeAPI("file:///tmp/linggan"); err == nil {
		t.Fatal("non-http server should be rejected")
	}
}
