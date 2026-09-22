package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCLICanvasStateAndApplyStayOnExistingRules(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := model.CanvasProject{ID: "cli-canvas", UserID: "user", Title: "命令行画布", PayloadJSON: `{"nodes":[],"connections":[]}`}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	state, err := s.CLICanvasState("user", "cli-canvas", 0)
	if err != nil {
		t.Fatal(err)
	}
	hash, _ := state["snapshotHash"].(string)
	if hash == "" || state["canvasId"] != "cli-canvas" || state["title"] != "命令行画布" {
		t.Fatalf("state = %#v", state)
	}
	raw := []byte(`{"snapshotHash":"` + hash + `","ops":[{"type":"add_node","id":"note","nodeType":"text","title":"标题","content":"正文"}]}`)
	result, err := s.CLIApplyCanvasOps("user", "cli-canvas", raw)
	if err != nil {
		t.Fatal(err)
	}
	applied, _ := result.(map[string]any)
	nextHash, _ := applied["snapshotHash"].(string)
	if nextHash == "" || nextHash == hash {
		t.Fatalf("apply result = %#v", result)
	}
	if _, err := s.CLIApplyCanvasOps("user", "cli-canvas", []byte(`{"snapshotHash":"`+hash+`","ops":[{"type":"add_node","id":"other","nodeType":"text"}]}`)); err == nil || !strings.Contains(err.Error(), "请重新读取后再提交") {
		t.Fatalf("stale snapshot should be rejected, err=%v", err)
	}
	if _, err := s.CLIApplyCanvasOps("user", "cli-canvas", []byte(`{"snapshotHash":"`+nextHash+`","ops":[{"type":"delete_node","id":"note"}]}`)); err == nil || !strings.Contains(err.Error(), "不支持的画布写操作") {
		t.Fatalf("delete should be rejected, err=%v", err)
	}
	created, err := s.CLICanvasTool("user", "cli-canvas", "canvas_create_storyboard", []byte(`{"snapshotHash":"`+nextHash+`","nodeId":"storyboard-1","title":"追逐","rows":[{"durationSeconds":4,"plotDescription":"主角冲出巷口"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if created.(map[string]any)["nodeId"] != "storyboard-1" {
		t.Fatalf("storyboard = %#v", created)
	}
	if _, err := s.CLICanvasTool("user", "cli-canvas", "generate_media", []byte(`{"mode":"image","prompt":"海报","nodeId":"image-1","title":"海报"}`)); err == nil {
		t.Fatal("generation without a selected model should fail before use")
	}
	if _, err := s.CLICanvasState("other", "cli-canvas", 0); err == nil {
		t.Fatal("foreign canvas state leaked")
	}
	encoded, err := json.Marshal(result)
	if err != nil || strings.Contains(string(encoded), "http://") {
		t.Fatalf("result leaked a URL or failed to encode: %s %v", encoded, err)
	}
}
