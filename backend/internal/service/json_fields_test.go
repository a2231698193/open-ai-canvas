package service

import (
	"strings"
	"testing"
)

func TestOptionalJSONStringRejectsWrongType(t *testing.T) {
	payload := map[string]any{"id": 12.0, "status": "ok"}

	text, err := optionalJSONString(payload, "status")
	if err != nil || text != "ok" {
		t.Fatalf("optionalJSONString(status) = %q, %v", text, err)
	}

	text, err = optionalJSONString(payload, "missing")
	if err != nil || text != "" {
		t.Fatalf("optionalJSONString(missing) = %q, %v", text, err)
	}

	_, err = optionalJSONString(payload, "id")
	if err == nil || !strings.Contains(err.Error(), "expected string") || !strings.Contains(err.Error(), "float64") {
		t.Fatalf("optionalJSONString(id) error = %v", err)
	}
}

func TestRequireJSONString(t *testing.T) {
	payload := map[string]any{"id": "task-1", "empty": "  "}

	text, err := requireJSONString(payload, "id")
	if err != nil || text != "task-1" {
		t.Fatalf("requireJSONString(id) = %q, %v", text, err)
	}

	_, err = requireJSONString(payload, "empty")
	if err == nil || !strings.Contains(err.Error(), "missing field: empty") {
		t.Fatalf("requireJSONString(empty) error = %v", err)
	}

	_, err = requireJSONString(map[string]any{"id": true}, "id")
	if err == nil || !strings.Contains(err.Error(), "expected string") {
		t.Fatalf("requireJSONString(bool) error = %v", err)
	}
}

func TestFirstJSONStringPrefersValidStringOverWrongType(t *testing.T) {
	payload := map[string]any{"id": 99.0, "task_id": "abc"}

	text, err := firstJSONString(payload, "id", "task_id")
	if err != nil || text != "abc" {
		t.Fatalf("firstJSONString() = %q, %v", text, err)
	}

	_, err = firstJSONString(payload, "id", "request_id")
	if err == nil || !strings.Contains(err.Error(), "field id") {
		t.Fatalf("firstJSONString() error = %v", err)
	}

	text, err = firstJSONString(payload, "missing", "also-missing")
	if err != nil || text != "" {
		t.Fatalf("firstJSONString(missing) = %q, %v", text, err)
	}
}

func TestExtractProviderTaskID(t *testing.T) {
	id, err := extractProviderTaskID([]byte(`{"id":12,"task_id":"abc"}`))
	if err != nil || id != "abc" {
		t.Fatalf("extractProviderTaskID() = %q, %v", id, err)
	}

	_, err = extractProviderTaskID([]byte(`{"id":12}`))
	if err == nil || !strings.Contains(err.Error(), "expected string") || !strings.Contains(err.Error(), "float64") {
		t.Fatalf("extractProviderTaskID(numeric id) error = %v", err)
	}

	id, err = extractProviderTaskID([]byte(`{"data":{"task_id":"nested"}}`))
	if err != nil || id != "nested" {
		t.Fatalf("extractProviderTaskID(nested) = %q, %v", id, err)
	}

	id, err = extractProviderTaskID([]byte(`{"name":"task-from-name"}`))
	if err != nil || id != "task-from-name" {
		t.Fatalf("extractProviderTaskID(name) = %q, %v", id, err)
	}
}
